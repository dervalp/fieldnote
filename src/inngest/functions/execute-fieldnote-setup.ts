import { inngest } from '../client';
import { NonRetriableError } from 'inngest';
import { fieldnoteSetupExecuteRequestedData } from '../events';
import {
  beginAuthoring,
  failAuthoringRun,
  loadAuthoringRun,
  validateAuthoringRun,
} from '../../db/queries/authoring-runs';
import {
  completeSetupExecute,
  loadSetupPlan,
  recordAuthoredPullRequest,
  reopenSetupPlan,
} from '../../db/queries/fieldnote-setup';
import { fetchGrantedPermissions } from '../../github/installation-permissions';
import { actAvailability } from '../../domain/act/availability';
import { collectFieldnoteSetup } from '../../github/collect-fieldnote-setup';
import { resolveHeadSha } from '../../github/collect-files';
import { readSkillsRelease } from '../../fieldnote-skills/github-release';
import { renderInstallation, verifyInstallation } from '../../domain/fieldnote-skills/render';
import { sha256 } from '../../domain/fieldnote-skills/lock';
import { repositoryClient } from '../../github/repositories';
import { SetupWriteError, writeAuthoredPullRequest } from '../../github/write-authored-pr';
import { inspectSetupDrift } from '../../fieldnote-skills/setup-drift';
import { hasManagedDriftApproval } from '../../domain/fieldnote-skills/drift';
import type { SetupRepositorySnapshot } from '../../domain/fieldnote-skills/types';

async function activeSetup(runId: string, proposalUpdatedAt: string) {
  const run = await loadAuthoringRun(runId);
  if (
    !run ||
    run.kind !== 'execute' ||
    run.workflow !== 'fieldnote-setup' ||
    !run.planRunId ||
    !['queued', 'running'].includes(run.state)
  )
    return null;
  const plan = await loadSetupPlan(run.planRunId);
  if (
    !plan?.proposal ||
    plan.run.repositoryId !== run.repositoryId ||
    plan.proposal.state !== 'ready' ||
    plan.proposal.updatedAt.toISOString() !== proposalUpdatedAt
  )
    return null;
  return { run, plan, proposal: plan.proposal };
}

async function validated(runId: string, proposalUpdatedAt: string) {
  const context = await activeSetup(runId, proposalUpdatedAt);
  if (!context) return null;
  const { run } = context;
  try {
    await validateAuthoringRun(run);
  } catch {
    await failAuthoringRun(runId, 'access_revoked');
    throw new NonRetriableError('Setup unavailable');
  }
  let permissions;
  try {
    permissions = await fetchGrantedPermissions(run.repositoryId);
  } catch {
    // An unavailable lookup proves no denial. Leave this generation active so
    // Inngest can retry; no provider details cross the worker boundary.
    throw new SetupWriteError('github_unavailable');
  }
  if (!actAvailability({ enabled: true, permissions, failingCheckCount: 1 }).available) {
    await failAuthoringRun(runId, 'access_revoked');
    throw new NonRetriableError('Setup unavailable');
  }
  return context;
}

async function rendered(context: NonNullable<Awaited<ReturnType<typeof validated>>>) {
  const { run, plan, proposal } = context;
  const release = await readSkillsRelease(proposal.skillsRelease);
  if (
    release.revision !== proposal.skillsRevision ||
    release.releaseLockHash !== proposal.releaseLockHash ||
    !proposal.confirmedAgents?.some((agent) => agent.supported) ||
    plan.files.some((file) => sha256(file.body) !== file.hash)
  )
    throw new Error('Invalid persisted setup');
  const result = renderInstallation({
    release,
    setupRunId: run.id,
    agents: proposal.confirmedAgents,
    configuration: plan.files.map((file) => ({ path: file.path, content: file.body })),
  });
  if (
    verifyInstallation({ commitSha: proposal.repositorySha, files: result.files }, release)
      .state !== 'current'
  )
    throw new Error('Invalid rendered setup');
  return result;
}

async function driftApproved(
  context: NonNullable<Awaited<ReturnType<typeof validated>>>,
  snapshot: SetupRepositorySnapshot,
) {
  const question = await inspectSetupDrift(snapshot, {
    release: context.proposal.skillsRelease,
    revision: context.proposal.skillsRevision,
    releaseLockHash: context.proposal.releaseLockHash as `sha256:${string}`,
  });
  if (!question || hasManagedDriftApproval(context.plan.notes, question)) return true;
  await reopenSetupPlan(context.run.id, snapshot, 'setup_conflict', question);
  return false;
}

