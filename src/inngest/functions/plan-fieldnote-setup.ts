import { NonRetriableError } from 'inngest';
import { inngest } from '../client';
import { fieldnoteSetupPlanRequestedData } from '../events';
import {
  beginAuthoring,
  failAuthoringRun,
  pinAuthoringSha,
  validateAuthoringRun,
} from '../../db/queries/authoring-runs';
import {
  loadSetupPlan,
  saveSetupSnapshot,
  saveSetupResult,
  type SetupReleaseIdentity,
} from '../../db/queries/fieldnote-setup';
import { latestSkillsRelease } from '../../fieldnote-skills/github-release';
import { resolveHeadSha } from '../../github/collect-files';
import { collectFieldnoteSetup } from '../../github/collect-fieldnote-setup';
import { authorPinnedSetup } from '../../authoring/fieldnote-setup';

async function validated(runId: string) {
  const plan = await loadSetupPlan(runId);
  if (!plan || !['queued', 'running'].includes(plan.run.state)) return null;
  try {
    await validateAuthoringRun(plan.run);
  } catch {
    await failAuthoringRun(runId, 'access_revoked');
    throw new NonRetriableError('Setup unavailable');
  }
  return plan;
}

export const planFieldnoteSetupFunction = inngest.createFunction(
  {
    id: 'plan-fieldnote-setup',
    triggers: [{ event: 'repository/fieldnote.setup.plan.requested' }],
    retries: 3,
    singleton: { key: 'event.data.runId', mode: 'skip' },
    onFailure: async ({ event }) => {
      await failAuthoringRun(fieldnoteSetupPlanRequestedData.parse(event.data.event.data).runId);
    },
  },
  async ({ event, step }) => {
    const { runId } = fieldnoteSetupPlanRequestedData.parse(event.data);
    const active = await step.run('begin', async () => {
      const plan = await validated(runId);
      if (!plan || plan.proposal?.state === 'awaiting-input' || plan.proposal?.state === 'ready')
        return false;
      return (await beginAuthoring(runId))?.state === 'running';
    });
    if (!active) return;
    const release = await step.run(
      'pin-release',
      async (): Promise<SetupReleaseIdentity | null> => {
        const plan = await validated(runId);
        if (!plan) return null;
        if (plan.proposal)
          return {
            release: plan.proposal.skillsRelease,
            revision: plan.proposal.skillsRevision,
            releaseLockHash: plan.proposal.releaseLockHash as `sha256:${string}`,
          };
        try {
          const latest = await latestSkillsRelease();
          return {
            release: latest.release,
            revision: latest.revision,
            releaseLockHash: latest.releaseLockHash,
          };
        } catch {
          throw new Error('Setup release resolution failed');
        }
      },
    );
    if (!release) return;
    const sha = await step.run('pin-commit', async () => {
      const plan = await validated(runId);
      if (!plan) return null;
      if (plan.run.sha) return plan.run.sha;
      try {
        return await pinAuthoringSha(runId, await resolveHeadSha(plan.run.repositoryId));
      } catch {
        throw new Error('Setup commit resolution failed');
      }
    });
    if (!sha) return;
    await step.run('collect', async () => {
      const plan = await validated(runId);
      if (
        !plan ||
        (plan.proposal && plan.proposal.state !== 'exploring') ||
        plan.notes.some((note) => note.kind === 'answer')
      )
        return;
      try {
        const snapshot = await collectFieldnoteSetup(plan.run.repositoryId, sha);
        if (!(await validated(runId))) return;
        await saveSetupSnapshot(runId, release, snapshot);
        const result = await authorPinnedSetup(
          release,
          snapshot,
          plan.notes,
          plan.proposal?.confirmedAgents ?? [],
        );
        if (!(await validated(runId))) return;
        await saveSetupResult(runId, result, null);
      } catch {
        throw new Error('Setup collection failed');
      }
      // Repository documents and model output never enter step outputs.
    });
    await step.run('explore', async () => {
      // collect persisted the first turn atomically. Later turns are ordinary
      // Server Functions; this durable step returns only their polling identity.
      const plan = await validated(runId);
      return plan ? { runId: plan.run.id } : null;
    });
  },
);
