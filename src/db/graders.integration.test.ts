import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { and, eq, inArray } from 'drizzle-orm';
import { db, closeDb } from './index';
import { graderInstalls, graders, graderVersions, users, workspaces } from './schema';
import {
  browsableGraders,
  graderVersion,
  installBuiltIns,
  installedGrader,
  installedGraders,
  latestPublishedVersion,
  seedBuiltInGraders,
} from './queries/graders';
import { builtInManifests } from '../domain/grading/registry';
import { needsHash } from '../domain/grading/needs-consent';
import { parseManifest, type GraderManifest } from '../domain/grading/manifest';
import { AGENT_READINESS, agentReadinessManifest } from '../domain/grading/graders/agent-readiness';

const builtInIds = builtInManifests().map((manifest) => manifest.id);

let user = '';
let ownerWorkspace = '';
beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
  user = randomUUID();
  await db().insert(users).values({ id: user, login: 'grader-fixture', credentials: 'fixture' });
  ownerWorkspace = randomUUID();
  await db()
    .insert(workspaces)
    .values({ id: ownerWorkspace, name: 'Acme', handle: `acme-${ownerWorkspace.slice(0, 8)}` });
});

// Each test gets its own workspace — never shared — so an installBuiltIns()
// in one test cannot leave a later "nothing is installed" test looking at a
// workspace something else already installed into.
const fixtureWorkspaces: string[] = [];
let workspace = '';
beforeEach(async () => {
  workspace = randomUUID();
  fixtureWorkspaces.push(workspace);
  await db().insert(workspaces).values({ id: workspace, name: 'Graders fixture' });
});

// browsableGraders/latestPublishedVersion fixtures publish rows directly into
// graders/grader_versions — bypassing seedBuiltInGraders() — so a test
// controls verifiedAt/publishedAt/withdrawnAt exactly, rather than racing the
// clock seedBuiltInGraders() itself uses.
const fixtureGraderIds: string[] = [];
function fixtureGraderId(): string {
  const id = `fixture-${randomUUID().slice(0, 8)}/grader`;
  fixtureGraderIds.push(id);
  return id;
}
function fixtureManifest(graderId: string, version: string): GraderManifest {
  return parseManifest({
    id: graderId,
    version,
    evaluatorVersion: '1.0.0',
    subject: 'repository',
    mode: 'deterministic',
    category: 'documentation',
    kind: 'declarative',
    needs: { 'repo.files': ['README.md'] },
    disclaimer: 'Evidence, not certification.',
    card: {
      title: 'Fixture',
      tagline: 'A fixture grader.',
      groups: [{ title: 'Docs', checks: ['readme'] }],
    },
    checks: [
      {
        id: 'readme',
        title: 'Project documentation',
        points: 100,
        explain: { pass: 'Found a README.', fail: 'No README.' },
        primitive: 'file-exists',
        args: { root: true, nonempty: true, anyOf: ['README.md'] },
      },
    ],
  });
}
async function publishVersion(options: {
  graderId: string;
  version?: string;
  ownedByWorkspaceId?: string | null;
  verifiedAt?: Date | null;
  publishedAt?: Date;
  withdrawnAt?: Date | null;
}): Promise<GraderManifest> {
  const version = options.version ?? '0.1.0';
  const manifest = fixtureManifest(options.graderId, version);
  await db()
    .insert(graders)
    .values({ id: options.graderId, ownedByWorkspaceId: options.ownedByWorkspaceId ?? null })
    .onConflictDoNothing();
  await db()
    .insert(graderVersions)
    .values({
      graderId: options.graderId,
      version,
      evaluatorVersion: manifest.evaluatorVersion,
      manifest,
      publishedBy: null,
      verifiedAt: options.verifiedAt ?? null,
      publishedAt: options.publishedAt ?? new Date(),
      withdrawnAt: options.withdrawnAt ?? null,
    });
  return manifest;
}

afterAll(async () => {
  if (fixtureWorkspaces.length) {
    await db().delete(graderInstalls).where(inArray(graderInstalls.workspaceId, fixtureWorkspaces));
  }
  if (fixtureGraderIds.length) {
    await db().delete(graderVersions).where(inArray(graderVersions.graderId, fixtureGraderIds));
    await db().delete(graders).where(inArray(graders.id, fixtureGraderIds));
  }
  await db()
    .delete(workspaces)
    .where(inArray(workspaces.id, [...fixtureWorkspaces, ownerWorkspace]));
  await db().delete(users).where(eq(users.id, user));
  await closeDb();
});