export const executeFieldnoteSetupFunction = inngest.createFunction(
  {
    id: 'execute-fieldnote-setup',
    triggers: [{ event: 'repository/fieldnote.setup.execute.requested' }],
    retries: 3,
    concurrency: { limit: 1, key: 'event.data.runId' },
    onFailure: async ({ event }) => {
      const data = fieldnoteSetupExecuteRequestedData.parse(event.data.event.data);
      const context = await activeSetup(data.runId, data.proposalUpdatedAt);
      if (context) await failAuthoringRun(data.runId, 'setup_failed');
    },
  },
  async ({ event, step }) => {
    const { runId, proposalUpdatedAt } = fieldnoteSetupExecuteRequestedData.parse(event.data);
    const load = () => validated(runId, proposalUpdatedAt);
    const active = await step.run('begin', async () => {
      if (!(await load())) return false;
      return (await beginAuthoring(runId))?.state === 'running';
    });
    if (!active) return;
    const refresh = await step.run('refresh', async () => {
      const context = await load();
      if (!context) return null;
      try {
        const sha = await resolveHeadSha(context.run.repositoryId);
        const snapshot = await collectFieldnoteSetup(context.run.repositoryId, sha);
        const original =
          sha === context.proposal.repositorySha
            ? snapshot
            : await collectFieldnoteSetup(context.run.repositoryId, context.proposal.repositorySha);
        const evidence = (value: typeof snapshot) =>
          JSON.stringify([
            value.paths,
            value.documents.map(({ path, blobSha }) => ({ path, blobSha })),
            value.managedFiles,
          ]);
        if (!snapshot.complete || !original.complete || evidence(snapshot) !== evidence(original)) {
          if (await load()) await reopenSetupPlan(runId, snapshot, 'setup_conflict');
          return null;
        }
        if (!(await driftApproved(context, snapshot))) return null;
        return { sha, evidenceCount: snapshot.documents.length };
      } catch (error) {
        if (error instanceof NonRetriableError) throw error;
        throw new Error('Setup refresh failed');
      }
    });
    if (!refresh) return;
    const lockHash = await step.run('render', async () => {
      const context = await load();
      if (!context) return null;
      try {
        return (await rendered(context)).lockHash;
      } catch {
        throw new Error('Setup rendering failed');
      }
    });
    if (!lockHash) return;
    const written = await step.run('write-pr', async () => {
      const context = await load();
      if (!context) return false;
      try {
        // Also protect resumed workers whose refresh step was cached before this check existed.
        if (
          !(await driftApproved(
            context,
            await collectFieldnoteSetup(context.run.repositoryId, refresh.sha),
          ))
        )
          return false;
        // Rebuild inside this step: durable step output carries only the lock
        // digest, never upstream skills or repository source.
        const installation = await rendered(context);
        if (installation.lockHash !== lockHash) throw new Error('Setup changed');
        const { repo, client } = await repositoryClient(context.run.repositoryId);
        const pr = await writeAuthoredPullRequest(
          {
            owner: repo.owner,
            repo: repo.name,
            runId,
            commitDate: context.run.createdAt.toISOString(),
            proposalBaseSha: context.proposal.repositorySha,
            expectedBaseSha: refresh.sha,
            release: context.proposal.skillsRelease,
            revision: context.proposal.skillsRevision,
            files: installation.files,
            agents: context.proposal.confirmedAgents!,
            evidenceCount: refresh.evidenceCount,
            authorize: async () => {
              try {
                if (!(await load())) throw new SetupWriteError('access_revoked');
              } catch (error) {
                if (error instanceof NonRetriableError) throw new SetupWriteError('access_revoked');
                throw error;
              }
            },
          },
          client,
        );
        await recordAuthoredPullRequest({
          authoringRunId: runId,
          repositoryId: context.run.repositoryId,
          ...pr,
          outcome: 'open',
          openedAt: new Date(),
        });
        return true;
      } catch (error) {
        if (error instanceof SetupWriteError && error.code === 'setup_conflict') {
          try {
            if (await load()) {
              const sha = await resolveHeadSha(context.run.repositoryId);
              await reopenSetupPlan(
                runId,
                await collectFieldnoteSetup(context.run.repositoryId, sha),
                'setup_conflict',
              );
            }
            return false;
          } catch {
            throw new Error('Setup refresh failed');
          }
        }
        if (error instanceof SetupWriteError && error.code === 'access_revoked') {
          await failAuthoringRun(runId, 'access_revoked');
          throw new NonRetriableError('Setup unavailable');
        }
        if (error instanceof SetupWriteError && error.code === 'github_unavailable') throw error;
        throw new Error('Setup pull request failed');
      }
    });
    if (written)
      await step.run('complete', async () => {
        try {
          await completeSetupExecute(runId);
        } catch {
          throw new Error('Setup completion failed');
        }
      });
  },
);
