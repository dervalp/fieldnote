import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../index';
import { graders, graderVersions, workspaces } from '../schema';
import { requireWorkspace } from '../../workspaces/access';
import { currentUser } from '../../auth/session';
import { ManifestError, type GraderManifest } from '../../domain/grading/manifest';
import { parseManifest } from '../../domain/grading/registry';

// A handle becomes the owner segment of every grader id this workspace
// publishes, so these are the names a URL, a route or fieldnote itself needs.
export const RESERVED_HANDLES = [
  'fieldnote',
  'admin',
  'api',
  'app',
  'r',
  'www',
  'support',
] as const;
const HANDLE = /^[a-z0-9][a-z0-9-]{1,38}$/;

/**
 * Claim the name this workspace publishes under. Owners only, once and never
 * again: published grader ids contain the handle, and other workspaces' installs
 * point at those ids, so a rename would orphan them.
 *
 * Checked before the format: a reserved name is refused for what it is, not
 * for how it is shaped, and 'r' — one character, reserved — must not fall
 * through to "Invalid handle" just because the format regex would also reject
 * it.
 */
export async function claimHandle(handle: string): Promise<void> {
  const workspace = await requireWorkspace(undefined, 'owner');
  if ((RESERVED_HANDLES as readonly string[]).includes(handle))
    throw new Error('Handle unavailable');
  if (!HANDLE.test(handle)) throw new Error('Invalid handle');
  const [existing] = await db()
    .select({ handle: workspaces.handle })
    .from(workspaces)
    .where(eq(workspaces.id, workspace.id));
  if (existing?.handle) throw new Error('Handle already claimed');
  try {
    await db().update(workspaces).set({ handle }).where(eq(workspaces.id, workspace.id));
  } catch (error) {
    // The unique index is the race winner, not this read-then-write. Drizzle
    // wraps the driver's error in a DrizzleQueryError whose own message is
    // just the failed SQL; postgres's error code travels one level down, on
    // `.cause`, not on the wrapper itself.
    if (isUniqueViolation(error)) throw new Error('Handle unavailable');
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code = (candidate: unknown) =>
    typeof candidate === 'object' && candidate !== null && 'code' in candidate
      ? (candidate as { code: unknown }).code
      : undefined;
  const cause = (error as { cause?: unknown } | null)?.cause;
  return code(error) === '23505' || code(cause) === '23505';
}

/**
 * Publish one version. Owners only, under this workspace's own handle, and
 * never over an existing (grader_id, version): installs point at a version and
 * grades are pinned to it, so a published version is immutable.
 */
export async function publishGrader(manifestJson: string): Promise<GraderManifest> {
  const workspace = await requireWorkspace(undefined, 'owner');
  const user = await currentUser();
  const [row] = await db()
    .select({ handle: workspaces.handle })
    .from(workspaces)
    .where(eq(workspaces.id, workspace.id));
  if (!row?.handle) throw new Error('Claim a handle first');
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestJson);
  } catch {
    throw new ManifestError('schema', 'That is not valid JSON.');
  }
  const manifest = parseManifest(parsed);
  // Open question 3 — whether a grader running inside fieldnote's sandbox is a
  // derived work of an AGPL application — is unanswered, so nothing that ships
  // code is published. fieldnote's own code grader is seeded, not published.
  if (manifest.kind === 'code') throw new Error('Code graders cannot be published yet');
  if (manifest.id.split('/')[0] !== row.handle) throw new Error('Wrong namespace');
  // The graders row (claiming the name) and the grader_versions row (the
  // manifest itself) must land together: a crash between the two statements
  // would otherwise leave a grader name claimed with nothing published under
  // it, which browsing and installing cannot tell apart from a bug.
  return db().transaction(async (tx) => {
    await tx
      .insert(graders)
      .values({ id: manifest.id, ownedByWorkspaceId: workspace.id })
      .onConflictDoNothing();
    const [grader] = await tx.select().from(graders).where(eq(graders.id, manifest.id));
    if (grader.ownedByWorkspaceId !== workspace.id) throw new Error('Grader name taken');
    const inserted = await tx
      .insert(graderVersions)
      .values({
        graderId: manifest.id,
        version: manifest.version,
        evaluatorVersion: manifest.evaluatorVersion,
        manifest,
        publishedBy: user.id,
      })
      .onConflictDoNothing()
      .returning({ version: graderVersions.version });
    if (inserted.length === 0) throw new Error('Version already published');
    return manifest;
  });
}

/** Take a version out of browsing. Whoever already installed it keeps running it. */
export async function withdrawVersion(
  graderId: string,
  version: string,
  note: string,
): Promise<void> {
  const workspace = await requireWorkspace(undefined, 'owner');
  const [grader] = await db().select().from(graders).where(eq(graders.id, graderId));
  if (!grader || grader.ownedByWorkspaceId !== workspace.id) throw new Error('Grader unavailable');
  const updated = await db()
    .update(graderVersions)
    .set({ withdrawnAt: new Date(), withdrawnNote: note })
    .where(and(eq(graderVersions.graderId, graderId), eq(graderVersions.version, version)))
    .returning({ version: graderVersions.version });
  // A grader you own but a version that never existed updates zero rows;
  // reporting success there tells the caller a no-op worked.
  if (updated.length === 0) throw new Error('Version unavailable');
}

export type PublishedVersion = {
  graderId: string;
  version: string;
  title: string;
  publishedAt: Date;
  verifiedAt: Date | null;
  withdrawnAt: Date | null;
};

/** Every version this workspace has published, newest first. */
export async function workspaceGraders(): Promise<PublishedVersion[]> {
  const workspace = await requireWorkspace();
  return db()
    .select({
      graderId: graderVersions.graderId,
      version: graderVersions.version,
      title: sql<string>`${graderVersions.manifest}->'card'->>'title'`,
      publishedAt: graderVersions.publishedAt,
      verifiedAt: graderVersions.verifiedAt,
      withdrawnAt: graderVersions.withdrawnAt,
    })
    .from(graderVersions)
    .innerJoin(graders, eq(graders.id, graderVersions.graderId))
    .where(eq(graders.ownedByWorkspaceId, workspace.id))
    .orderBy(desc(graderVersions.publishedAt));
}
