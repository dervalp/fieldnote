import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, closeDb } from './index';
import * as schema from './schema';
import { authoredPrClient } from '../github/testing/authored-pr-client';
import { writeAuthoredPullRequest } from '../github/write-authored-pr';
import { writePrRepair } from '../github/repair-authored-pr';
import { renderInstallation } from '../domain/fieldnote-skills/render';
import { sha256 } from '../domain/fieldnote-skills/lock';

const context = vi.hoisted(() => ({
  repositoryId: '',
  configs: [] as Array<{ onFailure?: (input: unknown) => Promise<unknown> }>,
}));
vi.mock('../inngest/client', () => ({
  inngest: {
    createFunction: (
      config: { onFailure?: (input: unknown) => Promise<unknown> },
      handler: unknown,
    ) => {
      context.configs.push(config);
      return handler;
    },
  },
}));
vi.mock('../auth/session', () => ({ currentUser: async () => ({ id: 'unused' }) }));
vi.mock('../lib/env', () => ({ env: () => ({ DEMO_MODE: 'false' }) }));
vi.mock('../workspaces/access', () => ({
  requireRepository: async (repositoryId: string) => {
    if (repositoryId !== context.repositoryId) throw new Error('not found');
    return { id: repositoryId };
  },
}));

const owner = randomUUID();
const workspace = randomUUID();
const repositories: string[] = [];
const sha = 'a'.repeat(40);
const agents = [{ agent: 'codex' as const, supported: true, skillsRoot: '.agents/skills' }];

test('merged verification persists idempotently and terminal reconciliation keeps merge time stable', async () => {
  const { pr, monitor } = await repairFixture();
  const { loadInstallationVerification, recordVerifiedInstallation } =
    await import('./queries/fieldnote-installations');
  expect(await loadInstallationVerification(pr.id)).toBeNull();
  const observation = {
    state: 'current' as const,
    release: 'skills-v0.1.0',
    revision: 'b'.repeat(40),
    lockHash: sha256('lock'),
    agents,
    commitSha: sha,
    reasons: [],
  };
  expect(await recordVerifiedInstallation(pr.id, observation)).toBeNull();
  await monitor.recordPrOutcome(pr.id, { outcome: 'merged', headSha: sha });
  const loaded = await loadInstallationVerification(pr.id);
  expect(loaded?.run.id).toBe(pr.authoringRunId);
  await Promise.all([
    recordVerifiedInstallation(pr.id, observation),
    recordVerifiedInstallation(pr.id, observation),
  ]);
  const [stored] = await db()
    .select()
    .from(schema.repositoryFieldnoteInstallations)
    .where(eq(schema.repositoryFieldnoteInstallations.repositoryId, pr.repositoryId));
  const repeated = await recordVerifiedInstallation(pr.id, observation);
  expect(repeated?.verifiedAt).toEqual(stored.verifiedAt);
  await monitor.recordPrOutcome(pr.id, { outcome: 'merged', headSha: sha });
  expect((await loadInstallationVerification(pr.id))?.pr.mergedAt).toEqual(loaded?.pr.mergedAt);
  expect((await monitor.listMonitoredPrs()).map((row) => row.id)).not.toContain(pr.id);
});

test('confirmed missing authoring access has a distinct terminal error', async () => {
  const value = await plan();
  const { loadAuthoringRun, validateAuthoringRun } = await import('./queries/authoring-runs');
  const run = (await loadAuthoringRun(value.id))!;
  await expect(validateAuthoringRun(run)).rejects.toMatchObject({
    name: 'AuthoringAccessRevokedError',
  });
});

async function repairFixture() {
  const q = await import('./queries/fieldnote-setup');
  const monitor = await import('./queries/authored-pr-monitor');
  const value = await plan();
  await proposal(value.id);
  const execute = await q.readySetupAndQueueExecute(value.id);
  const pr = await q.recordAuthoredPullRequest({
    authoringRunId: execute.id,
    repositoryId: value.repositoryId,
    number: 42,
    branch: 'fieldnote/setup',
    headSha: sha,
    url: 'https://github.test/pr/42',
    outcome: 'open',
    openedAt: new Date(),
  });
  const repair = (await monitor.reservePrRepair(pr.id, sha, {
    kind: 'ci',
    reference: 'check:1',
    disposition: 'actionable',
    path: '.fieldnote/profile.md',
    instruction: 'format',
  }))!;
  return { pr, repair, monitor };
}

test('monitor context cannot mix an old PR head with a concurrently finalized repair', async () => {
  const { pr, repair, monitor } = await repairFixture();
  const inspector = postgres(process.env.DATABASE_URL!, { max: 1 });
  const ready = Promise.withResolvers<number>();
  const release = Promise.withResolvers<void>();
  const writer = db().transaction(async (tx) => {
    const [{ pid }] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    await tx
      .select()
      .from(schema.authoredPullRequests)
      .where(eq(schema.authoredPullRequests.id, pr.id))
      .for('update');
    // Block the old nontransactional reader at its second SELECT, after it has
    // already read the old PR. A correct reader instead blocks at the PR lock.
    await tx.execute(sql`lock table authored_pull_request_repairs in access exclusive mode`);
    await tx
      .update(schema.authoredPullRequests)
      .set({ headSha: 'b'.repeat(40) })
      .where(eq(schema.authoredPullRequests.id, pr.id));
    await tx
      .update(schema.authoredPullRequestRepairs)
      .set({ state: 'complete', resultHeadSha: 'b'.repeat(40) })
      .where(eq(schema.authoredPullRequestRepairs.id, repair.id));
    ready.resolve(pid);
    await release.promise;
  });
  const pid = await ready.promise;
  const reading = monitor.loadAuthoredPrMonitor(pr.id);
  try {
    const deadline = Date.now() + 5000;
    let blocked = false;
    while (!blocked && Date.now() < deadline) {
      const [row] =
        await inspector`select exists(select 1 from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))) as blocked`;
      blocked = row.blocked;
      if (!blocked) await inspector`select pg_sleep(0.01)`;
    }
    expect(blocked).toBe(true);
  } finally {
    release.resolve();
  }
  await writer;
  try {
    const observed = await reading;
    expect(observed?.repairs[0].state).toBe('complete');
    expect(observed?.pr.headSha).toBe('b'.repeat(40));
  } finally {
    await inspector.end();
  }
});