test('seeding publishes every built-in as an ordinary verified row owned by nobody', async () => {
  await seedBuiltInGraders();
  for (const manifest of builtInManifests()) {
    const resolved = await graderVersion(manifest.id, manifest.version);
    expect(resolved).toEqual(manifest);
    const [row] = await db().select().from(graderVersions).where(
      and(eq(graderVersions.graderId, manifest.id), eq(graderVersions.version, manifest.version)),
    );
    expect(row.verifiedAt).toBeInstanceOf(Date);
    expect(row.publishedBy).toBeNull();
    const [grader] = await db().select().from(graders).where(eq(graders.id, manifest.id));
    expect(grader.ownedByWorkspaceId).toBeNull();
  }
});

test('seeding twice changes nothing', async () => {
  await seedBuiltInGraders();
  await seedBuiltInGraders();
  // Scoped to the built-in ids: another fixture elsewhere in the suite (a
  // published grader, say) also lives in grader_versions, and this assertion
  // is about seeding being idempotent, not about being the only tenant of
  // the table.
  const rows = await db()
    .select()
    .from(graderVersions)
    .where(inArray(graderVersions.graderId, builtInIds));
  expect(rows).toHaveLength(builtInManifests().length);
});

test("a published version's manifest is never rewritten", async () => {
  // grading_rubrics is gone, so there is no second row left to hash-compare a
  // stored manifest against before a run completes: "a grade must not
  // complete against a manifest that changed after the run was queued" now
  // rests entirely on this table's insert staying onConflictDoNothing.
  // "seeding twice changes nothing" only counts rows — an insert switched to
  // onConflictDoUpdate would rewrite every published manifest under every
  // live pin and leave that count unchanged. This proves the content itself,
  // not just the row count, survives an attempted re-seed.
  await seedBuiltInGraders();
  const before = await graderVersion(AGENT_READINESS, agentReadinessManifest.version);
  expect(before).toEqual(agentReadinessManifest);
  const altered = {
    ...agentReadinessManifest,
    disclaimer: 'ALTERED IN A TEST — must never be stored.',
  };
  // Mirrors seedBuiltInGraders' own insert for this row exactly, altered
  // manifest and all: same table, same conflict target, same
  // onConflictDoNothing. If that insert ever became onConflictDoUpdate — in
  // seedBuiltInGraders or here — this altered row would win and the
  // assertion below would fail.
  await db()
    .insert(graderVersions)
    .values({
      graderId: altered.id,
      version: altered.version,
      evaluatorVersion: altered.evaluatorVersion,
      manifest: altered,
      publishedBy: null,
    })
    .onConflictDoNothing();
  const after = await graderVersion(AGENT_READINESS, agentReadinessManifest.version);
  expect(after).toEqual(before);
  expect(after).toEqual(agentReadinessManifest);
});

test('a workspace with the built-ins installed resolves them, pinned', async () => {
  await seedBuiltInGraders();
  await installBuiltIns(workspace);
  const installed = await installedGraders(workspace);
  expect(installed.map((entry) => entry.manifest.id).sort()).toEqual(
    builtInManifests().map((manifest) => manifest.id).sort(),
  );
  const readiness = await installedGrader(workspace, AGENT_READINESS);
  expect(readiness?.version).toBe(agentReadinessManifest.version);
  expect(readiness?.consentedNeeds).toBe(needsHash(agentReadinessManifest.needs));
});

test('an uninstalled grader resolves as null for a workspace but still by version', async () => {
  await seedBuiltInGraders();
  expect(await installedGrader(workspace, AGENT_READINESS)).toBeNull();
  expect(await graderVersion(AGENT_READINESS, agentReadinessManifest.version)).toEqual(
    agentReadinessManifest,
  );
});

test('an unknown grader or version resolves as null rather than throwing', async () => {
  expect(await graderVersion('nobody/nothing', '0.1.0')).toBeNull();
  expect(await graderVersion(AGENT_READINESS, '9.9.9')).toBeNull();
});

