import { NonRetriableError } from 'inngest';
import { inngest } from '../client';
import { gradeRequestedData } from '../events';
import {
  beginGrade,
  loadGradeRun,
  pinGradeSha,
  validateGradeRun,
  completeGrade,
  failGrade,
} from '../../db/queries/grade-runs';
import {
  resolveReadinessSha,
  collectReadiness,
  ReadinessCollectionError,
} from '../../github/collect-readiness';
import { getGrader } from '../../domain/grading/registry';
import { runDeclarative } from '../../domain/grading/declarative';

async function validated(runId: string) {
  const run = await loadGradeRun(runId);
  if (!run || !['queued', 'running'].includes(run.state)) return null;
  try {
    await validateGradeRun(run);
  } catch {
    await failGrade(runId, 'access_revoked');
    throw new NonRetriableError('Grade unavailable');
  }
  return run;
}
async function collectionFailure(runId: string, error: unknown): Promise<never> {
  if (error instanceof ReadinessCollectionError && !error.retryable) {
    await failGrade(runId);
    throw new NonRetriableError('Repository evidence unavailable');
  }
  // Never let provider exceptions (request headers or source) enter Inngest logs.
  throw new Error('Repository evidence collection failed');
}
export async function resolveGradeCommit(runId: string) {
  const run = await validated(runId);
  if (!run) return null;
  if (run.sha) return run.sha;
  try {
    return await pinGradeSha(runId, await resolveReadinessSha(run.repositoryId));
  } catch (error) {
    return collectionFailure(runId, error);
  }
}
export async function evaluateGradeRun(runId: string) {
  const run = await validated(runId);
  if (!run) return;
  if (!run.sha) throw new NonRetriableError('Grade commit is missing');
  try {
    const manifest = getGrader(run.graderId);
    // Slice 1 has no evidence broker: collectReadiness supplies repo.files and
    // nothing else, so a manifest that needs anything more must not silently
    // be graded against the files collector. Slice 3 replaces this assertion
    // with the broker.
    if (Object.keys(manifest.needs).join() !== 'repo.files')
      throw new NonRetriableError('Grader needs evidence fieldnote cannot yet collect');
    const snapshot = await collectReadiness(run.repositoryId, run.sha);
    const result = runDeclarative(manifest, snapshot);
    if (result.score === null) {
      await failGrade(runId, 'incomplete_collection');
      return;
    }
    // Recheck authorization after collection too; result contains metadata only.
    if (!(await validated(runId))) return;
    await completeGrade(runId, result);
  } catch (error) {
    return collectionFailure(runId, error);
  }
}
export const gradeRepositoryFunction = inngest.createFunction(
  {
    id: 'grade-repository',
    triggers: [{ event: 'repository/grade.requested' }],
    retries: 3,
    singleton: { key: 'event.data.runId', mode: 'skip' },
    onFailure: async ({ event }) => {
      await failGrade(gradeRequestedData.parse(event.data.event.data).runId);
    },
  },
  async ({ event, step }) => {
    const { runId } = gradeRequestedData.parse(event.data);
    const active = await step.run('begin', async () => {
      if (!(await validated(runId))) return false;
      return (await beginGrade(runId))?.state === 'running';
    });
    if (!active) return;
    await step.run('pin-commit', () => resolveGradeCommit(runId));
    // Raw source never becomes a durable step output.
    await step.run('collect-evaluate-complete', () => evaluateGradeRun(runId));
  },
);
