import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDb } from './index';
import {
  users,
  workspaces,
  workspaceMemberships,
  workspaceRepositories,
  graders,
  graderVersions,
  graderInstalls,
  gradeSchedules,
  publicGrades,
  gradeRuns,
  installations,
  repositories,
} from './schema';
import { claimHandle, publishGrader, verifyVersion } from './queries/grader-publishing';
import { installGrader, updateInstall, uninstallGrader } from './queries/grader-installs';
import { installedGrader } from './queries/graders';
import { requestGrade, beginGrade, loadGradeRun } from './queries/grade-runs';
import { resolveGradeCommit, evaluateGradeRun } from '../inngest/functions/grade-repository';
import { writeGradeSchedule } from './queries/grade-schedules';
import { writePublicGrade } from './queries/public-grade-settings';
import { needsHash } from '../domain/grading/needs-consent';
import { ManifestError } from '../domain/grading/manifest';

const HEAD_SHA = 'a'.repeat(40);
// Same mock as src/db/grade-schedules.integration.test.ts: resolveHeadSha is a
// fixed stub, and collectFiles gets a per-test return value to drive a run
// through the worker.
const github = vi.hoisted(() => ({ collect: vi.fn(), tree: vi.fn() }));
vi.mock('../github/collect-files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../github/collect-files')>()),
  resolveHeadSha: async () => HEAD_SHA,
  collectFiles: github.collect,
  collectTree: github.tree,
}));

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

// A fixture id distinct from acme/test-coverage (owned by
// grader-publishing.integration.test.ts) and acme/consent-widget (owned by
// grader-installs.integration.test.ts) — the two suites this one's harness is
// built from — so the three never contend for the same (graders,
// grader_versions) primary key in the shared _test database.
const FIXTURE_GRADER_ID = 'acme/lifecycle-widget';

let owner = '';
let member = '';
let workspace = '';
let secondOwner = '';
let otherWorkspace = '';
let staffUser = '';
beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
  owner = randomUUID();
  member = randomUUID();
  workspace = randomUUID();
  secondOwner = randomUUID();
  otherWorkspace = randomUUID();
  staffUser = randomUUID();
  await db()
    .insert(users)
    .values([
      { id: owner, login: 'lifecycle-owner', credentials: 'fixture' },
      { id: member, login: 'lifecycle-member', credentials: 'fixture' },
      { id: secondOwner, login: 'lifecycle-owner-2', credentials: 'fixture' },
      { id: staffUser, login: 'lifecycle-staff', credentials: 'fixture' },
    ]);
  await db()
    .insert(workspaces)
    .values([
      { id: workspace, name: 'Lifecycle', defaultForUserId: owner },
      { id: otherWorkspace, name: 'Other Lifecycle', defaultForUserId: secondOwner },
    ]);
  await db()
    .insert(workspaceMemberships)
    .values([
      { workspaceId: workspace, userId: owner, role: 'owner' },
      { workspaceId: workspace, userId: member, role: 'member' },
      { workspaceId: otherWorkspace, userId: secondOwner, role: 'owner' },
    ]);
});

const fixtureRepositories: string[] = [];
// Linked to `workspace` (the installing side) only — requestGrade(),
// writeGradeSchedule() and writePublicGrade() all resolve the caller's
// workspace through requireRepository(), which needs the link to exist.
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
  await db()
    .insert(workspaceRepositories)
    .values({ workspaceId: workspace, repositoryId: id, connectedBy: owner });
  return id;
}

afterAll(async () => {
  if (fixtureRepositories.length) {
    await db().delete(gradeRuns).where(inArray(gradeRuns.repositoryId, fixtureRepositories));
    await db().delete(gradeSchedules).where(inArray(gradeSchedules.repositoryId, fixtureRepositories));
    await db().delete(publicGrades).where(inArray(publicGrades.repositoryId, fixtureRepositories));
    await db()
      .delete(workspaceRepositories)
      .where(inArray(workspaceRepositories.repositoryId, fixtureRepositories));
    await db().delete(repositories).where(inArray(repositories.id, fixtureRepositories));
    await db().delete(installations).where(inArray(installations.id, fixtureRepositories));
  }
  // grader_installs.graderId has no cascade (only grader_installs.workspaceId
  // does), so its row for the fixture grader must go before the version row,
  // which must go before the grader row itself — FK order, every time.
  await db()
    .delete(graderInstalls)
    .where(inArray(graderInstalls.workspaceId, [workspace, otherWorkspace]));
  await db().delete(graderVersions).where(eq(graderVersions.graderId, FIXTURE_GRADER_ID));
  await db().delete(graders).where(eq(graders.id, FIXTURE_GRADER_ID));
  // requireWorkspace() calls ensureDefaultWorkspace() for whoever the session
  // names, and member/secondOwner/staffUser have no defaultForUserId workspace
  // of their own — only the fixture "workspace"/"otherWorkspace" do. Sweep by
  // user id and by defaultForUserId, not just the fixture workspace ids, or
  // those rows survive the run and trip the users foreign key below.
  await db()
    .delete(workspaceMemberships)
    .where(inArray(workspaceMemberships.userId, [owner, member, secondOwner, staffUser]));
  await db().delete(workspaces).where(inArray(workspaces.id, [workspace, otherWorkspace]));
  await db()
    .delete(workspaces)
    .where(inArray(workspaces.defaultForUserId, [owner, member, secondOwner, staffUser]));
  await db().delete(users).where(inArray(users.id, [owner, member, secondOwner, staffUser]));
  await closeDb();
});

