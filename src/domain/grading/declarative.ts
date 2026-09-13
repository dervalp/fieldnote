import { runCheck } from './primitives';
import type { GraderManifest } from './manifest';
import type { GradeResult, RepositorySnapshot, SourceDocument } from './types';

// fieldnote's sentence, not the grader's: it describes fieldnote's collection
// failing, which no manifest is in a position to explain.
const INCOMPLETE = 'Repository evidence collection was incomplete.';

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
  const documents = ordered(snapshot.documents);
  const checks = manifest.checks.map((check) => runCheck(check, documents, manifest.disclaimer));
  return {
    score: snapshot.complete ? checks.reduce((sum, check) => sum + check.points, 0) : null,
    checks,
    rubricVersion: manifest.version,
    evaluatorVersion: manifest.evaluatorVersion,
    ...(snapshot.complete ? {} : { incompleteReason: INCOMPLETE }),
  };
}