test('latestPublishedVersion returns the newest non-withdrawn version', async () => {
  const graderId = fixtureGraderId();
  await publishVersion({ graderId, version: '0.1.0', publishedAt: new Date('2026-01-01T00:00:00Z') });
  await publishVersion({ graderId, version: '0.2.0', publishedAt: new Date('2026-02-01T00:00:00Z') });
  await publishVersion({
    graderId,
    version: '0.3.0',
    publishedAt: new Date('2026-03-01T00:00:00Z'),
    withdrawnAt: new Date('2026-03-02T00:00:00Z'),
  });
  const latest = await latestPublishedVersion(graderId);
  expect(latest?.version).toBe('0.2.0');
});

test("installedGraders reports a newer published version than the one it pinned, as latestVersion", async () => {
  const graderId = fixtureGraderId();
  const pinned = await publishVersion({
    graderId,
    version: '0.1.0',
    publishedAt: new Date('2026-01-01T00:00:00Z'),
  });
  await db()
    .insert(graderInstalls)
    .values({
      workspaceId: workspace,
      graderId,
      version: pinned.version,
      installedBy: null,
      consentedNeeds: needsHash(pinned.needs),
    });
  await publishVersion({ graderId, version: '0.2.0', publishedAt: new Date('2026-02-01T00:00:00Z') });

  const entry = (await installedGraders(workspace)).find((row) => row.manifest.id === graderId);
  expect(entry?.version).toBe('0.1.0');
  expect(entry?.latestVersion).toBe('0.2.0');
});

// The bug this guards: latestPublishedVersion() (and latestVersionsById())
// skip withdrawn rows, so once the version a workspace is pinned to is
// itself withdrawn, the newest surviving row can be OLDER than what is
// installed — an "Update available" that would actually be a downgrade.
test('withdrawing the installed version never offers an older one as an update', async () => {
  const graderId = fixtureGraderId();
  await publishVersion({ graderId, version: '0.1.0', publishedAt: new Date('2026-01-01T00:00:00Z') });
  const pinned = await publishVersion({
    graderId,
    version: '0.2.0',
    publishedAt: new Date('2026-02-01T00:00:00Z'),
  });
  await db()
    .insert(graderInstalls)
    .values({
      workspaceId: workspace,
      graderId,
      version: pinned.version,
      installedBy: null,
      consentedNeeds: needsHash(pinned.needs),
    });
  await db()
    .update(graderVersions)
    .set({ withdrawnAt: new Date() })
    .where(and(eq(graderVersions.graderId, graderId), eq(graderVersions.version, '0.2.0')));

  const entry = (await installedGraders(workspace)).find((row) => row.manifest.id === graderId);
  expect(entry?.version).toBe('0.2.0');
  expect(entry?.latestVersion).toBe('0.2.0');
  expect(await installedGrader(workspace, graderId)).toMatchObject({
    version: '0.2.0',
    latestVersion: '0.2.0',
  });
});

test('installedGraders returns a deterministic order, by install time, not insertion order', async () => {
  // Two fixture ids, both random UUID-derived — nothing about their string
  // order can explain the assertion below. Installed in the OPPOSITE order
  // from the row order asserted, and with installedAt set explicitly rather
  // than left to defaultNow(), so a query with no ORDER BY (Postgres's
  // natural order tends to follow insertion, but makes no promise, and
  // changes the moment a row is updated in place) would fail this the same
  // way a caller re-pinning a version in production would see its card row
  // jump.
  const installedSecond = fixtureGraderId();
  const installedFirst = fixtureGraderId();
  const secondManifest = await publishVersion({ graderId: installedSecond });
  const firstManifest = await publishVersion({ graderId: installedFirst });
  await db()
    .insert(graderInstalls)
    .values({
      workspaceId: workspace,
      graderId: installedSecond,
      version: secondManifest.version,
      installedBy: null,
      consentedNeeds: needsHash(secondManifest.needs),
      installedAt: new Date('2026-06-01T00:00:00Z'),
    });
  await db()
    .insert(graderInstalls)
    .values({
      workspaceId: workspace,
      graderId: installedFirst,
      version: firstManifest.version,
      installedBy: null,
      consentedNeeds: needsHash(firstManifest.needs),
      installedAt: new Date('2026-01-01T00:00:00Z'),
    });
  const installed = await installedGraders(workspace);
  const ids = installed
    .map((entry) => entry.manifest.id)
    .filter((id) => id === installedFirst || id === installedSecond);
  expect(ids).toEqual([installedFirst, installedSecond]);
});

