import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../index';
import { installations, publicGrades, repositories, workspaceRepositories } from '../schema';
import { requireRepository, requireWorkspace } from '../../workspaces/access';
import { currentUser } from '../../auth/session';
import { installedGrader } from './graders';
import { ManifestError } from '../../domain/grading/manifest';

/**
 * Session-bound half of public sharing: what the grades page draws, and what
 * its switch writes. The public page, badge and share image read none of this —
 * they go through src/db/queries/public-grades.ts, which has no session at all.
 */
export type PublicGradeSetting = { shared: boolean };

/** Every sharing row on one repository, keyed by grader id. Absent means never shared. */
export async function publicGradeSettings(
  repositoryId: string,
): Promise<Record<string, PublicGradeSetting>> {
  await requireRepository(repositoryId);
  const rows = await db()
    .select({ graderId: publicGrades.graderId, revokedAt: publicGrades.revokedAt })
    .from(publicGrades)
    .where(eq(publicGrades.repositoryId, repositoryId));
  return Object.fromEntries(rows.map((row) => [row.graderId, { shared: row.revokedAt === null }]));
}

/**
 * Share a grade publicly, or stop. **Owners only** — making something public is
 * a bigger step than running a grade, and requireWorkspace(undefined, 'owner')
 * is where that is enforced, including for the demo workspace, which it refuses
 * outright.
 *
 * Turning it off keeps the row and sets revoked_at, so a badge already in a
 * README renders `private` rather than breaking; turning it on again clears it
 * and records whoever did so.
 */
export async function writePublicGrade(
  repositoryId: string,
  graderId: string,
  shared: boolean,
): Promise<void> {
  const repository = await requireRepository(repositoryId);
  const workspace = await requireWorkspace(undefined, 'owner');
  if (workspace.id === 'demo' || repository.isDemo) throw new Error('Demo workspace is read-only');
  const installed = await installedGrader(workspace.id, graderId);
  if (!installed) throw new ManifestError('unknown_grader', `No grader '${graderId}' is installed.`);
  const user = await currentUser();
  const [available] = await db()
    .select({ id: repositories.id })
    .from(repositories)
    .innerJoin(installations, eq(installations.id, repositories.installationId))
    .innerJoin(
      workspaceRepositories,
      and(
        eq(workspaceRepositories.repositoryId, repositories.id),
        eq(workspaceRepositories.workspaceId, workspace.id),
      ),
    )
    .where(
      and(
        eq(repositories.id, repositoryId),
        eq(repositories.active, true),
        eq(repositories.isDemo, false),
        eq(installations.active, true),
      ),
    );
  if (!available) throw new Error('Repository unavailable');
  if (!shared) {
    await db()
      .update(publicGrades)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(publicGrades.repositoryId, repositoryId),
          eq(publicGrades.graderId, graderId),
          isNull(publicGrades.revokedAt),
        ),
      );
    return;
  }
  await db()
    .insert(publicGrades)
    .values({
      repositoryId,
      graderId,
      enabledBy: user.id,
      workspaceId: workspace.id,
      enabledAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [publicGrades.repositoryId, publicGrades.graderId],
      set: {
        enabledBy: user.id,
        workspaceId: workspace.id,
        enabledAt: new Date(),
        revokedAt: null,
      },
    });
}
