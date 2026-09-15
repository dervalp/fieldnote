import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../index';
import { graders, graderInstalls, graderVersions, workspaces } from '../schema';
import { parseManifest, type GraderManifest } from '../../domain/grading/manifest';
import { builtInManifests } from '../../domain/grading/registry';
import { needsHash } from '../../domain/grading/needs-consent';

/** A published grader, resolved by its pinned (grader_id, version). */
export async function graderVersion(
  graderId: string,
  version: string,
): Promise<GraderManifest | null> {
  const [row] = await db()
    .select({ manifest: graderVersions.manifest })
    .from(graderVersions)
    .where(and(eq(graderVersions.graderId, graderId), eq(graderVersions.version, version)));
  // A stored manifest was validated before it was written, and is re-validated
  // here rather than trusted: a row edited by hand must not reach the engine.
  return row ? parseManifest(row.manifest) : null;
}

/** Whether fieldnote staff have read this exact (grader_id, version) — the
 *  fact the public grade page carries alongside the manifest it names, since
 *  a visitor presented with a stranger's grader deserves to know whether
 *  anyone has looked at it. Null for a version that does not exist, same as
 *  graderVersion(). */
export async function verifiedAtFor(graderId: string, version: string): Promise<Date | null> {
  const [row] = await db()
    .select({ verifiedAt: graderVersions.verifiedAt })
    .from(graderVersions)
    .where(and(eq(graderVersions.graderId, graderId), eq(graderVersions.version, version)));
  return row?.verifiedAt ?? null;
}

/** The newest version of a grader that has not been withdrawn, or null when
 *  every version is withdrawn or the grader does not exist. */
export async function latestPublishedVersion(graderId: string): Promise<GraderManifest | null> {
  const [row] = await db()
    .select({ manifest: graderVersions.manifest })
    .from(graderVersions)
    .where(and(eq(graderVersions.graderId, graderId), isNull(graderVersions.withdrawnAt)))
    .orderBy(desc(graderVersions.publishedAt))
    .limit(1);
  return row ? parseManifest(row.manifest) : null;
}

export type InstalledGrader = {
  manifest: GraderManifest;
  version: string;
  consentedNeeds: string;
  verifiedAt: Date | null;
  withdrawnAt: Date | null;
  latestVersion: string;
};

// The newest non-withdrawn version for each grader id, in one round trip: a
// single query ordered newest-first, keeping only the first row seen per
// grader. Simpler than a correlated subquery per row, and installedGraders()
// never resolves more than a workspace's own install count of graders.
async function latestVersionsById(graderIds: string[]): Promise<Map<string, string>> {
  if (graderIds.length === 0) return new Map();
  const rows = await db()
    .select({ graderId: graderVersions.graderId, version: graderVersions.version })
    .from(graderVersions)
    .where(and(inArray(graderVersions.graderId, graderIds), isNull(graderVersions.withdrawnAt)))
    .orderBy(desc(graderVersions.publishedAt));
  const latest = new Map<string, string>();
  for (const row of rows) if (!latest.has(row.graderId)) latest.set(row.graderId, row.version);
  return latest;
}

/** What a workspace installed for one grader, pinned to its consented
 *  version — or null when the workspace has not installed it. */
export async function installedGrader(
  workspaceId: string,
  graderId: string,
): Promise<InstalledGrader | null> {
  const [row] = await db()
    .select({
      manifest: graderVersions.manifest,
      version: graderInstalls.version,
      consentedNeeds: graderInstalls.consentedNeeds,
      verifiedAt: graderVersions.verifiedAt,
      withdrawnAt: graderVersions.withdrawnAt,
    })
    .from(graderInstalls)
    .innerJoin(
      graderVersions,
      and(
        eq(graderVersions.graderId, graderInstalls.graderId),
        eq(graderVersions.version, graderInstalls.version),
      ),
    )
    .where(and(eq(graderInstalls.workspaceId, workspaceId), eq(graderInstalls.graderId, graderId)));
  if (!row) return null;
  const latest = await latestPublishedVersion(graderId);
  return {
    manifest: parseManifest(row.manifest),
    version: row.version,
    consentedNeeds: row.consentedNeeds,
    verifiedAt: row.verifiedAt,
    withdrawnAt: row.withdrawnAt,
    latestVersion: latest?.version ?? row.version,
  };
}

/** Every grader a workspace installed, pinned to what it consented to.
 *  Ordered by when each was installed, then by grader id: a caller that
 *  renders these as a row of cards (the grading page, say) needs an order
 *  that does not depend on Postgres's whim, and does not change the day a
 *  re-pin updates a row in place. */
