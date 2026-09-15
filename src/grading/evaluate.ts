import { INCOMPLETE, runDeclarative } from '../domain/grading/declarative';
import type { GraderManifest } from '../domain/grading/manifest';
import type { GradeResult } from '../domain/grading/types';
import type { CollectedEvidence } from './evidence';
import { runCodeGrader } from './run-code';
import { selectSandbox } from './sandbox';
import type { Sandbox } from './sandbox/port';

export type Evaluation = {
  result: GradeResult;
  verdict: 'scored' | 'insufficient' | 'incomplete';
};

/**
 * The sandbox a grader will need, chosen before anything is collected: a code
 * grader with no sandbox fails at once instead of after spending GitHub calls
 * on evidence nothing can grade. A declarative grader needs none. The branch
 * is on the manifest's kind, never a grader id.
 */
export function sandboxFor(manifest: GraderManifest): Sandbox | null {
  return manifest.kind === 'code' ? selectSandbox() : null;
}

/**
 * The verdict a run ends on, whoever decided it. A declarative grader's floor
 * is enforced by the broker and arrives as its error code; a code grader's
 * floor is decided by its program after collection succeeded. The branch is on
 * the manifest's kind — a property of the contract, never a grader id.
 */
export async function evaluate(
  manifest: GraderManifest,
  { snapshot, incompleteCode }: CollectedEvidence,
  sandbox: Sandbox | null,
): Promise<Evaluation> {
  if (manifest.kind === 'declarative') {
    const result = runDeclarative(manifest, snapshot);
    if (result.score !== null) return { result, verdict: 'scored' };
    return {
      result,
      verdict: incompleteCode === 'insufficient_evidence' ? 'insufficient' : 'incomplete',
    };
  }
  // No program is worth a box on evidence fieldnote already knows is partial.
  if (!snapshot.complete)
    return {
      result: {
        score: null,
        checks: [],
        rubricVersion: manifest.version,
        evaluatorVersion: manifest.evaluatorVersion,
        incompleteReason: snapshot.incompleteReason ?? INCOMPLETE,
      },
      verdict: 'incomplete',
    };
  // A caller that skipped sandboxFor() is fieldnote's bug, not an outage.
  if (!sandbox) throw new Error('A code grader is evaluated with a sandbox');
  const { result, insufficient } = await runCodeGrader(manifest, snapshot, sandbox);
  return { result, verdict: insufficient ? 'insufficient' : 'scored' };
}
