import { NonRetriableError } from 'inngest';
import { inngest } from '../client';
import { authoringPlanRequestedData } from '../events';
import {
  beginAuthoring,
  completeAuthoringRun,
  failAuthoringRun,
  loadAuthoringRun,
  pinAuthoringSha,
  validateAuthoringRun,
} from '../../db/queries/authoring-runs';
import { latestCompletedGrade } from '../../db/queries/grade-runs';
import { AGENT_READINESS } from '../../domain/grading/graders/agent-readiness';
import { resolveReadinessSha } from '../../github/collect-readiness';
import { proposeRemedies } from '../../domain/act/remedies';

async function validated(runId: string) {
  const run = await loadAuthoringRun(runId);
  if (!run || !['queued', 'running'].includes(run.state)) return null;
  try {
    await validateAuthoringRun(run);
  } catch {
    await failAuthoringRun(runId, 'access_revoked');
    throw new NonRetriableError('Plan unavailable');
  }
  return run;
}

export async function resolvePlanCommit(runId: string) {
  const run = await validated(runId);
  if (!run) return null;
  if (run.sha) return run.sha;
  try {
    return await pinAuthoringSha(runId, await resolveReadinessSha(run.repositoryId));
  } catch {
    // Never let provider exceptions (request headers or source) enter Inngest logs.
    throw new Error('Plan commit resolution failed');
  }
}

// The deterministic floor. No sandbox, no model, no repository source: the
// grade already observed what is missing, and this turns that into one remedy
// per failing check. Plan 2b replaces the body and keeps the step name.
export async function explorePlan(runId: string) {
  const run = await validated(runId);
  if (!run) return;
  if (!run.sha) throw new NonRetriableError('Plan commit is missing');
  const grade = await latestCompletedGrade(run.repositoryId, AGENT_READINESS);
  if (!grade) {
    await failAuthoringRun(runId, 'grade_missing');
    return;
  }
  const remedies = proposeRemedies(grade);
  if (!remedies.length) {
    // The grade was re-run and now passes, or its rubric moved on. A run that
    // completes with no remedies would read as a plan that found nothing to
    // do, which is a different claim.
    await failAuthoringRun(runId, 'nothing_to_fix');
    return;
  }
  // Recheck authorization after the reads; remedies contain metadata only.
  if (!(await validated(runId))) return;
  await completeAuthoringRun(runId, remedies);
}

export const planRepositoryFunction = inngest.createFunction(
  {
    id: 'plan-repository',
    triggers: [{ event: 'repository/authoring.plan.requested' }],
    retries: 3,
    singleton: { key: 'event.data.runId', mode: 'skip' },
    onFailure: async ({ event }) => {
      await failAuthoringRun(authoringPlanRequestedData.parse(event.data.event.data).runId);
    },
  },
  async ({ event, step }) => {
    const { runId } = authoringPlanRequestedData.parse(event.data);
    const active = await step.run('begin', async () => {
      if (!(await validated(runId))) return false;
      return (await beginAuthoring(runId))?.state === 'running';
    });
    if (!active) return;
    await step.run('pin-commit', () => resolvePlanCommit(runId));
    // Returns nothing: findings go to Postgres, never into a step output.
    await step.run('explore', () => explorePlan(runId));
  },
);
