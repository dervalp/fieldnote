import { INCOMPLETE, runDeclarative } from '../domain/grading/declarative';
import type { GraderManifest } from '../domain/grading/manifest';
import type { GradeResult } from '../domain/grading/types';
import type { CollectedEvidence } from './evidence';
import { runCodeGrader } from './run-code';
import { selectSandbox } from './sandbox';

export type Evaluation = {
  result: GradeResult;
  verdict: 'scored' | 'insufficient' | 'incomplete';
};

/**
 * The verdict a run ends on, whoever decided it. A declarative grader's floor
 * is enforced by the broker and arrives as its error code; a code grader's
 * floor is decided by its program after collection succeeded. The branch is on
 * the manifest's kind — a property of the contract, never a grader id.
 */
export async function evaluate(
  manifest: GraderManifest,
  { snapshot, incompleteCode }: CollectedEvidence,
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
  const { result, insufficient } = await runCodeGrader(manifest, snapshot, selectSandbox());
  return { result, verdict: insufficient ? 'insufficient' : 'scored' };
}