test('repair publication and a delayed failure callback serialize without a stale PR head', async () => {
  const { pr, repair, monitor } = await repairFixture();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const github = authoredPrClient(sha);
  github.refs.set(`heads/${pr.branch}`, sha);
  Object.assign(github.api.git, {
    updateRef: async ({ ref, sha: head, force }: { ref: string; sha: string; force: boolean }) => {
      if (force || github.commits.get(head)?.parents[0]?.sha !== github.refs.get(ref))
        throw { status: 422 };
      github.refs.set(ref, head);
      return { data: {} };
    },
  });
  const publication = writePrRepair(
    {
      owner: 'octo',
      repo: 'repo',
      branch: pr.branch,
      expectedHeadSha: sha,
      repairId: repair.id,
      commitDate: repair.createdAt.toISOString(),
      files: new Map([['.fieldnote/profile.md', 'profile']]),
      managedPaths: ['.fieldnote/profile.md'],
      authorize: async () => {},
      publish: async (headSha, write) => {
        const result = await monitor.publishPrRepair(pr.id, repair.id, async () => {
          entered.resolve();
          await release.promise;
          await write();
          return { headSha };
        });
        if (!result) throw new Error('Unexpected obsolete publication');
        return result;
      },
    },
    github.client,
  );
  await entered.promise;
  const failure = monitor.finishPrRepair(repair.id, { errorCode: 'repair_failed' });
  // Let the failure reach its lock, while publication remains in flight.
  const inspector = postgres(process.env.DATABASE_URL!, { max: 1 });
  let blocked = false;
  try {
    const deadline = Date.now() + 5000;
    while (!blocked && Date.now() < deadline) {
      const [row] =
        await inspector`select exists(select 1 from pg_stat_activity where wait_event_type = 'Lock' and query like '%authored_pull_requests%') as blocked`;
      blocked = row.blocked;
      if (!blocked) await inspector`select pg_sleep(0.01)`;
    }
  } finally {
    release.resolve();
    await inspector.end();
  }
  await Promise.all([publication, failure]);
  const stored = await monitor.loadAuthoredPrMonitor(pr.id);
  expect(blocked).toBe(true);
  const remoteHead = github.refs.get(`heads/${pr.branch}`)!;
  expect(remoteHead).not.toBe(sha);
  expect(stored?.pr.headSha).toBe(remoteHead);
  expect(stored?.repairs[0]).toMatchObject({
    state: 'complete',
    resultHeadSha: remoteHead,
    errorCode: null,
  });
});

test('a failure finalized before publication prevents the provider mutation', async () => {
  const { pr, repair, monitor } = await repairFixture();
  await monitor.finishPrRepair(repair.id, { errorCode: 'repair_failed' });
  let remoteHead = sha;
  const result = await monitor.publishPrRepair(pr.id, repair.id, async () => {
    remoteHead = 'b'.repeat(40);
    return { headSha: remoteHead };
  });
  expect(result).toBeNull();
  expect(remoteHead).toBe(sha);
  expect((await monitor.loadAuthoredPrMonitor(pr.id))?.pr.headSha).toBe(sha);
});

test.each(['lost response', 'database rollback'])(
  'exhausted repair recovers remote publication after %s',
  async (failure) => {
    const { pr, repair, monitor } = await repairFixture();
    let remoteHead = sha;
    await expect(
      monitor.publishPrRepair(pr.id, repair.id, async () => {
        remoteHead = 'c'.repeat(40);
        if (failure === 'database rollback')
          // A genuine SQL failure after the remote side effect rolls the transaction back.
          return { headSha: null as unknown as string };
        throw new Error('private lost response');
      }),
    ).rejects.toThrow();
    expect((await monitor.loadAuthoredPrMonitor(pr.id))?.repairs[0].state).toBe('queued');
    const reconcile = vi.fn(async () => {
      throw new Error('provider unavailable during retries');
    });
    for (let retry = 0; retry < 3; retry++)
      await expect(monitor.reconcilePrRepairFailure(pr.id, repair.id, reconcile)).rejects.toThrow();
    expect((await monitor.loadAuthoredPrMonitor(pr.id))?.pr.headSha).toBe(sha);
    await monitor.reconcilePrRepairFailure(pr.id, repair.id, async () => ({ headSha: remoteHead }));
    const stored = await monitor.loadAuthoredPrMonitor(pr.id);
    expect(stored?.pr.headSha).toBe(remoteHead);
    expect(stored?.repairs[0]).toMatchObject({
      state: 'complete',
      resultHeadSha: remoteHead,
      errorCode: null,
    });
    const delayed = vi.fn();
    await monitor.reconcilePrRepairFailure(pr.id, repair.id, delayed);
    expect(delayed).not.toHaveBeenCalled();
  },
);

test('confirmed unpublished exhaustion fails and prevents a later publication', async () => {
  const { pr, repair, monitor } = await repairFixture();
  await monitor.reconcilePrRepairFailure(pr.id, repair.id, async () => ({ unpublished: true }));
  const write = vi.fn();
  expect(await monitor.publishPrRepair(pr.id, repair.id, write)).toBeNull();
  expect(write).not.toHaveBeenCalled();
  const stored = await monitor.loadAuthoredPrMonitor(pr.id);
  expect(stored?.repairs[0]).toMatchObject({ state: 'failed', errorCode: 'repair_failed' });
  expect(stored?.pr.headSha).toBe(sha);
});

