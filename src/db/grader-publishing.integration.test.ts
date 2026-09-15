import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDb } from './index';
import { users, workspaces, workspaceMemberships, graders, graderVersions } from './schema';
import { claimHandle, publishGrader, withdrawVersion } from './queries/grader-publishing';
import { graderVersion, latestPublishedVersion } from './queries/graders';
import { ManifestError } from '../domain/grading/manifest';

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

let owner = '';
let secondOwner = '';
let member = '';
let workspace = '';
let otherWorkspace = '';
beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
  owner = randomUUID();
  secondOwner = randomUUID();
  member = randomUUID();
  workspace = randomUUID();
  otherWorkspace = randomUUID();
  await db()
    .insert(users)
    .values([
      { id: owner, login: 'owner', credentials: 'fixture' },
      { id: secondOwner, login: 'owner-two', credentials: 'fixture' },
      { id: member, login: 'member', credentials: 'fixture' },
    ]);
  await db()
    .insert(workspaces)
    .values([
      { id: workspace, name: 'Handles', defaultForUserId: owner },
      { id: otherWorkspace, name: 'Other handles' },
    ]);
  await db()
    .insert(workspaceMemberships)
    .values([
      { workspaceId: workspace, userId: owner, role: 'owner' },
      { workspaceId: workspace, userId: secondOwner, role: 'owner' },
      { workspaceId: workspace, userId: member, role: 'member' },
      { workspaceId: otherWorkspace, userId: secondOwner, role: 'owner' },
    ]);
});

// Every test below publishes the same grader id, acme/test-coverage, into the
// _test database shared with every other suite. Without this, the second
// test to publish it would hit 'Version already published' on its own first
// call. Delete in FK order — grader_versions before graders — and scope by
// ownedByWorkspaceId, which is safe against the seeded built-in graders
// (owned by nobody, ownedByWorkspaceId null).
async function deletePublishedGraders(): Promise<void> {
  const owned = await db()
    .select({ id: graders.id })
    .from(graders)
    .where(inArray(graders.ownedByWorkspaceId, [workspace, otherWorkspace]));
  const ids = owned.map((row) => row.id);
  if (ids.length === 0) return;
  await db().delete(graderVersions).where(inArray(graderVersions.graderId, ids));
  await db().delete(graders).where(inArray(graders.id, ids));
}

afterAll(async () => {
  // requireWorkspace() calls ensureDefaultWorkspace() for whoever the session
  // names, and secondOwner and member have no defaultForUserId of their own —
  // only the fixture "workspace" does. That call silently creates a personal
  // workspace and membership the first time either of them goes through
  // claimHandle(). Sweep by user id and by defaultForUserId rather than just
  // the fixture workspace ids, so those rows don't survive the run and trip
  // the users foreign key below.
  //
  // graders.ownedByWorkspaceId has no cascade on workspace delete (a
  // workspace that published cannot be silently deleted), so published
  // graders must be swept before the workspaces themselves, or this delete
  // fails its own foreign key.
  await deletePublishedGraders();
  await db()
    .delete(workspaceMemberships)
    .where(inArray(workspaceMemberships.userId, [owner, secondOwner, member]));
  await db()
    .delete(workspaces)
    .where(inArray(workspaces.id, [workspace, otherWorkspace]));
  await db()
    .delete(workspaces)
    .where(inArray(workspaces.defaultForUserId, [owner, secondOwner, member]));
  await db()
    .delete(users)
    .where(inArray(users.id, [owner, secondOwner, member]));
  await closeDb();
});

beforeEach(async () => {
  context.user = owner;
  context.workspace = workspace;
  context.demo = false;
  await db().update(workspaces).set({ handle: null }).where(eq(workspaces.id, workspace));
  await db().update(workspaces).set({ handle: null }).where(eq(workspaces.id, otherWorkspace));
  await deletePublishedGraders();
});

test('an owner claims a handle once, and it is theirs', async () => {
  await claimHandle('acme');
  const [row] = await db().select().from(workspaces).where(eq(workspaces.id, workspace));
  expect(row.handle).toBe('acme');
});

test('a handle cannot be changed once claimed', async () => {
  await claimHandle('acme');
  await expect(claimHandle('acme-two')).rejects.toThrow('Handle already claimed');
  const [row] = await db().select().from(workspaces).where(eq(workspaces.id, workspace));
  expect(row.handle).toBe('acme');
});

test('a handle another workspace holds is refused', async () => {
  context.user = secondOwner;
  context.workspace = otherWorkspace;
  await claimHandle('acme');
  context.user = owner;
  context.workspace = workspace;
  await expect(claimHandle('acme')).rejects.toThrow('Handle unavailable');
  const [row] = await db().select().from(workspaces).where(eq(workspaces.id, workspace));
  expect(row.handle).toBeNull();
});

