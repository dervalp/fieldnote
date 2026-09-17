import { z } from 'zod';
import { loadAuthoredPrMonitor } from '../db/queries/authored-pr-monitor';
import { loadAuthoringRun, validateAuthoringRun } from '../db/queries/authoring-runs';
import { loadSetupPlan } from '../db/queries/fieldnote-setup';
import { fetchGrantedPermissions } from './installation-permissions';
import { repositoryClient } from './repositories';
import { readSkillsRelease } from '../fieldnote-skills/github-release';
import { renderInstallation, verifyInstallation } from '../domain/fieldnote-skills/render';
import { parseInstallationLock, sha256 } from '../domain/fieldnote-skills/lock';
import {
  normalizeFeedback,
  monitorDecision,
  type Feedback,
  type MonitorInput,
} from '../domain/act/pr-monitor';
import { authorSetupRepair, validateRepairReplacement } from '../authoring/repair-setup';
import { e2bAuthoringSandbox } from '../authoring/e2b-sandbox';
import { authoringEnv } from '../lib/env';
import { SetupWriteError } from './write-authored-pr';
import { writePrRepair, repairCommitMessage } from './repair-authored-pr';
import { errorStatus } from './normalize';

type Context = NonNullable<Awaited<ReturnType<typeof loadAuthoredPrMonitor>>>;
type Snapshot = Omit<MonitorInput, 'repairs'> & { headSha: string };
async function authorize(context: Context) {
  const run = await loadAuthoringRun(context.pr.authoringRunId);
  if (
    !run ||
    run.repositoryId !== context.pr.repositoryId ||
    run.workflow !== 'fieldnote-setup' ||
    run.kind !== 'execute' ||
    !run.planRunId
  )
    throw new SetupWriteError('access_revoked');
  try {
    await validateAuthoringRun(run);
  } catch {
    throw new SetupWriteError('access_revoked');
  }
  const permissions = await fetchGrantedPermissions(run.repositoryId);
  if (permissions.contents !== 'write' || permissions.pullRequests !== 'write')
    throw new SetupWriteError('access_revoked');
  return run;
}
async function managed(context: Context) {
  const run = await authorize(context);
  const plan = await loadSetupPlan(run.planRunId!);
  if (
    !plan?.proposal ||
    plan.run.repositoryId !== run.repositoryId ||
    !plan.proposal.confirmedAgents?.some((agent) => agent.supported)
  )
    throw new SetupWriteError('invalid_installation');
  const release = await readSkillsRelease(plan.proposal.skillsRelease);
  if (
    release.revision !== plan.proposal.skillsRevision ||
    release.releaseLockHash !== plan.proposal.releaseLockHash ||
    plan.files.some((file) => sha256(file.body) !== file.hash)
  )
    throw new SetupWriteError('invalid_installation');
  const installation = renderInstallation({
    release,
    setupRunId: run.id,
    agents: plan.proposal.confirmedAgents,
    configuration: plan.files.map((file) => ({ path: file.path, content: file.body })),
  });
  return { run, plan, release, installation };
}
function providerError(error: unknown): never {
  if (error instanceof SetupWriteError) throw error;
  throw new SetupWriteError(errorStatus(error) === 401 ? 'access_revoked' : 'github_unavailable');
}
export async function observeAuthoredPr(context: Context): Promise<Snapshot> {
  try {
    const run = await authorize(context);
    const plan = await loadSetupPlan(run.planRunId!);
    if (!plan || plan.run.repositoryId !== run.repositoryId)
      throw new SetupWriteError('invalid_installation');
    const paths = plan.files.map((file) => file.path);
    const { repo, client } = await repositoryClient(context.pr.repositoryId);
    const identity = { owner: repo.owner, repo: repo.name, pull_number: context.pr.number };
    const { data: pr } = await client.rest.pulls.get(identity);
    const outcome = pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : 'open';
    const snapshot: Snapshot = {
      outcome,
      headSha: pr.head.sha,
      failures: [],
      reviews: [],
      pending: false,
    };
    if (outcome !== 'open') return snapshot;
    if (pr.head.ref !== context.pr.branch) return { ...snapshot, headChanged: true };
    const [{ data: checks }, { data: reviews }, { data: comments }, { data: statuses }] =
      await Promise.all([
        client.rest.checks.listForRef({
          owner: repo.owner,
          repo: repo.name,
          ref: pr.head.sha,
          filter: 'latest',
          per_page: 100,
        }),
        client.rest.pulls.listReviews({ ...identity, per_page: 100 }),
        client.rest.pulls.listReviewComments({ ...identity, per_page: 100 }),
        client.rest.repos.getCombinedStatusForRef({
          owner: repo.owner,
          repo: repo.name,
          ref: pr.head.sha,
          per_page: 100,
        }),
      ]);
    const ambiguous: Feedback = { kind: 'ci', reference: 'check:0', disposition: 'ambiguous' };
    if (
      checks.total_count > 100 ||
      reviews.length >= 100 ||
      comments.length >= 100 ||
      statuses.total_count > 100
    )
      return { ...snapshot, failures: [ambiguous] };
    for (const check of checks.check_runs) {
      if (check.head_sha !== pr.head.sha) continue;
      if (check.status !== 'completed') {
        snapshot.pending = true;
        continue;
      }
      if (['success', 'neutral', 'skipped'].includes(check.conclusion ?? '')) continue;
      const text = [check.output.title, check.output.summary, check.output.text]
        .filter(Boolean)
        .join('\n');
      snapshot.failures.push(normalizeFeedback('ci', `check:${check.id}`, text, paths));
    }
    for (const status of statuses.statuses) {
      if (status.state === 'pending') snapshot.pending = true;
      else if (status.state !== 'success')
        snapshot.failures.push(
          normalizeFeedback('ci', `status:${status.id}`, status.description ?? '', paths),
        );
    }
    // Later approvals or dismissals supersede an earlier changes-requested review.
    const latest = new Map<number, (typeof reviews)[number]>();
    for (const review of reviews)
      if (review.user && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state))
        latest.set(review.user.id, review);
    for (const review of latest.values())
      if (review.state === 'CHANGES_REQUESTED')
        snapshot.reviews.push(
          normalizeFeedback('review', `review:${review.id}`, review.body ?? '', paths),
        );
    for (const comment of comments)
      if (comment.commit_id === pr.head.sha && comment.position !== null) {
        const text = /^(?:please\s+)?format\.?$/i.test(comment.body.trim())
          ? `format ${comment.path}`
          : comment.body;
        snapshot.reviews.push(normalizeFeedback('review', `comment:${comment.id}`, text, paths));
      }
    if (snapshot.failures.length + snapshot.reviews.length > 40)
      return { ...snapshot, failures: [ambiguous], reviews: [] };
    return snapshot;
  } catch (error) {
    providerError(error);
  }
}