test('browsableGraders hides a grader whose only version is withdrawn', async () => {
  const graderId = fixtureGraderId();
  await publishVersion({
    graderId,
    verifiedAt: new Date(),
    withdrawnAt: new Date(),
  });
  const rows = await browsableGraders(workspace);
  expect(rows.map((row) => row.id)).not.toContain(graderId);
});

test('browsableGraders sorts verified entries before unverified ones', async () => {
  const unverifiedId = fixtureGraderId();
  const verifiedId = fixtureGraderId();
  // Published earlier than the unverified one, to prove it is verified
  // status — not recency — that puts it first.
  await publishVersion({
    graderId: verifiedId,
    verifiedAt: new Date(),
    publishedAt: new Date('2025-01-01T00:00:00Z'),
  });
  await publishVersion({
    graderId: unverifiedId,
    verifiedAt: null,
    publishedAt: new Date('2026-01-01T00:00:00Z'),
  });
  const rows = await browsableGraders(workspace);
  const verifiedIndex = rows.findIndex((row) => row.id === verifiedId);
  const unverifiedIndex = rows.findIndex((row) => row.id === unverifiedId);
  expect(verifiedIndex).toBeGreaterThanOrEqual(0);
  expect(unverifiedIndex).toBeGreaterThanOrEqual(0);
  expect(verifiedIndex).toBeLessThan(unverifiedIndex);
});

test('browsableGraders sorts the newer published date first within the same verified group', async () => {
  const olderId = fixtureGraderId();
  const newerId = fixtureGraderId();
  await publishVersion({
    graderId: olderId,
    verifiedAt: new Date(),
    publishedAt: new Date('2026-01-01T00:00:00Z'),
  });
  await publishVersion({
    graderId: newerId,
    verifiedAt: new Date(),
    publishedAt: new Date('2026-06-01T00:00:00Z'),
  });
  const rows = await browsableGraders(workspace);
  const olderIndex = rows.findIndex((row) => row.id === olderId);
  const newerIndex = rows.findIndex((row) => row.id === newerId);
  expect(newerIndex).toBeGreaterThanOrEqual(0);
  expect(olderIndex).toBeGreaterThanOrEqual(0);
  expect(newerIndex).toBeLessThan(olderIndex);
});

test('browsableGraders reports fieldnote for an unowned grader and a workspace handle for an owned one', async () => {
  const unownedId = fixtureGraderId();
  const ownedId = fixtureGraderId();
  await publishVersion({ graderId: unownedId, verifiedAt: new Date() });
  await publishVersion({ graderId: ownedId, ownedByWorkspaceId: ownerWorkspace, verifiedAt: new Date() });
  const rows = await browsableGraders(workspace);
  expect(rows.find((row) => row.id === unownedId)?.author).toBe('fieldnote');
  const [ownerRow] = await db().select().from(workspaces).where(eq(workspaces.id, ownerWorkspace));
  expect(rows.find((row) => row.id === ownedId)?.author).toBe(ownerRow.handle);
});

test('browsableGraders carries the workspace install when one exists, and null otherwise', async () => {
  const installedId = fixtureGraderId();
  const uninstalledId = fixtureGraderId();
  const manifest = await publishVersion({ graderId: installedId, verifiedAt: new Date() });
  await publishVersion({ graderId: uninstalledId, verifiedAt: new Date() });
  await db()
    .insert(graderInstalls)
    .values({
      workspaceId: workspace,
      graderId: installedId,
      version: manifest.version,
      installedBy: null,
      consentedNeeds: needsHash(manifest.needs),
    });
  const rows = await browsableGraders(workspace);
  expect(rows.find((row) => row.id === installedId)?.installed?.version).toBe(manifest.version);
  expect(rows.find((row) => row.id === uninstalledId)?.installed).toBeNull();
});
