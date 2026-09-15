import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { and, eq, inArray } from 'drizzle-orm';
import { db, closeDb } from './index';
import { users, workspaces, workspaceMemberships, graders, graderVersions, graderInstalls } from './schema';
import { installGrader } from './queries/grader-installs';
import { installedGrader } from './queries/graders';
import { parseManifest } from '../domain/grading/registry';
import { needsHash } from '../domain/grading/needs-consent';

// A signed-out visitor is a session that throws, which is what currentUser()
// does in the real application; requireWorkspace() calls it first.
const context = vi.hoisted(() => ({ user: '', workspace: '', demo: false }));
vi.mock('../auth/session', () => ({
  currentUser: async () => {
    if (!context.user) throw new Error('Not signed in');
    return { id: context.user };
  },
  cookieOptions: {},
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: context.workspace }) }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
}));
vi.mock('../lib/env', () => ({ env: () => ({ DEMO_MODE: context.demo ? 'true' : 'false' }) }));

// A fixture id distinct from the acme/test-coverage grader that
// grader-publishing.integration.test.ts owns, so the two suites — which share
// the _test database and can run in the same process — never contend for the
// same (graders, grader_versions) primary key.
const FIXTURE_GRADER_ID = 'acme/consent-widget';

let owner = '';
let member = '';
let workspace = '';
beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
  owner = randomUUID();
  member = randomUUID();
  workspace = randomUUID();
  await db()
    .insert(users)
    .values([
      { id: owner, login: 'install-owner', credentials: 'fixture' },
      { id: member, login: 'install-member', credentials: 'fixture' },
    ]);
  await db().insert(workspaces).values([{ id: workspace, name: 'Installs', defaultForUserId: owner }]);
  await db()
    .insert(workspaceMemberships)
    .values([
      { workspaceId: workspace, userId: owner, role: 'owner' },
      { workspaceId: workspace, userId: member, role: 'member' },
    ]);
});

// grader_installs.graderId has no cascade (only grader_installs.workspaceId
// does), so an install row for the fixture grader must go before the version
// row, which must go before the grader row itself — FK order, every time.
async function deleteFixtureGrader(): Promise<void> {
  await db().delete(graderInstalls).where(eq(graderInstalls.workspaceId, workspace));
  await db().delete(graderVersions).where(eq(graderVersions.graderId, FIXTURE_GRADER_ID));
  await db().delete(graders).where(eq(graders.id, FIXTURE_GRADER_ID));
}

afterAll(async () => {
  await deleteFixtureGrader();
  // installGrader() calls requireWorkspace(), which calls
  // ensureDefaultWorkspace() for whoever the session names. member has no
  // defaultForUserId workspace of its own, so the "member cannot install"
  // test silently creates one (with its built-ins installed) the first time
  // it runs. Sweep by user id and by defaultForUserId, not just the fixture
  // workspace id, or that row and its memberships survive the run.
  await db()
    .delete(workspaceMemberships)
    .where(inArray(workspaceMemberships.userId, [owner, member]));
  await db().delete(workspaces).where(eq(workspaces.id, workspace));
  await db().delete(workspaces).where(inArray(workspaces.defaultForUserId, [owner, member]));
  await db().delete(users).where(inArray(users.id, [owner, member]));
  await closeDb();
});

beforeEach(async () => {
  context.user = owner;
  context.workspace = workspace;
  context.demo = false;
  await deleteFixtureGrader();
});

async function publishFixture(over: Record<string, unknown> = {}, ownedBy: string | null = null) {
  const manifest = parseManifest({
    id: FIXTURE_GRADER_ID,
    version: '0.1.0',
    evaluatorVersion: '1.0.0',
    subject: 'repository',
    mode: 'deterministic',
    category: 'test-discipline',
    kind: 'declarative',
    needs: { 'repo.files': ['README.md'] },
    disclaimer: 'Evidence, not certification.',
    card: {
      title: 'Consent Widget',
      tagline: 'Is it tested?',
      groups: [{ title: 'All', checks: ['readme'] }],
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
    ...over,
  });
  await db().insert(graders).values({ id: manifest.id, ownedByWorkspaceId: ownedBy }).onConflictDoNothing();
  await db()
    .insert(graderVersions)
    .values({
      graderId: manifest.id,
      version: manifest.version,
      evaluatorVersion: manifest.evaluatorVersion,
      manifest,
    })
    .onConflictDoNothing();
  return manifest;
}

test('installing pins the version and records the needs the workspace agreed to', async () => {
  const manifest = await publishFixture();
  await installGrader(manifest.id, manifest.version);
  const [row] = await db()
    .select()
    .from(graderInstalls)
    .where(and(eq(graderInstalls.workspaceId, workspace), eq(graderInstalls.graderId, manifest.id)));
  expect(row.version).toBe(manifest.version);
  expect(row.consentedNeeds).toBe(needsHash(manifest.needs));
  expect(row.installedBy).toBe(owner);
});

test('installing twice keeps the first install and its consent', async () => {
  const first = await publishFixture();
  // A second, real version — wider needs, so a wrong implementation that
  // re-pins on conflict would also rewrite consentedNeeds to a different
  // hash, not just leave the row's version field alone by coincidence.
  const second = await publishFixture({
    version: '0.2.0',
    needs: { 'repo.files': ['README.md', 'AGENTS.md'] },
  });
  await installGrader(first.id, first.version);
  await installGrader(second.id, second.version);
  const rows = await db().select().from(graderInstalls).where(eq(graderInstalls.workspaceId, workspace));
  expect(rows).toHaveLength(1);
  expect(rows[0].version).toBe(first.version);
  expect(rows[0].consentedNeeds).toBe(needsHash(first.needs));
});

test('a member cannot install', async () => {
  const manifest = await publishFixture();
  context.user = member;
  await expect(installGrader(manifest.id, manifest.version)).rejects.toThrow('not found');
  expect(await db().select().from(graderInstalls).where(eq(graderInstalls.workspaceId, workspace))).toEqual(
    [],
  );
});

test('a withdrawn version cannot be newly installed', async () => {
  const manifest = await publishFixture();
  await db().update(graderVersions).set({ withdrawnAt: new Date() }).where(eq(graderVersions.graderId, manifest.id));
  await expect(installGrader(manifest.id, manifest.version)).rejects.toThrow('Version unavailable');
});

test('an unknown grader or version cannot be installed', async () => {
  await expect(installGrader('nobody/nothing', '0.1.0')).rejects.toThrow('Version unavailable');
});

test('an unreviewed version installs, and the install records no verification of its own', async () => {
  const manifest = await publishFixture();
  await installGrader(manifest.id, manifest.version);
  const installed = await installedGrader(workspace, manifest.id);
  expect(installed?.verifiedAt).toBeNull();
  expect(installed?.manifest).toEqual(manifest);
});