export async function repairAuthoredPr(
  authoredPrId: string,
  repairId: string,
): Promise<{ headSha: string }> {
  try {
    const context = await loadAuthoredPrMonitor(authoredPrId);
    const attempt = context?.repairs.find((repair) => repair.id === repairId);
    if (!context || !attempt || context.humanRequired) throw new SetupWriteError('access_revoked');
    if (attempt.state === 'complete' && attempt.resultHeadSha)
      return { headSha: attempt.resultHeadSha };
    if (!['queued', 'running'].includes(attempt.state))
      throw new SetupWriteError('repair_obsolete');
    const setup = await managed(context);
    const snapshot = await observeAuthoredPr(context);
    if (snapshot.outcome !== 'open' || snapshot.headChanged)
      throw new SetupWriteError('setup_conflict');
    const { repo, client } = await repositoryClient(context.pr.repositoryId);
    const identity = { owner: repo.owner, repo: repo.name };
    const readManaged = async (headSha: string) => {
      const { data: commit } = await client.rest.git.getCommit({
        ...identity,
        commit_sha: headSha,
      });
      const { data: tree } = await client.rest.git.getTree({
        ...identity,
        tree_sha: commit.tree.sha,
        recursive: '1',
      });
      if (tree.truncated) throw new SetupWriteError('setup_conflict');
      const files = new Map<string, string>();
      let bytes = 0;
      for (const path of setup.installation.files.keys()) {
        const entry = tree.tree.find((file) => file.path === path);
        if (!entry?.sha || entry.mode !== '100644' || entry.type !== 'blob')
          throw new SetupWriteError('setup_conflict');
        const { data: blob } = await client.rest.git.getBlob({ ...identity, file_sha: entry.sha });
        if (
          blob.encoding !== 'base64' ||
          blob.size === null ||
          blob.size > 256 * 1024 ||
          (bytes += blob.size) > 4 * 1024 * 1024
        )
          throw new SetupWriteError('invalid_installation');
        const content = Buffer.from(blob.content, 'base64').toString('utf8');
        files.set(path, content);
      }
      const lock = parseInstallationLock(files.get('.fieldnote/skills.lock.json')!);
      if (
        lock.setupRunId !== setup.run.id ||
        verifyInstallation({ commitSha: headSha, files }, setup.release).state !== 'current'
      )
        throw new SetupWriteError('invalid_installation');
      return { files, commit, tree };
    };
    // Recover a published commit before another model call. Prove its exact
    // parent, identity, managed-file diff and immutable release bytes first.
    if (snapshot.headSha !== attempt.baseHeadSha) {
      const recovered = await readManaged(snapshot.headSha);
      if (
        recovered.commit.message !== repairCommitMessage(attempt.id) ||
        recovered.commit.parents.length !== 1 ||
        recovered.commit.parents[0].sha !== attempt.baseHeadSha
      )
        throw new SetupWriteError('setup_conflict');
      const parent = await readManaged(attempt.baseHeadSha);
      const withoutLock = (files: ReadonlyMap<string, string>) =>
        new Map([...files].filter(([path]) => path !== '.fieldnote/skills.lock.json'));
      validateRepairReplacement(withoutLock(parent.files), withoutLock(recovered.files));
      const outside = (tree: typeof parent.tree) =>
        JSON.stringify(
          tree.tree
            .filter(
              (entry) => entry.type !== 'tree' && !setup.installation.files.has(entry.path ?? ''),
            )
            .map((entry) => [entry.path, entry.mode, entry.type, entry.sha])
            .sort(),
        );
      if (outside(parent.tree) !== outside(recovered.tree))
        throw new SetupWriteError('setup_conflict');
      return { headSha: snapshot.headSha };
    }
    const decision = monitorDecision({ ...snapshot, repairs: attempt.ordinal - 1 });
    if (decision.kind === 'wait') throw new SetupWriteError('repair_pending');
    if (decision.kind !== 'repair') throw new SetupWriteError('invalid_installation');
    const trigger = z
      .object({
        kind: z.enum(['ci', 'review']),
        reference: z.string(),
        disposition: z.literal('actionable'),
        path: z.string(),
        instruction: z.literal('format'),
      })
      .parse(JSON.parse(attempt.triggerReference));
    if (
      ![...snapshot.failures, ...snapshot.reviews].some(
        (item) => JSON.stringify(item) === JSON.stringify(trigger),
      )
    )
      throw new SetupWriteError('invalid_installation');
    const original = await readManaged(attempt.baseHeadSha);
    await authorize(context);
    const config = authoringEnv();
    if (!config) throw new SetupWriteError('github_unavailable');
    let replacement: Map<string, string>;
    try {
      replacement = await authorSetupRepair(
        e2bAuthoringSandbox(
          {
            apiKey: config.E2B_API_KEY,
            anthropicApiKey: config.ANTHROPIC_API_KEY,
            model: config.FIELDNOTE_AUTHORING_MODEL,
          },
          undefined,
          'repair',
        ),
        original.files,
        [trigger],
        context.repairs
          .filter((repair) => repair.id !== attempt.id)
          .map(({ ordinal, state }) => ({ ordinal, state })),
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'Authoring sandbox failed.')
        throw new SetupWriteError('github_unavailable');
      throw new SetupWriteError('invalid_installation');
    }
    const installation = renderInstallation({
      release: setup.release,
      setupRunId: setup.run.id,
      agents: setup.plan.proposal!.confirmedAgents!,
      configuration: setup.plan.files.map((file) => ({
        path: file.path,
        content: replacement.get(file.path)!,
      })),
    });
    if (
      verifyInstallation(
        { commitSha: attempt.baseHeadSha, files: installation.files },
        setup.release,
      ).state !== 'current'
    )
      throw new SetupWriteError('invalid_installation');
    return await writePrRepair(
      {
        ...identity,
        branch: context.pr.branch,
        expectedHeadSha: attempt.baseHeadSha,
        repairId: attempt.id,
        commitDate: attempt.createdAt.toISOString(),
        files: installation.files,
        managedPaths: [...setup.installation.files.keys()],
        authorize: async () => {
          const fresh = await loadAuthoredPrMonitor(authoredPrId);
          if (!fresh || fresh.humanRequired || fresh.pr.outcome !== 'open')
            throw new SetupWriteError('access_revoked');
          await authorize(fresh);
          const { data: pr } = await client.rest.pulls.get({
            ...identity,
            pull_number: fresh.pr.number,
          });
          if (
            pr.state !== 'open' ||
            pr.merged ||
            pr.head.ref !== fresh.pr.branch ||
            pr.head.sha !== attempt.baseHeadSha
          )
            throw new SetupWriteError('setup_conflict');
        },
      },
      client,
    );
  } catch (error) {
    providerError(error);
  }
}
