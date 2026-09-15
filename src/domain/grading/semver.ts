/**
 * Grader versions are semver `major.minor.patch`, always. Compared
 * numerically, never as strings — `'0.10.0'` sorts below `'0.9.0'` as a
 * string, but is the newer version.
 */
function parts(version: string): [number, number, number] {
  const [major, minor, patch] = version.split('.').map((part) => Number(part));
  return [major ?? 0, minor ?? 0, patch ?? 0];
}

/** Negative when `left` is older than `right`, positive when newer, zero when equal. */
export function compareVersions(left: string, right: string): number {
  const [leftMajor, leftMinor, leftPatch] = parts(left);
  const [rightMajor, rightMinor, rightPatch] = parts(right);
  if (leftMajor !== rightMajor) return leftMajor - rightMajor;
  if (leftMinor !== rightMinor) return leftMinor - rightMinor;
  return leftPatch - rightPatch;
}

/** Whether `candidate` is strictly newer than `installed` — the guard an
 *  "Update available" prompt needs: withdrawing the version a workspace
 *  currently runs must never make an older, still-published version look
 *  like an upgrade. */
export function isNewerVersion(candidate: string, installed: string): boolean {
  return compareVersions(candidate, installed) > 0;
}
