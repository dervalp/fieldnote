import type { GraderManifest } from './manifest';

export type RubricView = {
  readonly graderId: string;
  readonly version: string;
  readonly evaluatorVersion: string;
  readonly checks: readonly { readonly id: string; readonly maxPoints: number }[];
};

/**
 * The rubric a run is pinned to: the immutable, versioned definition of checks
 * and their points, and nothing operational. Derived from the manifest so the
 * two can never disagree, and stored in grading_rubrics.definition as it
 * always was.
 */
export function rubricView(manifest: GraderManifest): RubricView {
  return Object.freeze({
    graderId: manifest.id,
    version: manifest.version,
    evaluatorVersion: manifest.evaluatorVersion,
    checks: Object.freeze(
      manifest.checks.map((check) => Object.freeze({ id: check.id, maxPoints: check.points })),
    ),
  });
}
