import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { and, eq, inArray } from 'drizzle-orm';
import { db, closeDb } from './index';
import {
  users,
  workspaces,
  workspaceMemberships,
  graders,
  graderVersions,
  graderInstalls,
  gradeSchedules,
  publicGrades,
  gradeRuns,
  installations,
  repositories,
} from './schema';
import { installGrader, updateInstall, uninstallGrader } from './queries/grader-installs';
import { installedGrader } from './queries/graders';
import { parseManifest } from '../domain/grading/registry';
import { needsHash } from '../domain/grading/needs-consent';
import { runDeclarative } from '../domain/grading/declarative';

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
// A second owner and workspace, used only by the "another workspace's rows
// are untouched" test below — kept separate from `owner`/`workspace` so that
// test can't pass by accident just because it reused the same ids.
let secondOwner = '';
let otherWorkspace = '';
beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
  owner = randomUUID();
  member = randomUUID();
  workspace = randomUUID();
  secondOwner = randomUUID();
  otherWorkspace = randomUUID();
  await db()
    .insert(users)
    .values([
      { id: owner, login: 'install-owner', credentials: 'fixture' },
      { id: member, login: 'install-member', credentials: 'fixture' },
      { id: secondOwner, login: 'install-owner-2', credentials: 'fixture' },
    ]);
  await db()
    .insert(workspaces)
    .values([
      { id: workspace, name: 'Installs', defaultForUserId: owner },
      { id: otherWorkspace, name: 'Other Installs', defaultForUserId: secondOwner },
    ]);
  await db()
    .insert(workspaceMemberships)
    .values([
      { workspaceId: workspace, userId: owner, role: 'owner' },
      { workspaceId: workspace, userId: member, role: 'member' },
      { workspaceId: otherWorkspace, userId: secondOwner, role: 'owner' },
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

// Repositories the uninstall tests create, so gradeSchedules/gradeRuns/
// publicGrades fixtures have somewhere to point. Neither grade_schedules,
// public_grades nor grade_runs carries a foreign key to graders (only a plain
// text grader_id), so these never conflict with deleteFixtureGrader() above —
// but they do carry foreign keys to repositories/installations/workspaces/
// users, so they must be deleted before those, in this order, every time.
const fixtureRepositories: string[] = [];
async function fixtureRepository(): Promise<string> {
  const id = randomUUID();
  fixtureRepositories.push(id);
  await db()
    .insert(installations)
    .values({ id, githubInstallationId: id, accountLogin: 'test', accountType: 'User', active: true });
  await db()
    .insert(repositories)
    .values({
      id,
      installationId: id,
      githubRepositoryId: id,
      owner: `owner-${id.slice(0, 8)}`,
      name: 'repo',
      defaultBranch: 'main',
      isPrivate: false,
      active: true,
      isDemo: false,
    });
  return id;
}

async function deleteFixtureRepositories(): Promise<void> {
  if (fixtureRepositories.length === 0) return;
  await db().delete(gradeRuns).where(inArray(gradeRuns.repositoryId, fixtureRepositories));
  await db().delete(gradeSchedules).where(inArray(gradeSchedules.repositoryId, fixtureRepositories));
  await db().delete(publicGrades).where(inArray(publicGrades.repositoryId, fixtureRepositories));
  await db().delete(repositories).where(inArray(repositories.id, fixtureRepositories));
  await db().delete(installations).where(inArray(installations.id, fixtureRepositories));
  fixtureRepositories.length = 0;
}

afterAll(async () => {
  await deleteFixtureRepositories();
  await deleteFixtureGrader();
  // installGrader() calls requireWorkspace(), which calls
  // ensureDefaultWorkspace() for whoever the session names. member has no
  // defaultForUserId workspace of its own, so the "member cannot install"
  // test silently creates one (with its built-ins installed) the first time
  // it runs. Sweep by user id and by defaultForUserId, not just the fixture
  // workspace id, or that row and its memberships survive the run.
  await db()
    .delete(workspaceMemberships)
    .where(inArray(workspaceMemberships.userId, [owner, member, secondOwner]));
  await db().delete(workspaces).where(inArray(workspaces.id, [workspace, otherWorkspace]));
  await db()
    .delete(workspaces)
    .where(inArray(workspaces.defaultForUserId, [owner, member, secondOwner]));
  await db().delete(users).where(inArray(users.id, [owner, member, secondOwner]));
  await closeDb();
});

beforeEach(async () => {
  context.user = owner;
  context.workspace = workspace;
  context.demo = false;
  await deleteFixtureRepositories();
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

// A complete run for a fixture grader, as src/db/public-grades.integration.test.ts's
// own completedRun() does for AGENT_READINESS — the manifest here is whichever
// version publishFixture() just published, not the built-in.
async function completedRun(
  repositoryId: string,
  manifest: Awaited<ReturnType<typeof publishFixture>>,
): Promise<string> {
  const id = randomUUID();
  const sha = 'a'.repeat(40);
  const result = runDeclarative(manifest, {
    sha,
    complete: true,
    documents: [{ path: 'README.md', blobSha: 'b'.repeat(40), text: 'hello' }],
  });
  await db()
    .insert(gradeRuns)
    .values({
      id,
      repositoryId,
      graderId: manifest.id,
      rubricVersion: manifest.version,
      evaluatorVersion: manifest.evaluatorVersion,
      requestedBy: owner,
      requestedWorkspaceId: workspace,
      state: 'complete',
      sha,
      result,
      completedAt: new Date('2026-09-01T00:00:00.000Z'),
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    });
  return id;
}

test('an update whose needs are unchanged re-pins the version', async () => {
  const first = await publishFixture();
  await installGrader(first.id, first.version);
  const second = await publishFixture({ version: '0.2.0', disclaimer: 'Reworded.' });
  await updateInstall(second.id, second.version);
  const installed = await installedGrader(workspace, second.id);
  expect(installed?.version).toBe('0.2.0');
  expect(installed?.consentedNeeds).toBe(needsHash(second.needs));
});

test('an update that widens needs records the new consent', async () => {
  const first = await publishFixture();
  await installGrader(first.id, first.version);
  const wider = await publishFixture({
    version: '0.3.0',
    needs: { 'repo.files': ['README.md', 'src/**/*.ts'] },
  });
  await updateInstall(wider.id, wider.version);
  const installed = await installedGrader(workspace, wider.id);
  expect(installed?.consentedNeeds).toBe(needsHash(wider.needs));
  expect(installed?.consentedNeeds).not.toBe(needsHash(first.needs));
});

test('updating refuses a withdrawn version', async () => {
  const manifest = await publishFixture();
  await installGrader(manifest.id, manifest.version);
  const next = await publishFixture({ version: '0.2.0' });
  await db()
    .update(graderVersions)
    .set({ withdrawnAt: new Date() })
    .where(and(eq(graderVersions.graderId, next.id), eq(graderVersions.version, next.version)));
  await expect(updateInstall(next.id, next.version)).rejects.toThrow('Version unavailable');
});

test('updateInstall refuses a grader this workspace never installed', async () => {
  const manifest = await publishFixture();
  await expect(updateInstall(manifest.id, manifest.version)).rejects.toThrow('Grader not installed');
});

test('uninstalling clears this workspace nightly schedules and revokes public sharing for that grader', async () => {
  const manifest = await publishFixture();
  await installGrader(manifest.id, manifest.version);
  const repositoryId = await fixtureRepository();
  await db()
    .insert(gradeSchedules)
    .values({ repositoryId, graderId: manifest.id, enabledBy: owner, workspaceId: workspace });
  await db()
    .insert(publicGrades)
    .values({ repositoryId, graderId: manifest.id, enabledBy: owner, workspaceId: workspace });
  await uninstallGrader(manifest.id);
  expect(await db().select().from(graderInstalls).where(eq(graderInstalls.workspaceId, workspace))).toEqual(
    [],
  );
  expect(await db().select().from(gradeSchedules).where(eq(gradeSchedules.graderId, manifest.id))).toEqual(
    [],
  );
  const [revoked] = await db()
    .select()
    .from(publicGrades)
    .where(eq(publicGrades.graderId, manifest.id));
  expect(revoked).toBeDefined();
  expect(revoked.revokedAt).toBeInstanceOf(Date);
});

test('uninstalling leaves another workspace rows for the same repository alone', async () => {
  const manifest = await publishFixture();
  await installGrader(manifest.id, manifest.version);
  const repositoryId = await fixtureRepository();
  await db()
    .insert(gradeSchedules)
    .values({ repositoryId, graderId: manifest.id, enabledBy: secondOwner, workspaceId: otherWorkspace });
  await uninstallGrader(manifest.id);
  const rows = await db().select().from(gradeSchedules).where(eq(gradeSchedules.graderId, manifest.id));
  expect(rows.map((row) => row.workspaceId)).toEqual([otherWorkspace]);
});

test('uninstalling leaves grade history intact', async () => {
  const manifest = await publishFixture();
  await installGrader(manifest.id, manifest.version);
  const repositoryId = await fixtureRepository();
  const runId = await completedRun(repositoryId, manifest);
  await uninstallGrader(manifest.id);
  expect(await db().select().from(gradeRuns).where(eq(gradeRuns.id, runId))).toHaveLength(1);
});

test('uninstalling a grader that is not installed is a silent no-op', async () => {
  const manifest = await publishFixture();
  await expect(uninstallGrader(manifest.id)).resolves.toBeUndefined();
});

test('a member cannot update or uninstall', async () => {
  const manifest = await publishFixture();
  await installGrader(manifest.id, manifest.version);
  context.user = member;
  await expect(updateInstall(manifest.id, manifest.version)).rejects.toThrow('not found');
  await expect(uninstallGrader(manifest.id)).rejects.toThrow('not found');
});