test.each(['lost response', 'database rollback', 'unpublished'])(
  'actual onFailure reconciles exact Git publication after %s without authoring',
  async (failure) => {
    const { pr, repair, monitor } = await repairFixture();
    const runs = await import('./queries/authoring-runs');
    const plans = await import('./queries/fieldnote-setup');
    const releases = await import('../fieldnote-skills/github-release');
    const permissions = await import('../github/installation-permissions');
    const repositoriesApi = await import('../github/repositories');
    const sandbox = await import('../authoring/e2b-sandbox');
    const execute = (await runs.loadAuthoringRun(pr.authoringRunId))!;
    const plan = (await plans.loadSetupPlan(execute.planRunId!))!;
    const release = {
      release: 'skills-v0.1.0',
      revision: 'b'.repeat(40),
      releaseLockHash: sha256('lock'),
      skills: [
        {
          name: 'fieldnote-testing',
          version: '0.1.0',
          files: [{ path: 'SKILL.md', content: 'generic', hash: sha256('generic') }],
        },
      ],
    };
    const render = (content: string) =>
      renderInstallation({
        release,
        setupRunId: execute.id,
        agents,
        configuration: [{ path: '.fieldnote/profile.md', content }],
      }).files;
    const original = render('# Profile  \n');
    const replacement = render('# Profile\n');
    const github = authoredPrClient(sha);
    github.refs.set(`heads/${pr.branch}`, sha);
    const blobs = new Map<string, string>();
    const originalCreateBlob = github.api.git.createBlob.getMockImplementation()!;
    github.api.git.createBlob.mockImplementation(async (input) => {
      const result = await originalCreateBlob(input);
      blobs.set(result.data.sha, input.content);
      return result;
    });
    for (const [path, content] of original) {
      const { data } = await github.api.git.createBlob({ content });
      github.trees.get('initial-tree')!.push({ path, mode: '100644', type: 'blob', sha: data.sha });
    }
    const originalCreateCommit = github.api.git.createCommit.getMockImplementation()!;
    github.api.git.createCommit.mockImplementation(async (input) => {
      const result = await originalCreateCommit(input);
      Object.assign(github.commits.get(result.data.sha)!, {
        author: input.author,
        committer: input.committer,
      });
      return result;
    });
    const readPr = vi.fn(async () => ({
      data: {
        state: 'open',
        merged: false,
        head: { ref: pr.branch, sha: github.refs.get(`heads/${pr.branch}`)! },
      },
    }));
    Object.assign(github.api.pulls, { get: readPr });
    Object.assign(github.api.pulls, {
      listReviews: async () => ({ data: [] }),
      listReviewComments: async () => ({ data: [] }),
    });
    Object.assign(github.api, {
      checks: { listForRef: async () => ({ data: { total_count: 0, check_runs: [] } }) },
    });
    Object.assign(github.api.repos, {
      getCombinedStatusForRef: async () => ({ data: { total_count: 0, statuses: [] } }),
    });
    Object.assign(github.api.git, {
      getBlob: async ({ file_sha }: { file_sha: string }) => ({
        data: {
          encoding: 'base64',
          size: Buffer.byteLength(blobs.get(file_sha)!),
          content: Buffer.from(blobs.get(file_sha)!).toString('base64'),
        },
      }),
      updateRef: async ({
        ref,
        sha: head,
        force,
      }: {
        ref: string;
        sha: string;
        force: boolean;
      }) => {
        if (force || github.commits.get(head)?.parents[0]?.sha !== github.refs.get(ref))
          throw { status: 422 };
        github.refs.set(ref, head);
        if (failure === 'lost response') throw { status: 503, message: 'private lost response' };
        return { data: {} };
      },
    });
    const [repository] = await db()
      .select()
      .from(schema.repositories)
      .where(eq(schema.repositories.id, pr.repositoryId));
    const [installation] = await db()
      .select()
      .from(schema.installations)
      .where(eq(schema.installations.id, repository.installationId));
    vi.spyOn(runs, 'validateAuthoringRun').mockResolvedValue(undefined);
    vi.spyOn(plans, 'loadSetupPlan').mockResolvedValue({
      ...plan,
      proposal: {
        ...plan.proposal!,
        skillsRelease: release.release,
        skillsRevision: release.revision,
        releaseLockHash: release.releaseLockHash,
      },
      files: [
        {
          ...plan.files[0],
          path: '.fieldnote/profile.md',
          body: '# Profile  \n',
          hash: sha256('# Profile  \n'),
        },
      ],
    });
    vi.spyOn(releases, 'readSkillsRelease').mockResolvedValue(release);
    vi.spyOn(permissions, 'fetchGrantedPermissions').mockResolvedValue({
      contents: 'write',
      pullRequests: 'write',
    });
    vi.spyOn(repositoriesApi, 'repositoryClient').mockResolvedValue({
      repo: repository,
      installation,
      client: github.client,
    });
    const author = vi.spyOn(sandbox, 'e2bAuthoringSandbox').mockImplementation(() => {
      throw new Error('Recovery must not invoke a model');
    });
    try {
      const functions = await import('../inngest/functions/monitor-authored-pr');
      if (failure !== 'unpublished') {
        await expect(
          writePrRepair(
            {
              owner: repository.owner,
              repo: repository.name,
              branch: pr.branch,
              expectedHeadSha: sha,
              repairId: repair.id,
              commitDate: repair.createdAt.toISOString(),
              files: replacement,
              managedPaths: [...original.keys()],
              authorize: async () => {},
              publish: async (_headSha, write) => {
                const result = await monitor.publishPrRepair(pr.id, repair.id, async () => {
                  await write();
                  // Trigger an actual database constraint failure after the ref mutation.
                  return { headSha: null as unknown as string };
                });
                return result!;
              },
            },
            github.client,
          ),
        ).rejects.toMatchObject({ code: 'github_unavailable' });
        expect(github.refs.get(`heads/${pr.branch}`)).not.toBe(sha);
      }
      const onFailure = context.configs.find((config) => config.onFailure)!.onFailure!;
      const event = {
        event: { data: { event: { data: { authoredPrId: pr.id, repairId: repair.id } } } },
      };
      // Exhaust the normal delivery while provider state is unavailable. Neither
      // retries nor a retrying failure callback may destroy the reservation.
      const { repairAuthoredPr } = await import('../github/monitor-authored-pr');
      for (let retry = 0; retry < 3; retry++) {
        readPr.mockRejectedValueOnce(new Error('private provider outage'));
        await expect(repairAuthoredPr(pr.id, repair.id)).rejects.toMatchObject({
          code: 'github_unavailable',
        });
      }
      readPr.mockRejectedValueOnce(new Error('private provider outage'));
      await expect(onFailure(event)).rejects.toMatchObject({ code: 'github_unavailable' });
      expect((await monitor.loadAuthoredPrMonitor(pr.id))?.repairs[0].state).toBe('queued');
      if (failure === 'unpublished') await onFailure(event);
      else {
        // Reconciliation emits another monitor event immediately, without
        // advancing time past the original repair event's deduplication window.
        const delivered = new Set([`authored-pr-repair:${repair.id}`]);
        const step = {
          run: async (_name: string, work: () => Promise<unknown>) => work(),
          sendEvent: async (_name: string, event: { id?: string; data: unknown }) => {
            if (event.id && delivered.has(event.id)) return;
            const run = functions.repairAuthoredPrFunction as unknown as (
              input: unknown,
            ) => Promise<unknown>;
            await run({ event, step });
          },
        };
        const run = functions.monitorAuthoredPrFunction as unknown as (
          input: unknown,
        ) => Promise<unknown>;
        await run({ event: { data: { authoredPrId: pr.id } }, step });
      }
      const stored = await monitor.loadAuthoredPrMonitor(pr.id);
      expect(stored?.pr.headSha).toBe(github.refs.get(`heads/${pr.branch}`));
      expect(stored?.repairs[0]).toMatchObject(
        failure === 'unpublished'
          ? { state: 'failed', resultHeadSha: null, errorCode: 'repair_failed' }
          : { state: 'complete', resultHeadSha: stored?.pr.headSha, errorCode: null },
      );
      expect(author).not.toHaveBeenCalled();
      await onFailure(event);
      expect((await monitor.loadAuthoredPrMonitor(pr.id))?.pr.headSha).toBe(stored?.pr.headSha);
    } finally {
      vi.restoreAllMocks();
    }
  },
);

test('concurrent repair reservations reuse one ordinal, cap at three, and terminal outcomes never install', async () => {
  const q = await import('./queries/fieldnote-setup');
  const monitor = await import('./queries/authored-pr-monitor');
  const value = await plan();
  await proposal(value.id);
  const execute = await q.readySetupAndQueueExecute(value.id);
  const pr = await q.recordAuthoredPullRequest({
    authoringRunId: execute.id,
    repositoryId: value.repositoryId,
    number: 42,
    branch: 'fieldnote/setup',
    headSha: sha,
    url: 'https://github.test/pr/42',
    outcome: 'open',
    openedAt: new Date(),
  });
  const trigger = {
    kind: 'ci' as const,
    reference: 'check:1',
    disposition: 'actionable' as const,
    path: '.fieldnote/profile.md',
    instruction: 'format' as const,
  };
  for (let ordinal = 1; ordinal <= 3; ordinal++) {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => monitor.reservePrRepair(pr.id, sha, trigger)),
    );
    expect(new Set(results.map((row) => row?.id)).size).toBe(1);
    expect(results[0]?.ordinal).toBe(ordinal);
    await monitor.finishPrRepair(results[0]!.id, { errorCode: 'repair_failed' });
  }
  expect(
    await monitor.reservePrRepair(pr.id, sha, { ...trigger, reference: 'check:4' }),
  ).toBeNull();
  expect((await monitor.loadAuthoredPrMonitor(pr.id))?.repairs).toHaveLength(3);
  await monitor.recordPrOutcome(pr.id, { outcome: 'closed', headSha: sha });
  expect(await monitor.reservePrRepair(pr.id, sha, trigger)).toBeNull();
  expect((await monitor.listMonitoredPrs()).map((row) => row.id)).not.toContain(pr.id);
  expect(
    await db()
      .select()
      .from(schema.repositoryFieldnoteInstallations)
      .where(eq(schema.repositoryFieldnoteInstallations.repositoryId, value.repositoryId)),
  ).toEqual([]);
});

