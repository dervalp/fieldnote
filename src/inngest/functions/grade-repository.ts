import { NonRetriableError } from 'inngest';
import { inngest } from '../client';
import { gradeRequestedData } from '../events';
import {
  beginGrade,
  loadGradeRun,
  pinGradeSha,
  pinnedManifest,
  validateGradeRun,
  completeGrade,
  failGrade,
  insufficientGrade,
} from '../../db/queries/grade-runs';
import { resolveHeadSha, FileCollectionError } from '../../github/collect-files';
import { collectEvidence, ConsentError } from '../../grading/evidence';
import { installedGrader } from '../../db/queries/graders';
import { GraderFailedError } from '../../domain/grading/code';
import { evaluate, sandboxFor } from '../../grading/evaluate';
import { SandboxUnavailableError } from '../../grading/sandbox/errors';

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
  // Same input, same result: a program that failed once fails again.
  if (error instanceof GraderFailedError) {
    await failGrade(runId, 'grader_failed');
    throw new NonRetriableError('Grader failed');
  }
  if (error instanceof ConsentError) {
    await failGrade(runId, 'consent_required');
    throw new NonRetriableError('Grader needs exceed consent');
  }
  if (error instanceof SandboxUnavailableError) {
    if (!error.retryable) {
      await failGrade(runId, 'sandbox_unavailable');
      throw new NonRetriableError('Grading sandbox unavailable');
    }
    // Rethrown fresh and under its own name, so no vendor message rides along
    // and onFailure can still tell an outage from fieldnote failing to read.
    throw new SandboxUnavailableError(true);
  }
  // Never let provider exceptions (request headers or source) enter Inngest logs.
  throw new Error('Repository evidence collection failed');
}

/**
 * The code a run records when Inngest's retries are spent. Inngest's StepError
 * keeps the original error's name, so an outage that outlasted every retry is
 * stored as an outage rather than as fieldnote failing to read the repository.
 */
export function finalFailureCode(error: { name?: string } | undefined) {
  return error?.name === 'SandboxUnavailableError' ? ('sandbox_unavailable' as const) : undefined;
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
  // Resolved before the try below: a run whose workspace never installed the
  // grader is not a collection failure, and must not be re-wrapped by
  // collectionFailure's generic fallback.
  const installed = await installedGrader(run.requestedWorkspaceId, run.graderId);
  if (!installed) {
    await failGrade(runId, 'consent_required');
    throw new NonRetriableError('Grader is not installed');
  }
  try {
    const manifest = await pinnedManifest(run.graderId, run.rubricVersion);
    // Before collecting: no sandbox should cost no GitHub calls.
    const sandbox = sandboxFor(manifest);
    const collected = await collectEvidence(
      manifest,
      run.repositoryId,
      run.sha,
      run.createdAt,
      installed.consentedNeeds,
    );
    const { result, verdict } = await evaluate(manifest, collected, sandbox);
    // A failure stores nothing: its check results failed for want of evidence,
    // not for want of the thing they measure.
    if (verdict === 'incomplete') {
      await failGrade(runId, collected.incompleteCode ?? undefined);
      return;
    }
    // Recheck authorization after collection, before storing anything.
    if (!(await validated(runId))) return;
    if (verdict === 'insufficient') await insufficientGrade(runId, result);
    else await completeGrade(runId, result);
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
    onFailure: async ({ event, error }) => {
      await failGrade(gradeRequestedData.parse(event.data.event.data).runId, finalFailureCode(error));
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
