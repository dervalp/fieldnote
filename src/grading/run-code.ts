import {
  assembleCodeResult,
  codeGraderInput,
  GraderFailedError,
  type CodeEvaluation,
} from '../domain/grading/code';
import type { CodeManifest } from '../domain/grading/manifest';
import type { RepositorySnapshot } from '../domain/grading/types';
import { graderCommand, RUNNER_SOURCE } from './sandbox/runner';
import type { ExecResult, Sandbox } from './sandbox/port';

export const GRADER_LIMITS = { timeoutMs: 20_000, maxOutputBytes: 256 * 1024 };

/**
 * One box per run: create it, write the program, the runner and the evidence,
 * run once, destroy it whatever happened. A program's failure is
 * GraderFailedError; a substrate failure is the adapter's
 * SandboxUnavailableError, passed through untouched.
 */
export async function runCodeGrader(
  manifest: CodeManifest,
  snapshot: RepositorySnapshot,
  sandbox: Sandbox,
): Promise<CodeEvaluation> {
  const input = codeGraderInput(manifest, snapshot);
  const handle = await sandbox.create();
  let execution: ExecResult;
  try {
    await sandbox.write(handle, 'grader.mjs', manifest.code.source);
    await sandbox.write(handle, 'run.mjs', RUNNER_SOURCE);
    await sandbox.write(handle, 'input.json', JSON.stringify(input));
    execution = await sandbox.exec(handle, graderCommand(handle.root), GRADER_LIMITS);
  } finally {
    // A destroy that fails is swallowed: the box's own lifetime ends it, and a
    // cleanup error must not replace the run's real outcome.
    await sandbox.destroy(handle).catch(() => undefined);
  }
  if (execution.timedOut || execution.overflowed || execution.exitCode !== 0)
    throw new GraderFailedError('The grader program did not finish.');
  let answer: unknown;
  try {
    answer = JSON.parse(execution.stdout);
  } catch {
    throw new GraderFailedError('The grader program printed something that is not JSON.');
  }
  return assembleCodeResult(manifest, input, answer);
}