test.each(['fieldnote', 'admin', 'api', 'app', 'r', 'www', 'support'])(
  '%s is reserved',
  async (handle) => {
    await expect(claimHandle(handle)).rejects.toThrow('Handle unavailable');
  },
);

test.each(['Acme', 'a', '-acme', 'acme_two', 'acme!', 'a'.repeat(40)])(
  '%s is not a handle',
  async (handle) => {
    await expect(claimHandle(handle)).rejects.toThrow('Invalid handle');
  },
);

test('a member cannot claim a handle', async () => {
  context.user = member;
  await expect(claimHandle('acme')).rejects.toThrow('not found');
  const [row] = await db().select().from(workspaces).where(eq(workspaces.id, workspace));
  expect(row.handle).toBeNull();
});

const manifest = (over: Record<string, unknown> = {}) => ({
  id: 'acme/test-coverage',
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'test-discipline',
  kind: 'declarative',
  needs: { 'repo.files': ['README.md'] },
  disclaimer: 'Evidence, not certification.',
  card: { title: 'Test Coverage', tagline: 'Is it tested?', groups: [{ title: 'All', checks: ['readme'] }] },
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
const publishedCount = async () => (await db().select().from(graderVersions)).length;

test('an owner publishes a declarative grader under their own handle, unreviewed', async () => {
  await claimHandle('acme');
  const published = await publishGrader(JSON.stringify(manifest()));
  expect(published.id).toBe('acme/test-coverage');
  const [row] = await db()
    .select()
    .from(graderVersions)
    .where(eq(graderVersions.graderId, 'acme/test-coverage'));
  expect(row.verifiedAt).toBeNull();
  expect(row.withdrawnAt).toBeNull();
  expect(row.publishedBy).toBe(owner);
  const [grader] = await db().select().from(graders).where(eq(graders.id, 'acme/test-coverage'));
  expect(grader.ownedByWorkspaceId).toBe(workspace);
});

test('a manifest whose id is not under this handle is refused', async () => {
  await claimHandle('acme');
  const before = await publishedCount();
  await expect(publishGrader(JSON.stringify(manifest({ id: 'other/thing' })))).rejects.toThrow(
    'Wrong namespace',
  );
  expect(await publishedCount()).toBe(before);
});

test('a workspace with no handle cannot publish', async () => {
  await expect(publishGrader(JSON.stringify(manifest()))).rejects.toThrow('Claim a handle first');
});

test('a member cannot publish', async () => {
  await claimHandle('acme');
  context.user = member;
  await expect(publishGrader(JSON.stringify(manifest()))).rejects.toThrow('not found');
});

test('a code grader is refused while the licence question is open', async () => {
  await claimHandle('acme');
  const code = manifest({
    kind: 'code',
    code: { source: 'export default () => ({ checks: [] });' },
    needs: { 'repo.tree': ['**/*'] },
    checks: [{ id: 'readme', title: 'T', points: 100, explain: { pass: 'Yes.', fail: 'No.' } }],
  });
  await expect(publishGrader(JSON.stringify(code))).rejects.toThrow(
    'Code graders cannot be published yet',
  );
});

test('a version that already exists is refused, and the stored one is untouched', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await expect(
    publishGrader(JSON.stringify(manifest({ disclaimer: 'Rewritten after the fact.' }))),
  ).rejects.toThrow('Version already published');
  const stored = await graderVersion('acme/test-coverage', '0.1.0');
  expect(stored?.disclaimer).toBe('Evidence, not certification.');
});

test('another workspace cannot reach this grader name, because it cannot hold the handle', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  context.user = secondOwner;
  context.workspace = otherWorkspace;
  // The namespace check is only as strong as the handle's uniqueness, so this
  // is where that is pinned: the second workspace cannot own `acme`, and
  // therefore cannot publish anything under `acme/`.
  await expect(claimHandle('acme')).rejects.toThrow('Handle unavailable');
  await claimHandle('other');
  await expect(publishGrader(JSON.stringify(manifest()))).rejects.toThrow('Wrong namespace');
});

test('a manifest that fails parseManifest is refused with its own error', async () => {
  await claimHandle('acme');
  await expect(
    publishGrader(JSON.stringify(manifest({ checks: [{ ...manifest().checks[0], points: 60 }] }))),
  ).rejects.toBeInstanceOf(ManifestError);
  await expect(publishGrader('not json')).rejects.toBeInstanceOf(ManifestError);
});

test('withdrawing hides a version from browsing and keeps it resolvable', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await withdrawVersion('acme/test-coverage', '0.1.0', 'Superseded.');
  const [row] = await db()
    .select()
    .from(graderVersions)
    .where(eq(graderVersions.graderId, 'acme/test-coverage'));
  expect(row.withdrawnAt).toBeInstanceOf(Date);
  expect(row.withdrawnNote).toBe('Superseded.');
  expect(await graderVersion('acme/test-coverage', '0.1.0')).not.toBeNull();
  expect(await latestPublishedVersion('acme/test-coverage')).toBeNull();
});