test('conflicting execution reopens once and concurrent ready-again calls reuse the same execution', async () => {
  const q = await import('./queries/fieldnote-setup');
  const value = await plan();
  await proposal(value.id);
  const execute = await q.readySetupAndQueueExecute(value.id);
  await db()
    .update(schema.authoringRuns)
    .set({ state: 'running', startedAt: new Date(), dispatchedAt: new Date() })
    .where(eq(schema.authoringRuns.id, execute.id));
  const snapshot = {
    sha: 'b'.repeat(40),
    complete: true,
    paths: ['AGENTS.md'],
    documents: [{ path: 'AGENTS.md', blobSha: 'c'.repeat(40), text: 'private raw source' }],
    candidates: [],
  };
  await Promise.all([
    q.reopenSetupPlan(execute.id, snapshot, 'setup_conflict'),
    q.reopenSetupPlan(execute.id, snapshot, 'setup_conflict'),
  ]);
  const reopened = await q.loadSetupPlan(value.id);
  expect(reopened?.run.state).toBe('running');
  expect(reopened?.run.sha).toBe(snapshot.sha);
  expect(reopened?.proposal?.state).toBe('awaiting-input');
  expect(reopened?.notes.filter((note) => note.kind === 'question')).toHaveLength(1);
  expect(reopened?.notes.find((note) => note.kind === 'question')?.body).toMatch(/^\[agents\]/);
  expect(JSON.stringify(reopened)).not.toContain('private raw source');
  expect((await q.getSetupSummary(value.repositoryId, 'skills-v0.1.0')).progress?.state).toBe(
    'awaiting-input',
  );
  const requeued = await Promise.all([
    q.readySetupAndQueueExecute(value.id),
    q.readySetupAndQueueExecute(value.id),
  ]);
  expect(requeued.map((row) => row.id)).toEqual([execute.id, execute.id]);
  expect(requeued[0]).toMatchObject({
    state: 'queued',
    errorCode: null,
    completedAt: null,
    startedAt: null,
    dispatchedAt: null,
    sha: snapshot.sha,
  });
  const active = await db()
    .select()
    .from(schema.authoringRuns)
    .where(
      and(
        eq(schema.authoringRuns.repositoryId, value.repositoryId),
        inArray(schema.authoringRuns.state, ['queued', 'running']),
      ),
    );
  expect(active.map((row) => row.id)).toEqual([execute.id]);
});

test('execute completion requires its recorded PR and recording retries update the same PR head', async () => {
  const q = await import('./queries/fieldnote-setup');
  const value = await plan();
  await proposal(value.id);
  const execute = await q.readySetupAndQueueExecute(value.id);
  await db()
    .update(schema.authoringRuns)
    .set({ state: 'running' })
    .where(eq(schema.authoringRuns.id, execute.id));
  await expect(q.completeSetupExecute(execute.id)).rejects.toThrow(
    'Setup pull request is not recorded',
  );
  const input = {
    authoringRunId: execute.id,
    repositoryId: value.repositoryId,
    number: 42,
    branch: 'fieldnote/setup-skills-v0.1.0',
    headSha: sha,
    url: 'https://github.test/pr/42',
    outcome: 'open' as const,
    openedAt: new Date(),
  };
  const first = await q.recordAuthoredPullRequest(input);
  const next = await q.recordAuthoredPullRequest({ ...input, headSha: 'b'.repeat(40) });
  expect(next).toMatchObject({ id: first.id, headSha: 'b'.repeat(40) });
  await q.completeSetupExecute(execute.id);
  expect(
    (
      await db().select().from(schema.authoringRuns).where(eq(schema.authoringRuns.id, execute.id))
    )[0].state,
  ).toBe('complete');
  expect(
    await db()
      .select()
      .from(schema.repositoryFieldnoteInstallations)
      .where(eq(schema.repositoryFieldnoteInstallations.repositoryId, value.repositoryId)),
  ).toEqual([]);
});

test('the actual writer adopts and persists a lost-response PR after unrelated default movement', async () => {
  const q = await import('./queries/fieldnote-setup');
  const value = await plan();
  await proposal(value.id);
  const execute = await q.readySetupAndQueueExecute(value.id);
  await db()
    .update(schema.authoringRuns)
    .set({ state: 'running' })
    .where(eq(schema.authoringRuns.id, execute.id));
  const github = authoredPrClient(sha);
  const create = github.api.pulls.create.getMockImplementation()!;
  github.api.pulls.create.mockImplementationOnce(async (input) => {
    await create(input);
    throw { status: 503, message: 'private response lost' };
  });
  const input = {
    owner: 'octo',
    repo: 'repo',
    runId: execute.id,
    commitDate: execute.createdAt.toISOString(),
    proposalBaseSha: sha,
    expectedBaseSha: sha,
    release: 'skills-v0.1.0',
    revision: 'c'.repeat(40),
    files: new Map([['.fieldnote/profile.md', 'Complete profile']]),
    agents,
    evidenceCount: 1,
    authorize: async () => {},
  };
  await expect(writeAuthoredPullRequest(input, github.client)).rejects.toMatchObject({
    code: 'github_unavailable',
  });
  expect(
    await db()
      .select()
      .from(schema.authoredPullRequests)
      .where(eq(schema.authoredPullRequests.authoringRunId, execute.id)),
  ).toEqual([]);
  github.moveDefault('d'.repeat(40));
  const recovered = await writeAuthoredPullRequest(input, github.client);
  const stored = await q.recordAuthoredPullRequest({
    authoringRunId: execute.id,
    repositoryId: value.repositoryId,
    ...recovered,
    outcome: 'open',
    openedAt: new Date(),
  });
  await q.completeSetupExecute(execute.id);
  expect(stored).toMatchObject({
    number: 42,
    headSha: github.prs[0].head.sha,
    branch: 'fieldnote/setup-skills-v0.1.0',
  });
  expect(
    (
      await db().select().from(schema.authoringRuns).where(eq(schema.authoringRuns.id, execute.id))
    )[0].state,
  ).toBe('complete');
  expect(github.api.git.createCommit).toHaveBeenCalledTimes(1);
  expect(github.api.pulls.create).toHaveBeenCalledTimes(1);
});

beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
  await db().insert(schema.users).values({ id: owner, login: 'setup', credentials: 'fixture' });
  await db().insert(schema.workspaces).values({ id: workspace, name: 'Setup' });
});

afterAll(async () => {
  if (repositories.length) {
    // Table existence keeps cleanup valid while exercising the pre-feature schema in RED.
    const runs = (
      await db()
        .select({ id: schema.authoringRuns.id })
        .from(schema.authoringRuns)
        .where(inArray(schema.authoringRuns.repositoryId, repositories))
    ).map((run) => run.id);
    if (schema.authoredPullRequests) {
      const prs = (
        await db()
          .select({ id: schema.authoredPullRequests.id })
          .from(schema.authoredPullRequests)
          .where(inArray(schema.authoredPullRequests.repositoryId, repositories))
      ).map((pr) => pr.id);
      if (prs.length)
        await db()
          .delete(schema.authoredPullRequestRepairs)
          .where(inArray(schema.authoredPullRequestRepairs.authoredPullRequestId, prs));
      await db()
        .delete(schema.authoredPullRequests)
        .where(inArray(schema.authoredPullRequests.repositoryId, repositories));
      await db()
        .delete(schema.repositoryFieldnoteInstallations)
        .where(inArray(schema.repositoryFieldnoteInstallations.repositoryId, repositories));
      if (runs.length) {
        await db()
          .delete(schema.authoringNotes)
          .where(inArray(schema.authoringNotes.authoringRunId, runs));
        await db()
          .delete(schema.fieldnoteSetupFiles)
          .where(inArray(schema.fieldnoteSetupFiles.proposalRunId, runs));
        await db()
          .delete(schema.fieldnoteSetupProposals)
          .where(inArray(schema.fieldnoteSetupProposals.authoringRunId, runs));
      }
    }
    await db()
      .delete(schema.authoringRuns)
      .where(inArray(schema.authoringRuns.repositoryId, repositories));
    await db().delete(schema.repositories).where(inArray(schema.repositories.id, repositories));
    await db().delete(schema.installations).where(inArray(schema.installations.id, repositories));
  }
  await db().delete(schema.workspaces).where(eq(schema.workspaces.id, workspace));
  await db().delete(schema.users).where(eq(schema.users.id, owner));
  await closeDb();
});

