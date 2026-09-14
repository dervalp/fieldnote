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
  insufficientGrade,
} from '../../db/queries/grade-runs';
import { resolveHeadSha, FileCollectionError } from '../../github/collect-files';
import { collectEvidence } from '../../grading/evidence';
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
  if (error instanceof FileCollectionError && !error.retryable) {
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
    return await pinGradeSha(runId, await resolveHeadSha(run.repositoryId));
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
    const { snapshot, incompleteCode } = await collectEvidence(
      manifest,
      run.repositoryId,
      run.sha,
      run.createdAt,
    );
    const result = runDeclarative(manifest, snapshot);
    if (result.score === null) {
      // Two reasons a run has no score, and they belong to different authors.
      // "Not enough merged work to judge" is the grader's, and its result is
      // worth storing and reading. Collection failing is fieldnote's, and its
      // check results are noise — they failed for want of evidence, not for
      // want of the thing they measure.
      if (incompleteCode === 'insufficient_evidence') {
        // Recheck authorization before storing, as the complete path does.
        if (!(await validated(runId))) return;
        await insufficientGrade(runId, result);
        return;
      }
      await failGrade(runId, incompleteCode ?? undefined);
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