export async function installedGraders(workspaceId: string): Promise<InstalledGrader[]> {
  const rows = await db()
    .select({
      graderId: graderInstalls.graderId,
      manifest: graderVersions.manifest,
      version: graderInstalls.version,
      consentedNeeds: graderInstalls.consentedNeeds,
      verifiedAt: graderVersions.verifiedAt,
      withdrawnAt: graderVersions.withdrawnAt,
    })
    .from(graderInstalls)
    .innerJoin(
      graderVersions,
      and(
        eq(graderVersions.graderId, graderInstalls.graderId),
        eq(graderVersions.version, graderInstalls.version),
      ),
    )
    .where(eq(graderInstalls.workspaceId, workspaceId))
    .orderBy(asc(graderInstalls.installedAt), asc(graderInstalls.graderId));
  const latest = await latestVersionsById(rows.map((row) => row.graderId));
  return rows.map((row) => ({
    manifest: parseManifest(row.manifest),
    version: row.version,
    consentedNeeds: row.consentedNeeds,
    verifiedAt: row.verifiedAt,
    withdrawnAt: row.withdrawnAt,
    latestVersion: latest.get(row.graderId) ?? row.version,
  }));
}

export type BrowsableGrader = {
  id: string;
  manifest: GraderManifest;
  version: string;
  verifiedAt: Date | null;
  author: string;
  installed: InstalledGrader | null;
};

/** Every grader's newest non-withdrawn version, verified first then by
 *  published date, each carrying the workspace's own install when it has one. */
export async function browsableGraders(workspaceId: string): Promise<BrowsableGrader[]> {
  const versionRows = await db()
    .select({
      graderId: graderVersions.graderId,
      version: graderVersions.version,
      manifest: graderVersions.manifest,
      verifiedAt: graderVersions.verifiedAt,
      publishedAt: graderVersions.publishedAt,
    })
    .from(graderVersions)
    .where(isNull(graderVersions.withdrawnAt))
    .orderBy(desc(graderVersions.publishedAt));

  // One row per grader: the first one seen, in publishedAt-desc order, is its
  // newest non-withdrawn version.
  const newestByGrader = new Map<string, (typeof versionRows)[number]>();
  for (const row of versionRows) if (!newestByGrader.has(row.graderId)) newestByGrader.set(row.graderId, row);

  const graderIds = [...newestByGrader.keys()];
  if (graderIds.length === 0) return [];

  const authorRows = await db()
    .select({ id: graders.id, handle: workspaces.handle })
    .from(graders)
    .leftJoin(workspaces, eq(workspaces.id, graders.ownedByWorkspaceId))
    .where(inArray(graders.id, graderIds));
  const authorOf = new Map(authorRows.map((row) => [row.id, row.handle ?? 'fieldnote']));

  const installs = await installedGraders(workspaceId);
  const installedOf = new Map(installs.map((entry) => [entry.manifest.id, entry]));

  return [...newestByGrader.values()]
    .sort((left, right) => {
      const verified = Number(right.verifiedAt !== null) - Number(left.verifiedAt !== null);
      if (verified !== 0) return verified;
      return right.publishedAt.getTime() - left.publishedAt.getTime();
    })
    .map((row) => ({
      id: row.graderId,
      manifest: parseManifest(row.manifest),
      version: row.version,
      verifiedAt: row.verifiedAt,
      author: authorOf.get(row.graderId) ?? 'fieldnote',
      installed: installedOf.get(row.graderId) ?? null,
    }));
}

/**
 * Publishes fieldnote's own graders into the registry, once and permanently:
 * an ordinary (graders, grader_versions) row pair, owned by nobody and
 * pre-verified. Safe to call on every boot — onConflictDoNothing makes a
 * repeat a no-op, and a published (grader_id, version) is never updated.
 */
export async function seedBuiltInGraders(): Promise<void> {
  const verifiedAt = new Date();
  for (const manifest of builtInManifests()) {
    await db().insert(graders).values({ id: manifest.id }).onConflictDoNothing();
    await db()
      .insert(graderVersions)
      .values({
        graderId: manifest.id,
        version: manifest.version,
        evaluatorVersion: manifest.evaluatorVersion,
        manifest,
        publishedBy: null,
        verifiedAt,
      })
      .onConflictDoNothing();
  }
}

/**
 * Installs every built-in into a workspace, pinned to its seeded version and
 * consented to as declared. `installedBy` is null: a seeded install has no
 * user behind it, which is exactly what the column being nullable is for.
 *
 * Seeds first: workspace creation must work against a freshly migrated
 * database that has never run the seed (a fresh test database, or a
 * deployment where migrate and seed raced), and seeding is idempotent and
 * cheap — an install row is never installing a grader row that doesn't exist.
 */
export async function installBuiltIns(workspaceId: string): Promise<void> {
  await seedBuiltInGraders();
  for (const manifest of builtInManifests()) {
    await db()
      .insert(graderInstalls)
      .values({
        workspaceId,
        graderId: manifest.id,
        version: manifest.version,
        installedBy: null,
        consentedNeeds: needsHash(manifest.needs),
      })
      .onConflictDoNothing();
  }
}
