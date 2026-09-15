import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../index';
import { graderInstalls, gradeSchedules, publicGrades, graderVersions } from '../schema';
import { requireWorkspace } from '../../workspaces/access';
import { currentUser } from '../../auth/session';
import { parseManifest } from '../../domain/grading/registry';
import { needsHash } from '../../domain/grading/needs-consent';

async function installable(graderId: string, version: string) {
  const [row] = await db()
    .select({ manifest: graderVersions.manifest })
    .from(graderVersions)
    .where(
      and(
        eq(graderVersions.graderId, graderId),
        eq(graderVersions.version, version),
        isNull(graderVersions.withdrawnAt),
      ),
    );
  if (!row) throw new Error('Version unavailable');
  return parseManifest(row.manifest);
}

/**
 * Install one version into this workspace, recording what it may read. Owners
 * only: an install is a permission grant over every repository the workspace
 * has connected, which is a bigger step than running a grade.
 */
export async function installGrader(graderId: string, version: string): Promise<void> {
  const workspace = await requireWorkspace(undefined, 'owner');
  const manifest = await installable(graderId, version);
  const user = await currentUser();
  await db()
    .insert(graderInstalls)
    .values({
      workspaceId: workspace.id,
      graderId,
      version,
      installedBy: user.id,
      consentedNeeds: needsHash(manifest.needs),
    })
    .onConflictDoNothing();
}

/**
 * Re-pin an install to another version, recording the consent that version
 * needs. Owners only, same as installing — and the same `installable()` check
 * an install itself passes through, so a withdrawn or nonexistent version
 * refuses an update exactly as it refuses a new install.
 */
export async function updateInstall(graderId: string, version: string): Promise<void> {
  const workspace = await requireWorkspace(undefined, 'owner');
  const manifest = await installable(graderId, version);
  const updated = await db()
    .update(graderInstalls)
    .set({ version, consentedNeeds: needsHash(manifest.needs) })
    .where(and(eq(graderInstalls.workspaceId, workspace.id), eq(graderInstalls.graderId, graderId)))
    .returning({ graderId: graderInstalls.graderId });
  // A grader this workspace never installed matches zero rows; reporting
  // success there tells the caller a no-op worked, the same defect
  // withdrawVersion had before it was fixed to check its own returning rows.
  if (updated.length === 0) throw new Error('Grader not installed');
}

/**
 * Remove a grader from this workspace, and with it the things this workspace
 * turned on through it: nightly schedules and public sharing. Both tables
 * carry a workspace_id, so another workspace sharing the same repository is
 * untouched.
 *
 * Public sharing is revoked, not deleted — publicGradeSettings reads `shared`
 * from `revoked_at`, and a badge already in a README must keep answering
 * (privately) rather than pointing at a row that no longer exists. Grade
 * history (grade_runs) is never touched: uninstalling turns things off, it
 * does not rewrite what already happened.
 *
 * Uninstalling something this workspace never installed is a silent no-op —
 * that matches the caller's intent, unlike updateInstall above.
 */
export async function uninstallGrader(graderId: string): Promise<void> {
  const workspace = await requireWorkspace(undefined, 'owner');
  await db().transaction(async (tx) => {
    await tx
      .delete(graderInstalls)
      .where(
        and(eq(graderInstalls.workspaceId, workspace.id), eq(graderInstalls.graderId, graderId)),
      );
    await tx
      .delete(gradeSchedules)
      .where(
        and(eq(gradeSchedules.workspaceId, workspace.id), eq(gradeSchedules.graderId, graderId)),
      );
    await tx
      .update(publicGrades)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(publicGrades.workspaceId, workspace.id),
          eq(publicGrades.graderId, graderId),
          isNull(publicGrades.revokedAt),
        ),
      );
  });
}
