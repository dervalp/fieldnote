// The mark means a person read this, not that it is correct — a reviewer's
// own read of the manifest is what verifiedAt records. Shared by every place
// a grader is named to a workspace (browse list, published list, orphaned
// installs, the consent screen) so the same version reads the same way
// wherever it turns up. Verified takes priority over withdrawn: a version
// can be both, and "a person read this" stays true even after it is pulled.
export function GraderStateLine({
  verifiedAt,
  withdrawnAt,
}: {
  verifiedAt: Date | null;
  withdrawnAt: Date | null;
}) {
  if (verifiedAt)
    return (
      <span className="grader-state">
        Read by fieldnote on {verifiedAt.toISOString().slice(0, 10)}
      </span>
    );
  if (withdrawnAt) return <span className="grader-state">Withdrawn</span>;
  return <span className="grader-state">Not reviewed</span>;
}
