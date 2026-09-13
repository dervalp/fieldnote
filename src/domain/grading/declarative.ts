import { runCheck } from './primitives';
import type { GraderManifest } from './manifest';
import type { CheckEvidence, GradeResult, RepositorySnapshot, SourceDocument } from './types';

// fieldnote's sentence, not the grader's: it describes fieldnote's collection
// failing, which no manifest is in a position to explain.
export const INCOMPLETE = 'Repository evidence collection was incomplete.';

function ordered(documents: SourceDocument[]): SourceDocument[] {
  return [...documents].sort(
    (left, right) =>
      left.path.localeCompare(right.path, 'en') || left.blobSha.localeCompare(right.blobSha, 'en'),
  );
}

/**
 * A declarative grader is its manifest. This is the whole engine: sort the
 * evidence once, run each check's primitive in manifest order, sum the points.
 * It never validates — a manifest that reaches here was proven well-formed at
 * registration — and it knows nothing about which grader it is running, which
 * is the only available evidence that the contract is a contract.
 */
export function runDeclarative(
  manifest: GraderManifest,
  snapshot: RepositorySnapshot,
): GradeResult {
  const evidence: CheckEvidence = {
    documents: ordered(snapshot.documents),
    metrics: snapshot.metrics ?? null,
  };
  const checks = manifest.checks.map((check) => {
    try {
      return runCheck(check, evidence, manifest.disclaimer);
    } catch (error) {
      // If a check fails due to missing evidence (e.g., metrics that were not
      // collected), treat it as a failed check so the grader can complete.
      return {
        id: check.id,
        points: 0,
        maxPoints: check.points,
        status: 'fail' as const,
        paths: [],
        lineRanges: [],
        explanation: `${check.explain.fail} ${manifest.disclaimer}`,
      };
    }
  });
  const metrics = snapshot.metrics;
  return {
    score: snapshot.complete ? checks.reduce((sum, check) => sum + check.points, 0) : null,
    checks,
    rubricVersion: manifest.version,
    evaluatorVersion: manifest.evaluatorVersion,
    ...(metrics
      ? { window: { start: metrics.start, endExclusive: metrics.endExclusive, days: metrics.days } }
      : {}),
    // There are two reasons a run has no score and they belong to different
    // authors. "Not enough merged work to judge" is the grader's, and arrives
    // on the snapshot. Collection failing is fieldnote's, and no manifest is
    // in a position to explain it.
    ...(snapshot.complete ? {} : { incompleteReason: snapshot.incompleteReason ?? INCOMPLETE }),
  };
}
