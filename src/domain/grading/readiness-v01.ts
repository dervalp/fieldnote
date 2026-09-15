import { runDeclarative } from './declarative';
import { rubricView } from './rubric-view';
import { agentReadinessManifest } from './graders/agent-readiness';
import type { GradeResult, RepositorySnapshot } from './types';

/**
 * The pre-contract surface of the readiness grader, kept because
 * readiness-v01.test.ts is this slice's acceptance test and must pass
 * unchanged against a grader running entirely through the public contract.
 *
 * Nothing in fieldnote calls these any more: the grading engine resolves a
 * run's pinned manifest (pinnedManifest(), backed by graderVersion()) and
 * calls runDeclarative(manifest, …); every query takes a graderId.
 * `family` is the pre-rename spelling of a grader's unnamespaced name; the
 * column, the parameter and every new caller say grader_id.
 */
export const readinessRubric = Object.freeze({
  ...rubricView(agentReadinessManifest),
  family: agentReadinessManifest.id.split('/')[1],
});

export function evaluateReadiness(snapshot: RepositorySnapshot): GradeResult {
  return runDeclarative(agentReadinessManifest, snapshot);
}