async function repository() {
  const id = randomUUID();
  repositories.push(id);
  context.repositoryId = id;
  await db()
    .insert(schema.installations)
    .values({ id, githubInstallationId: id, accountLogin: 'octo', accountType: 'Organization' });
  await db().insert(schema.repositories).values({
    id,
    installationId: id,
    githubRepositoryId: id,
    owner: 'octo',
    name: 'repo',
    defaultBranch: 'main',
    isPrivate: false,
  });
  return id;
}

function run(
  repositoryId: string,
  overrides: Partial<typeof schema.authoringRuns.$inferInsert> = {},
) {
  return {
    id: randomUUID(),
    repositoryId,
    workflow: 'fieldnote-setup' as const,
    kind: 'plan' as const,
    requestedBy: owner,
    requestedWorkspaceId: workspace,
    state: 'running' as const,
    authorVersion: 'setup-v1',
    sha,
    ...overrides,
  };
}

async function plan(repositoryId?: string) {
  const value = run(repositoryId ?? (await repository()));
  await db().insert(schema.authoringRuns).values(value);
  return value;
}

async function proposal(planRunId: string) {
  await db()
    .insert(schema.fieldnoteSetupProposals)
    .values({
      authoringRunId: planRunId,
      repositorySha: sha,
      skillsRelease: '0.1.0',
      skillsRevision: 'b'.repeat(40),
      releaseLockHash: `sha256:${'c'.repeat(64)}`,
      detectedAgents: [],
      confirmedAgents: agents,
      state: 'awaiting-input',
    });
  await db()
    .insert(schema.fieldnoteSetupFiles)
    .values({
      id: randomUUID(),
      proposalRunId: planRunId,
      path: '.fieldnote/profile.yaml',
      kind: 'profile',
      body: 'version: 1',
      hash: `sha256:${'d'.repeat(64)}`,
    });
}

test('setup summary authorizes first and never exposes another repository run or PR', async () => {
  const { getSetupSummary } = await import('./queries/fieldnote-setup');
  const foreign = await plan();
  await proposal(foreign.id);
  const local = await repository();
  expect(await getSetupSummary(local, 'skills-v0.2.0')).toEqual({
    installation: { kind: 'missing', latest: 'skills-v0.2.0' },
    progress: null,
    latestAvailable: true,
  });
  expect((await getSetupSummary(local, 'skills-v0.2.0', foreign.id)).progress).toBeNull();
  await expect(getSetupSummary(foreign.repositoryId, 'skills-v0.2.0')).rejects.toThrow('not found');
});

test('setup summary selects the latest setup plan and its linked execute PR, ignoring readiness', async () => {
  const { getSetupSummary } = await import('./queries/fieldnote-setup');
  const id = await repository();
  const complete = { state: 'complete' as const, completedAt: new Date() };
  const old = run(id, { ...complete, createdAt: new Date('2026-01-01') });
  const latest = run(id, { ...complete, createdAt: new Date('2026-01-02') });
  const readiness = run(id, {
    ...complete,
    workflow: 'readiness-remediation',
    createdAt: new Date('2026-01-03'),
  });
  await db().insert(schema.authoringRuns).values([old, latest, readiness]);
  const oldExecute = run(id, { ...complete, kind: 'execute', planRunId: old.id });
  const execute = run(id, { ...complete, kind: 'execute', planRunId: latest.id });
  await db().insert(schema.authoringRuns).values([oldExecute, execute]);
  await db()
    .insert(schema.authoredPullRequests)
    .values([
      {
        id: randomUUID(),
        authoringRunId: oldExecute.id,
        repositoryId: id,
        number: 1,
        branch: 'old',
        headSha: sha,
        url: 'https://github.com/octo/repo/pull/1',
        outcome: 'closed',
        openedAt: new Date(),
      },
      {
        id: randomUUID(),
        authoringRunId: execute.id,
        repositoryId: id,
        number: 2,
        branch: 'new',
        headSha: sha,
        url: 'https://github.com/octo/repo/pull/2',
        outcome: 'open',
        openedAt: new Date(),
      },
    ]);
  const summary = await getSetupSummary(id, 'skills-v0.2.0');
  expect(summary.progress).toEqual({
    runId: latest.id,
    state: 'open',
    pullRequestUrl: 'https://github.com/octo/repo/pull/2',
  });
  expect(summary.installation.kind).toBe('proposed');
  expect((await getSetupSummary(id, 'skills-v0.2.0', old.id)).progress).toEqual({
    runId: old.id,
    state: 'closed',
    pullRequestUrl: 'https://github.com/octo/repo/pull/1',
  });
});

test('merged setup remains verifying until a newer installation observation and preserves release outage state', async () => {
  const { getSetupSummary, recordInstallationObservation } =
    await import('./queries/fieldnote-setup');
  const value = await plan();
  await db()
    .update(schema.authoringRuns)
    .set({ state: 'complete', completedAt: new Date() })
    .where(eq(schema.authoringRuns.id, value.id));
  const execute = run(value.repositoryId, {
    kind: 'execute',
    planRunId: value.id,
    state: 'complete',
    completedAt: new Date(),
  });
  await db().insert(schema.authoringRuns).values(execute);
  await db()
    .insert(schema.authoredPullRequests)
    .values({
      id: randomUUID(),
      authoringRunId: execute.id,
      repositoryId: value.repositoryId,
      number: 1,
      branch: 'setup',
      headSha: sha,
      url: 'https://github.com/octo/repo/pull/1',
      outcome: 'merged',
      openedAt: new Date('2026-01-01'),
      mergedAt: new Date('2026-01-02'),
    });
  expect((await getSetupSummary(value.repositoryId, null)).progress?.state).toBe('verifying');
  await recordInstallationObservation(value.repositoryId, {
    state: 'outdated',
    release: 'skills-v0.1.0',
    revision: sha,
    lockHash: 'hash',
    agents,
    commitSha: sha,
    reasons: [],
  });
  const summary = await getSetupSummary(value.repositoryId, null);
  expect(summary.progress).toBeNull();
  expect(summary.installation).toEqual({
    kind: 'outdated',
    installed: 'skills-v0.1.0',
    latest: '',
  });
  expect(summary.latestAvailable).toBe(false);
});

test('persists the workflow discriminator instead of treating setup as readiness', async () => {
  const value = await plan();
  const rows = await db().execute(
    sql`select to_jsonb(r) as row from authoring_runs r where id = ${value.id}`,
  );
  expect(rows[0].row).toMatchObject({ workflow: 'fieldnote-setup' });
});

