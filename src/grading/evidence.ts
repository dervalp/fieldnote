import { collectFiles, collectTree } from '../github/collect-files';
import { collectMetrics } from '../db/queries/grade-metrics';
import { INCOMPLETE } from '../domain/grading/declarative';
import { needsHash } from '../domain/grading/needs-consent';
import type { GraderManifest } from '../domain/grading/manifest';
import type { RepositorySnapshot } from '../domain/grading/types';

/** The workspace agreed to one set of needs; this manifest declares another. */
export class ConsentError extends Error {
  constructor() {
    super('The grader asks for evidence this workspace has not agreed to.');
    this.name = 'ConsentError';
  }
}

export type CollectedEvidence = {
  snapshot: RepositorySnapshot;
  /** Which failure to record when the snapshot is incomplete. Null when the
   * snapshot is complete — there is no failure to name. */
  incompleteCode: 'incomplete_collection' | 'insufficient_evidence' | null;
};

/**
 * The broker. A grader gets exactly the evidence it declared and nothing else:
 * the families it named, the file globs it named, and a metrics window pinned
 * to the moment the run was requested rather than the moment it executed.
 *
 * This is the one place a consent check belongs when slice 5 builds the
 * install flow, because it is the one place that knows both the manifest's
 * `needs` and the repository it is about to read. Do not put it anywhere else.
 */
// The families this dispatcher knows how to collect. Kept as a literal set
// rather than inferred from the schema so that a family added to
// manifestSchema without a matching branch here fails loudly, by name,
// instead of silently collecting nothing for it. Unreachable through normal
// validation today: the needs schema has keys for these three families only
// and drops any other key. needs_mismatch is no guard here — it refuses an
// unread family only for a declarative grader, since a code grader's
// declaration is a ceiling — so this is the refusal for the day a family is
// added to the schema without a branch below.
const HANDLED_FAMILIES = ['repo.files', 'repo.tree', 'fieldnote.metrics'] as const;

export async function collectEvidence(
  manifest: GraderManifest,
  repositoryId: string,
  sha: string,
  requestedAt: Date,
  consentedNeeds: string,
): Promise<CollectedEvidence> {
  const unhandled = Object.keys(manifest.needs).find(
    (family) => !(HANDLED_FAMILIES as readonly string[]).includes(family),
  );
  if (unhandled) throw new Error(`collectEvidence does not handle evidence family '${unhandled}'`);
  // The one place that knows both the manifest's needs and the repository it is
  // about to read, which is why slice 3 put the check here and nowhere else.
  if (needsHash(manifest.needs) !== consentedNeeds) throw new ConsentError();
  const filesNeed = manifest.needs['repo.files'];
  const treeNeed = manifest.needs['repo.tree'];
  const metricsNeed = manifest.needs['fieldnote.metrics'];
  const files = filesNeed ? await collectFiles(repositoryId, sha, filesNeed) : null;
  const tree = treeNeed ? await collectTree(repositoryId, sha, treeNeed) : null;
  const metrics = metricsNeed ? await collectMetrics(repositoryId, metricsNeed, requestedAt) : null;
  // Collection failing outranks a grader's floor: if fieldnote could not read
  // the evidence, what the grader would have made of it is unknown.
  const collectionFailed =
    (files !== null && !files.complete) || (tree !== null && !tree.complete);
  const metricsShort = metrics !== null && !metrics.complete;
  const complete = !collectionFailed && !metricsShort;
  return {
    snapshot: {
      sha,
      complete,
      documents: files?.documents ?? [],
      // Only a grader that declared the family carries the key: what a program
      // receives is built from the snapshot, and absent is not the same as empty.
      ...(tree ? { tree: tree.tree } : {}),
      metrics: metrics?.metrics ?? null,
      ...(collectionFailed
        ? { incompleteReason: INCOMPLETE }
        : metricsShort
          ? { incompleteReason: metrics.incompleteReason }
          : {}),
    },
    // A failed file or tree collection is always fieldnote's failure.
    // Otherwise, ask the metrics collector which of the two it meant — it
    // already knows. Null when the snapshot is complete.
    incompleteCode: collectionFailed
      ? 'incomplete_collection'
      : metricsShort
        ? metrics.incompleteCode
        : null,
  };
}
