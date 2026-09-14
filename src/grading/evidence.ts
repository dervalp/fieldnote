import { collectFiles } from '../github/collect-files';
import { collectMetrics } from '../db/queries/grade-metrics';
import { INCOMPLETE } from '../domain/grading/declarative';
import type { GraderManifest } from '../domain/grading/manifest';
import type { RepositorySnapshot } from '../domain/grading/types';

export type CollectedEvidence = {
  snapshot: RepositorySnapshot;
  /** Which failure to record when the snapshot is incomplete. Null when the
   * snapshot is complete — there is no failure to name. */
  incompleteCode: 'incomplete_collection' | 'insufficient_evidence' | null;
};

/**
 * Slice 2's evidence dispatcher: two families, honoured because a manifest
 * declared them and parseManifest refuses a manifest that declares a family no
 * check reads. There is no consent prompt, no cache, no history collector and
 * no schedule — those are slice 3's, which replaces this file. The call site in
 * grade-repository.ts does not move.
 */
// The families this dispatcher knows how to collect. Kept as a literal set
// rather than inferred from the schema so that a family added to
// manifestSchema without a matching branch here fails loudly, by name,
// instead of silently collecting nothing for it. Unreachable through normal
// validation today — parseManifest's needs_mismatch invariant already
// refuses a manifest that declares a family no check reads, and the schema
// has no key for a third family — but this is the refusal for the day one
// arrives.
const HANDLED_FAMILIES = ['repo.files', 'fieldnote.metrics'] as const;

export async function collectEvidence(
  manifest: GraderManifest,
  repositoryId: string,
  sha: string,
): Promise<CollectedEvidence> {
  const unhandled = Object.keys(manifest.needs).find(
    (family) => !(HANDLED_FAMILIES as readonly string[]).includes(family),
  );
  if (unhandled) throw new Error(`collectEvidence does not handle evidence family '${unhandled}'`);
  const filesNeed = manifest.needs['repo.files'];
  const metricsNeed = manifest.needs['fieldnote.metrics'];
  const files = filesNeed ? await collectFiles(repositoryId, sha, filesNeed) : null;
  const metrics = metricsNeed ? await collectMetrics(repositoryId, metricsNeed) : null;
  // Collection failing outranks a grader's floor: if fieldnote could not read
  // the evidence, what the grader would have made of it is unknown.
  const filesFailed = files !== null && !files.complete;
  const metricsShort = metrics !== null && !metrics.complete;
  const complete = !filesFailed && !metricsShort;
  return {
    snapshot: {
      sha,
      complete,
      documents: files?.documents ?? [],
      metrics: metrics?.metrics ?? null,
      ...(filesFailed
        ? { incompleteReason: INCOMPLETE }
        : metricsShort
          ? { incompleteReason: metrics.incompleteReason }
          : {}),
    },
    // A failed file collection is always fieldnote's failure. Otherwise, ask
    // the metrics collector which of the two it meant — it already knows.
    // Null when the snapshot is complete: there is no failure to name.
    incompleteCode: filesFailed
      ? 'incomplete_collection'
      : metricsShort
        ? metrics.incompleteCode
        : null,
  };
}