test('generated migrations backfill pre-existing readiness rows and remove the temporary default', async () => {
  const databaseName = `setup_migration_${randomUUID().replaceAll('-', '')}_test`;
  const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${databaseName}`;
  await admin`create database ${admin(databaseName)}`;
  const connection = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    const migrations = readMigrationFiles({ migrationsFolder: 'drizzle' });
    for (const migration of migrations.slice(0, 20)) {
      for (const statement of migration.sql) await connection.unsafe(statement);
    }
    await connection`insert into users(id, login, credentials) values ('owner', 'owner', 'fixture')`;
    await connection`insert into workspaces(id, name) values ('workspace', 'workspace')`;
    await connection`insert into github_installations(id, github_installation_id, account_login, account_type) values ('installation', 'installation', 'octo', 'Organization')`;
    await connection`insert into repositories(id, installation_id, github_repository_id, owner, name, default_branch, is_private) values ('repository', 'installation', 'repository', 'octo', 'repo', 'main', false)`;
    await connection`insert into authoring_runs(id, repository_id, kind, requested_by, requested_workspace_id, state, author_version) values ('legacy', 'repository', 'plan', 'owner', 'workspace', 'queued', 'readiness-floor-v01')`;
    for (const migration of migrations.slice(20)) {
      for (const statement of migration.sql) await connection.unsafe(statement);
    }
    const [legacy] =
      await connection`select workflow, plan_run_id from authoring_runs where id = 'legacy'`;
    expect(legacy).toEqual({ workflow: 'readiness-remediation', plan_run_id: null });
    const [column] =
      await connection`select column_default from information_schema.columns where table_name = 'authoring_runs' and column_name = 'workflow'`;
    expect(column.column_default).toBeNull();
    const [reasonsColumn] =
      await connection`select data_type, udt_name from information_schema.columns where table_name = 'repository_fieldnote_installations' and column_name = 'reasons'`;
    expect(reasonsColumn).toEqual({ data_type: 'ARRAY', udt_name: '_text' });
  } finally {
    await connection.end();
    await admin`drop database ${admin(databaseName)}`;
    await admin.end();
  }
});

test.each(['detectedAgents', 'confirmedAgents'] as const)(
  'rejects malformed %s JSON on proposal write and load',
  async (field) => {
    const value = await plan();
    await proposal(value.id);
    const invalid =
      field === 'detectedAgents'
        ? [
            {
              agent: 'codex' as const,
              label: 'Codex',
              supported: true,
              confirmed: false,
              evidence: [],
              extra: 'untrusted',
            },
          ]
        : [
            {
              agent: 'codex' as const,
              supported: true,
              skillsRoot: '.agents/skills',
              extra: 'untrusted',
            },
          ];
    // Structurally compatible TypeScript values can still contain undeclared fields.
    await expect(
      db()
        .update(schema.fieldnoteSetupProposals)
        .set({ [field]: invalid })
        .where(eq(schema.fieldnoteSetupProposals.authoringRunId, value.id)),
    ).rejects.toThrow();
    // Bypass the application boundary to simulate malformed historical/external JSON.
    await db().execute(
      sql`update fieldnote_setup_proposals set ${sql.identifier(field === 'detectedAgents' ? 'detected_agents' : 'confirmed_agents')} = ${JSON.stringify(invalid)}::jsonb where authoring_run_id = ${value.id}`,
    );
    const { loadSetupPlan, readySetupAndQueueExecute } = await import('./queries/fieldnote-setup');
    await expect(loadSetupPlan(value.id)).rejects.toThrow();
    await expect(readySetupAndQueueExecute(value.id)).rejects.toThrow();
    const [stored] = await db()
      .select()
      .from(schema.authoringRuns)
      .where(eq(schema.authoringRuns.id, value.id));
    expect(stored.state).toBe('running');
    expect(
      await db()
        .select()
        .from(schema.authoringRuns)
        .where(eq(schema.authoringRuns.planRunId, value.id)),
    ).toEqual([]);
  },
);

test('rejects invalid installation agent JSON before persistence and when loading corrupted rows', async () => {
  const repositoryId = await repository();
  const { recordInstallationObservation } = await import('./queries/fieldnote-setup');
  const observation = {
    state: 'partial' as const,
    release: '0.1.0',
    revision: 'b'.repeat(40),
    lockHash: 'hash',
    agents,
    commitSha: sha,
    reasons: ['Missing profile', 'Missing skills'],
  };
  const invalidAgents = [{ ...agents[0], extra: 'untrusted' }];
  await expect(
    recordInstallationObservation(repositoryId, { ...observation, agents: invalidAgents }),
  ).rejects.toThrow();
  expect(
    await db()
      .select()
      .from(schema.repositoryFieldnoteInstallations)
      .where(eq(schema.repositoryFieldnoteInstallations.repositoryId, repositoryId)),
  ).toEqual([]);
  const stored = await recordInstallationObservation(repositoryId, observation);
  expect(stored.reasons).toEqual(['Missing profile', 'Missing skills']);
  await db().execute(
    sql`update repository_fieldnote_installations set agents = '[{"agent":"unknown","supported":true,"skillsRoot":".agents/skills"}]'::jsonb where repository_id = ${repositoryId}`,
  );
  await expect(
    db()
      .select()
      .from(schema.repositoryFieldnoteInstallations)
      .where(eq(schema.repositoryFieldnoteInstallations.repositoryId, repositoryId)),
  ).rejects.toThrow();
});

test('requires a linked plan for execute and forbids one for plan', async () => {
  const repositoryId = await repository();
  await expect(
    db()
      .insert(schema.authoringRuns)
      .values(run(repositoryId, { kind: 'execute', planRunId: null })),
  ).rejects.toThrow();
  const source = await plan(repositoryId);
  await expect(
    db()
      .insert(schema.authoringRuns)
      .values(run(await repository(), { planRunId: source.id })),
  ).rejects.toThrow();
});

test('makes readiness explicit and rejects unknown workflows', async () => {
  const value = run(await repository(), { workflow: 'readiness-remediation' });
  await db().insert(schema.authoringRuns).values(value);
  const [stored] = await db()
    .select()
    .from(schema.authoringRuns)
    .where(eq(schema.authoringRuns.id, value.id));
  expect(stored.workflow).toBe('readiness-remediation');
  await expect(
    db().execute(
      sql`insert into authoring_runs(id, repository_id, kind, requested_by, requested_workspace_id, state, author_version) values (${randomUUID()}, ${await repository()}, 'plan', ${owner}, ${workspace}, 'queued', 'v1')`,
    ),
  ).rejects.toThrow();
  await expect(
    db().execute(
      sql`insert into authoring_runs(id, repository_id, kind, workflow, requested_by, requested_workspace_id, state, author_version) values (${randomUUID()}, ${await repository()}, 'plan', 'unknown', ${owner}, ${workspace}, 'queued', 'v1')`,
    ),
  ).rejects.toThrow();
});

test('allows one proposal per plan and one generated file per proposal path', async () => {
  const value = await plan();
  await proposal(value.id);
  await expect(proposal(value.id)).rejects.toThrow();
  await expect(
    db().insert(schema.fieldnoteSetupFiles).values({
      id: randomUUID(),
      proposalRunId: value.id,
      path: '.fieldnote/profile.yaml',
      kind: 'profile',
      body: 'duplicate',
      hash: 'hash',
    }),
  ).rejects.toThrow();
});

test('atomically completes a plan and reuses one queued execute under concurrent ready calls', async () => {
  const value = await plan();
  await proposal(value.id);
  const { readySetupAndQueueExecute } = await import('./queries/fieldnote-setup');
  const results = await Promise.all([
    readySetupAndQueueExecute(value.id),
    readySetupAndQueueExecute(value.id),
  ]);
  expect(results[0]).toMatchObject({
    kind: 'execute',
    workflow: 'fieldnote-setup',
    planRunId: value.id,
    state: 'queued',
    repositoryId: value.repositoryId,
  });
  expect(results[1].id).toBe(results[0].id);
  expect((await readySetupAndQueueExecute(value.id)).id).toBe(results[0].id);
  const [stored] = await db()
    .select()
    .from(schema.authoringRuns)
    .where(eq(schema.authoringRuns.id, value.id));
  expect(stored).toMatchObject({ state: 'complete', sha });
  expect(stored.completedAt).toBeInstanceOf(Date);
  const [ready] = await db()
    .select()
    .from(schema.fieldnoteSetupProposals)
    .where(eq(schema.fieldnoteSetupProposals.authoringRunId, value.id));
  expect(ready.state).toBe('ready');
  await db()
    .update(schema.authoringRuns)
    .set({ state: 'failed' })
    .where(eq(schema.authoringRuns.id, results[0].id));
  await expect(
    db()
      .insert(schema.authoringRuns)
      .values(run(value.repositoryId, { kind: 'execute', planRunId: value.id })),
  ).rejects.toThrow();
});

test('failed ready validation leaves proposal and plan unchanged', async () => {
  const value = await plan();
  await proposal(value.id);
  await db()
    .update(schema.fieldnoteSetupProposals)
    .set({ confirmedAgents: null })
    .where(eq(schema.fieldnoteSetupProposals.authoringRunId, value.id));
  const { readySetupAndQueueExecute } = await import('./queries/fieldnote-setup');
  await expect(readySetupAndQueueExecute(value.id)).rejects.toThrow();
  const [stored] = await db()
    .select()
    .from(schema.authoringRuns)
    .where(eq(schema.authoringRuns.id, value.id));
  expect(stored.state).toBe('running');
  const [pending] = await db()
    .select()
    .from(schema.fieldnoteSetupProposals)
    .where(eq(schema.fieldnoteSetupProposals.authoringRunId, value.id));
  expect(pending.state).toBe('awaiting-input');
});

test('readiness queries and completion cannot consume a setup plan', async () => {
  const value = await plan();
  const { latestPlan, getPlan, listUndispatchedPlans, completeAuthoringRun } =
    await import('./queries/authoring-runs');
  expect(await latestPlan(value.repositoryId)).toBeNull();
  expect(await getPlan(value.repositoryId, value.id)).toBeNull();
  await expect(
    completeAuthoringRun(value.id, [
      { checkId: 'root-readme', path: 'README.md', rationale: 'missing', ordinal: 0 },
    ]),
  ).rejects.toThrow('Not a readiness plan');
  await db()
    .update(schema.authoringRuns)
    .set({ state: 'queued' })
    .where(eq(schema.authoringRuns.id, value.id));
  expect(await listUndispatchedPlans()).not.toContain(value.id);
});

test('notes have a stable tie-break order and browser reads authorize the repository', async () => {
  const value = await plan();
  const createdAt = new Date('2026-09-16T10:00:00Z');
  await db()
    .insert(schema.authoringNotes)
    .values([
      {
        id: `${value.id}-b`,
        authoringRunId: value.id,
        speaker: 'human',
        kind: 'answer',
        body: 'second',
        createdAt,
      },
      {
        id: `${value.id}-a`,
        authoringRunId: value.id,
        speaker: 'agent',
        kind: 'question',
        body: 'first',
        createdAt,
      },
    ]);
  const { getSetupPlan } = await import('./queries/fieldnote-setup');
  expect(
    (await getSetupPlan(value.repositoryId, value.id))?.notes.map((note) => note.body),
  ).toEqual(['first', 'second']);
  context.repositoryId = 'unauthorized';
  await expect(getSetupPlan(value.repositoryId, value.id)).rejects.toThrow('not found');
  context.repositoryId = value.repositoryId;
  expect(await getSetupPlan(value.repositoryId, randomUUID())).toBeNull();
});

test('setup collection and result retries persist one question, then concurrent answers consume it once', async () => {
  const value = await plan();
  const { saveSetupSnapshot, saveSetupResult, appendSetupAnswer, loadSetupPlan } =
    await import('./queries/fieldnote-setup');
  const identity = {
    release: 'skills-v0.1.0',
    revision: 'b'.repeat(40),
    releaseLockHash: `sha256:${'c'.repeat(64)}` as const,
  };
  const snapshot = {
    sha,
    complete: true,
    paths: ['AGENTS.md'],
    documents: [],
    candidates: [
      {
        agent: 'codex' as const,
        label: 'Codex',
        supported: true,
        confirmed: false,
        evidence: [{ source: 'path' as const, value: 'AGENTS.md' }],
      },
    ],
  };
  await saveSetupSnapshot(value.id, identity, snapshot);
  await saveSetupSnapshot(value.id, identity, snapshot);
  expect((await loadSetupPlan(value.id))?.proposal?.detectedAgents).toEqual(snapshot.candidates);
  const result = {
    state: 'awaiting-input' as const,
    findings: ['Found Codex'],
    confirmedFacts: [],
    nextQuestion: { key: 'agents' as const, text: 'Confirm Codex?', evidence: ['AGENTS.md'] },
    confirmedAgents: [],
    files: [],
    sandboxId: 'local',
    model: 'local',
  };
  await Promise.all([
    saveSetupResult(value.id, result, null),
    saveSetupResult(value.id, result, null),
  ]);
  let stored = (await loadSetupPlan(value.id))!;
  const question = stored.notes.filter((note) => note.kind === 'question');
  expect(question).toHaveLength(1);
  await Promise.all([
    appendSetupAnswer(value.repositoryId, value.id, question[0].id, 'Yes', agents),
    appendSetupAnswer(value.repositoryId, value.id, question[0].id, 'Yes', agents),
  ]);
  stored = (await loadSetupPlan(value.id))!;
  expect(stored.notes.filter((note) => note.kind === 'answer')).toHaveLength(1);
  expect(stored.proposal?.state).toBe('exploring');
  expect(stored.proposal?.confirmedAgents).toEqual(agents);
  const answerId = stored.notes.find((note) => note.kind === 'answer')!.id;
  const next = {
    ...result,
    confirmedAgents: agents,
    nextQuestion: {
      key: 'Tracker.kind' as const,
      text: 'Which tracker?',
      evidence: ['No tracker'],
    },
  };
  await Promise.all([
    saveSetupResult(value.id, next, answerId),
    saveSetupResult(value.id, next, answerId),
  ]);
  stored = (await loadSetupPlan(value.id))!;
  expect(stored.notes.filter((note) => note.kind === 'question')).toHaveLength(2);
  expect(stored.notes.filter((note) => note.kind === 'answer')).toHaveLength(1);
  await expect(
    appendSetupAnswer(value.repositoryId, value.id, question[0].id, 'stale', agents),
  ).rejects.toThrow();
});

test('ready author output and linked execute are committed atomically, including concurrent retries', async () => {
  const value = await plan();
  await proposal(value.id);
  await db()
    .update(schema.fieldnoteSetupProposals)
    .set({ state: 'exploring' })
    .where(eq(schema.fieldnoteSetupProposals.authoringRunId, value.id));
  const { saveSetupResult, loadSetupPlan } = await import('./queries/fieldnote-setup');
  const result = {
    state: 'ready' as const,
    findings: [],
    confirmedFacts: [],
    nextQuestion: null,
    confirmedAgents: agents,
    files: [
      {
        path: '.fieldnote/profile.md',
        content: '# Profile',
        kind: 'profile' as const,
        hash: `sha256:${'d'.repeat(64)}` as const,
      },
    ],
    sandboxId: 'local',
    model: 'local',
  };
  await Promise.all([
    saveSetupResult(value.id, result, null),
    saveSetupResult(value.id, result, null),
  ]);
  const stored = (await loadSetupPlan(value.id))!;
  expect(stored.run.state).toBe('complete');
  expect(stored.proposal?.state).toBe('ready');
  expect(stored.files.find((file) => file.path === '.fieldnote/profile.md')?.body).toBe(
    '# Profile',
  );
  expect(
    await db()
      .select()
      .from(schema.authoringRuns)
      .where(eq(schema.authoringRuns.planRunId, value.id)),
  ).toHaveLength(1);
});

test('nonempty confirmed facts round-trip and survive a subsequent output containing only new facts', async () => {
  const value = await plan();
  await proposal(value.id);
  await db()
    .update(schema.fieldnoteSetupProposals)
    .set({ state: 'exploring' })
    .where(eq(schema.fieldnoteSetupProposals.authoringRunId, value.id));
  const { saveSetupResult, loadSetupPlan, appendSetupAnswer } =
    await import('./queries/fieldnote-setup');
  const confirmedFacts = [
    { key: 'Commands.check' as const, value: 'pnpm test', evidence: ['package.json scripts.test'] },
  ];
  const first = {
    state: 'awaiting-input' as const,
    findings: [],
    confirmedFacts,
    nextQuestion: { key: 'Tracker.kind' as const, text: 'Which tracker?', evidence: ['Not found'] },
    confirmedAgents: agents,
    files: [],
    sandboxId: 'local',
    model: 'local',
  };
  await saveSetupResult(value.id, first, null);
  let stored = (await loadSetupPlan(value.id))!;
  expect(stored.proposal?.confirmedFacts).toEqual(confirmedFacts);
  expect(stored.notes.map((note) => note.kind)).toEqual(['question']);
  const answerId = await appendSetupAnswer(
    value.repositoryId,
    value.id,
    stored.notes[0].id,
    'github',
    agents,
  );
  const nextFact = { key: 'Tracker.kind' as const, value: 'github', evidence: ['Human answer'] };
  await saveSetupResult(
    value.id,
    {
      ...first,
      confirmedFacts: [nextFact],
      nextQuestion: { key: 'Tracker.repo', text: 'Which repository?', evidence: ['Not found'] },
    },
    answerId,
  );
  stored = (await loadSetupPlan(value.id))!;
  expect(stored.proposal?.confirmedFacts).toEqual([...confirmedFacts, nextFact]);
});

test('confirmed facts reject malformed JSON on write and on load', async () => {
  const value = await plan();
  await proposal(value.id);
  const invalid = [
    { key: 'Commands.check' as const, value: 'pnpm test', evidence: ['CI'], extra: 'untrusted' },
  ];
  await expect(
    db()
      .update(schema.fieldnoteSetupProposals)
      .set({ confirmedFacts: invalid })
      .where(eq(schema.fieldnoteSetupProposals.authoringRunId, value.id)),
  ).rejects.toThrow();
  await db().execute(
    sql`update fieldnote_setup_proposals set confirmed_facts = '[{"key":"unknown","value":"anything","evidence":["CI"]}]'::jsonb where authoring_run_id = ${value.id}`,
  );
  const { loadSetupPlan } = await import('./queries/fieldnote-setup');
  await expect(loadSetupPlan(value.id)).rejects.toThrow();
});

test('failed ready validation rolls back generated files, notes, and model provenance', async () => {
  const value = await plan();
  await proposal(value.id);
  await db()
    .update(schema.fieldnoteSetupProposals)
    .set({ state: 'exploring' })
    .where(eq(schema.fieldnoteSetupProposals.authoringRunId, value.id));
  const { saveSetupResult, loadSetupPlan } = await import('./queries/fieldnote-setup');
  await expect(
    saveSetupResult(
      value.id,
      {
        state: 'ready',
        findings: ['new finding'],
        confirmedFacts: [],
        nextQuestion: null,
        confirmedAgents: [],
        files: [
          {
            path: '.fieldnote/profile.md',
            content: 'profile',
            kind: 'profile',
            hash: `sha256:${'d'.repeat(64)}`,
          },
        ],
        sandboxId: 'local',
        model: 'local',
      },
      null,
    ),
  ).rejects.toThrow();
  const stored = (await loadSetupPlan(value.id))!;
  expect(stored.run).toMatchObject({ state: 'running', model: null });
  expect(stored.notes).toEqual([]);
  expect(stored.files.map((file) => file.path)).toEqual(['.fieldnote/profile.yaml']);
});

test('PR identity is unique per repository, repairs are bounded, and opening a PR does not install', async () => {
  const value = await plan();
  await proposal(value.id);
  const { readySetupAndQueueExecute, recordAuthoredPullRequest, recordInstallationObservation } =
    await import('./queries/fieldnote-setup');
  const execute = await readySetupAndQueueExecute(value.id);
  const pr = await recordAuthoredPullRequest({
    authoringRunId: execute.id,
    repositoryId: value.repositoryId,
    number: 42,
    branch: 'fieldnote/setup',
    headSha: sha,
    url: 'https://github.com/octo/repo/pull/42',
    outcome: 'open',
    openedAt: new Date(),
  });
  const { id: prId, ...samePr } = pr;
  expect((await recordAuthoredPullRequest(samePr)).id).toBe(prId);
  await expect(recordAuthoredPullRequest({ ...samePr, number: 43 })).rejects.toThrow(
    'different pull request',
  );
  const rows = await db()
    .select()
    .from(schema.repositoryFieldnoteInstallations)
    .where(eq(schema.repositoryFieldnoteInstallations.repositoryId, value.repositoryId));
  expect(rows).toEqual([]);
  await db()
    .update(schema.authoringRuns)
    .set({ state: 'failed' })
    .where(eq(schema.authoringRuns.id, execute.id));
  const other = run(value.repositoryId, { state: 'failed' });
  await db().insert(schema.authoringRuns).values(other);
  await expect(
    db()
      .insert(schema.authoredPullRequests)
      .values({ ...pr, id: randomUUID(), authoringRunId: other.id }),
  ).rejects.toThrow();
  const repair = {
    id: randomUUID(),
    authoredPullRequestId: pr.id,
    ordinal: 1,
    triggerKind: 'ci',
    triggerReference: 'check-1',
    state: 'queued' as const,
    baseHeadSha: sha,
  };
  for (const ordinal of [0, 4])
    await expect(
      db()
        .insert(schema.authoredPullRequestRepairs)
        .values({ ...repair, ordinal }),
    ).rejects.toThrow();
  await db().insert(schema.authoredPullRequestRepairs).values(repair);
  await expect(
    db()
      .insert(schema.authoredPullRequestRepairs)
      .values({ ...repair, id: randomUUID() }),
  ).rejects.toThrow();
  await recordInstallationObservation(value.repositoryId, {
    state: 'partial',
    release: '0.1.0',
    revision: 'b'.repeat(40),
    lockHash: 'hash',
    agents,
    commitSha: sha,
    reasons: ['Missing profile'],
  });
  await recordInstallationObservation(value.repositoryId, {
    state: 'current',
    release: '0.1.0',
    revision: 'b'.repeat(40),
    lockHash: 'hash',
    agents,
    commitSha: sha,
    reasons: [],
  });
  expect(
    await db()
      .select()
      .from(schema.repositoryFieldnoteInstallations)
      .where(
        and(
          eq(schema.repositoryFieldnoteInstallations.repositoryId, value.repositoryId),
          eq(schema.repositoryFieldnoteInstallations.state, 'current'),
        ),
      ),
  ).toHaveLength(1);
});