const manifest = (over: Record<string, unknown> = {}) => ({
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
    title: 'Lifecycle Widget',
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

test('publish, verify, install, grade, widen, update, uninstall', async () => {
  // acme publishes.
  context.user = secondOwner;
  context.workspace = otherWorkspace;
  await claimHandle('acme');
  const first = await publishGrader(JSON.stringify(manifest()));

  // fieldnote reads it.
  await db().update(users).set({ staff: true }).where(eq(users.id, staffUser));
  context.user = staffUser;
  await verifyVersion(first.id, first.version);

  // The other workspace installs it and grades with it.
  context.user = owner;
  context.workspace = workspace;
  await installGrader(first.id, first.version);
  const repositoryId = await fixtureRepository();
  github.collect.mockResolvedValueOnce({
    sha: HEAD_SHA,
    complete: true,
    documents: [{ path: 'README.md', blobSha: 'b'.repeat(40), text: 'hi' }],
  });
  const run = await requestGrade(repositoryId, first.id);
  await beginGrade(run.id);
  await resolveGradeCommit(run.id);
  await evaluateGradeRun(run.id);
  const graded = await loadGradeRun(run.id);
  expect(graded?.state).toBe('complete');
  expect(graded?.rubricVersion).toBe(first.version);

  // acme publishes a version that reads more. The install does not move.
  context.user = secondOwner;
  context.workspace = otherWorkspace;
  const wider = await publishGrader(
    JSON.stringify(manifest({ version: '0.2.0', needs: { 'repo.files': ['README.md', 'src/**/*.ts'] } })),
  );
  context.user = owner;
  context.workspace = workspace;
  expect((await installedGrader(workspace, first.id))?.version).toBe(first.version);

  // A run still grades against the pinned version, and its evidence is the old one.
  github.collect.mockResolvedValueOnce({ sha: HEAD_SHA, complete: true, documents: [] });
  const second = await requestGrade(repositoryId, first.id);
  expect((await loadGradeRun(second.id))?.rubricVersion).toBe(first.version);

  // Updating re-pins and re-consents.
  await updateInstall(wider.id, wider.version);
  const updated = await installedGrader(workspace, wider.id);
  expect(updated?.version).toBe('0.2.0');
  expect(updated?.consentedNeeds).toBe(needsHash(wider.needs));

  // Uninstalling takes this workspace's schedule and sharing with it, and
  // leaves history: uninstallGrader revokes public sharing rather than
  // deleting it — slice 5 made revocation work that way everywhere else — so
  // this workspace's public_grades row survives, marked revoked.
  await writeGradeSchedule(repositoryId, first.id, true);
  await writePublicGrade(repositoryId, first.id, true);
  await uninstallGrader(first.id);
  expect(await db().select().from(gradeSchedules).where(eq(gradeSchedules.graderId, first.id))).toEqual(
    [],
  );
  const [revoked] = await db()
    .select()
    .from(publicGrades)
    .where(eq(publicGrades.graderId, first.id));
  expect(revoked).toBeDefined();
  expect(revoked.revokedAt).toBeInstanceOf(Date);
  expect((await loadGradeRun(run.id))?.state).toBe('complete');

  // And a run can no longer be requested: the install gate, not just any
  // failure, is what refuses it.
  const refusal = await requestGrade(repositoryId, first.id).catch((error: unknown) => error);
  expect(refusal).toBeInstanceOf(ManifestError);
  expect((refusal as ManifestError).code).toBe('unknown_grader');
});
