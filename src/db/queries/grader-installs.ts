import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../index';
import { graderInstalls, graderVersions } from '../schema';
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
