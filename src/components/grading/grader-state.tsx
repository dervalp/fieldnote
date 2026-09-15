// The mark means a person read this, not that it is correct — a reviewer's
// own read of the manifest is what verifiedAt records. The two facts are not
// mutually exclusive: a version can be read, then later withdrawn — "a
// person read this" stays true even after it is pulled, and a workspace
// still running a withdrawn version needs to be told so, not just reassured
// that it was once reviewed.
export function graderStateText(verifiedAt: Date | null, withdrawnAt: Date | null): string {
  if (verifiedAt && withdrawnAt)
    return `Read by fieldnote on ${verifiedAt.toISOString().slice(0, 10)} · Withdrawn`;
  if (verifiedAt) return `Read by fieldnote on ${verifiedAt.toISOString().slice(0, 10)}`;
  if (withdrawnAt) return 'Withdrawn';
  return 'Not reviewed';
}

// Shared by every place a grader is named to a workspace (browse list,
// published list, orphaned installs, the consent screen) so the same version
// reads the same way wherever it turns up. The public grade page's OG card
// renders through satori rather than this component (a plain <span> carries
// no layout style satori requires), so it calls graderStateText() directly
// instead — same wording, both places.
export function GraderStateLine({
  verifiedAt,
  withdrawnAt,
}: {
  verifiedAt: Date | null;
  withdrawnAt: Date | null;
}) {
  return <span className="grader-state">{graderStateText(verifiedAt, withdrawnAt)}</span>;
}
