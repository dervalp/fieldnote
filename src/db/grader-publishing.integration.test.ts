import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDb } from './index';
import { users, workspaces, workspaceMemberships, graders, graderVersions } from './schema';
import {
  claimHandle,
  publishGrader,
  withdrawVersion,
  reviewQueue,
  verifyVersion,
} from './queries/grader-publishing';
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
  // Tests below flip users.staff on owner and secondOwner; reset it here so a
  // later test never inherits a staff flag left set by an earlier one.
  await db()
    .update(users)
    .set({ staff: false })
    .where(inArray(users.id, [owner, secondOwner, member]));
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

// reviewQueue() is deliberately global — staff review every workspace's
// unreviewed versions, not one workspace's own — so it is never scoped by
// this suite's fixture ids. The shared _test database means other suites'
// fixtures (fileParallelism: false runs them in the same database in file
// order) can leave their own unreviewed, unwithdrawn rows sitting in it, so
// every queue assertion below filters to this suite's own grader id rather
// than asserting on the whole queue.
const ours = (queue: Awaited<ReturnType<typeof reviewQueue>>) =>
  queue.filter((entry) => entry.graderId === 'acme/test-coverage');

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

test('a workspace with no handle cannot publish, and nothing is written', async () => {
  const before = await publishedCount();
  await expect(publishGrader(JSON.stringify(manifest()))).rejects.toThrow('Claim a handle first');
  expect(await publishedCount()).toBe(before);
  const [grader] = await db().select().from(graders).where(eq(graders.id, 'acme/test-coverage'));
  expect(grader).toBeUndefined();
});

test('a member cannot publish', async () => {
  await claimHandle('acme');
  context.user = member;
  await expect(publishGrader(JSON.stringify(manifest()))).rejects.toThrow('not found');
});

test('a code grader is refused while the licence question is open, and nothing is written', async () => {
  await claimHandle('acme');
  const before = await publishedCount();
  const code = manifest({
    kind: 'code',
    code: { source: 'export default () => ({ checks: [] });' },
    needs: { 'repo.tree': ['**/*'] },
    checks: [{ id: 'readme', title: 'T', points: 100, explain: { pass: 'Yes.', fail: 'No.' } }],
  });
  await expect(publishGrader(JSON.stringify(code))).rejects.toThrow(
    'Code graders cannot be published yet',
  );
  expect(await publishedCount()).toBe(before);
  const [grader] = await db().select().from(graders).where(eq(graders.id, 'acme/test-coverage'));
  expect(grader).toBeUndefined();
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

test('withdrawing an already-withdrawn version is refused, and its note and date stay put', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await withdrawVersion('acme/test-coverage', '0.1.0', 'First reason.');
  const [first] = await db()
    .select()
    .from(graderVersions)
    .where(eq(graderVersions.graderId, 'acme/test-coverage'));
  await expect(withdrawVersion('acme/test-coverage', '0.1.0', 'Second reason.')).rejects.toThrow(
    'Version unavailable',
  );
  const [after] = await db()
    .select()
    .from(graderVersions)
    .where(eq(graderVersions.graderId, 'acme/test-coverage'));
  expect(after.withdrawnNote).toBe('First reason.');
  expect(after.withdrawnAt).toEqual(first.withdrawnAt);
});

test('verifying a withdrawn version is refused, not silently re-stamped', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await withdrawVersion('acme/test-coverage', '0.1.0', 'Not ready.');
  await db().update(users).set({ staff: true }).where(eq(users.id, owner));
  await expect(verifyVersion('acme/test-coverage', '0.1.0')).rejects.toThrow('Version unavailable');
  const [row] = await db()
    .select()
    .from(graderVersions)
    .where(eq(graderVersions.graderId, 'acme/test-coverage'));
  expect(row.verifiedAt).toBeNull();
});

test('re-verifying an already-verified version still refreshes the reviewer and the date', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await db()
    .update(users)
    .set({ staff: true })
    .where(inArray(users.id, [owner, secondOwner]));
  await verifyVersion('acme/test-coverage', '0.1.0');
  context.user = secondOwner;
  await verifyVersion('acme/test-coverage', '0.1.0');
  const [row] = await db()
    .select()
    .from(graderVersions)
    .where(eq(graderVersions.graderId, 'acme/test-coverage'));
  expect(row.verifiedBy).toBe(secondOwner);
  expect(row.verifiedAt).toBeInstanceOf(Date);
});

test('withdrawing a version that was never published is refused, not silently accepted', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await expect(withdrawVersion('acme/test-coverage', '9.9.9', 'Nope.')).rejects.toThrow(
    'Version unavailable',
  );
});

test('staff can withdraw a version they do not own', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  context.user = secondOwner;
  context.workspace = otherWorkspace;
  await claimHandle('other');
  await db().update(users).set({ staff: true }).where(eq(users.id, secondOwner));
  await withdrawVersion('acme/test-coverage', '0.1.0', 'Staff pulled this.');
  const [row] = await db()
    .select()
    .from(graderVersions)
    .where(eq(graderVersions.graderId, 'acme/test-coverage'));
  expect(row.withdrawnAt).toBeInstanceOf(Date);
  expect(row.withdrawnNote).toBe('Staff pulled this.');
});

// requireWorkspace(undefined, 'owner') would 404 `member` here — their role
// in `workspace` (their cookie's own workspace) is 'member', not 'owner' —
// so this only passes if the staff branch skips that requirement entirely
// rather than merely skipping the ownership comparison after it.
test('a staff member who only belongs to their own cookie workspace can still withdraw another workspace\'s version', async () => {
  context.user = secondOwner;
  context.workspace = otherWorkspace;
  await claimHandle('other');
  await publishGrader(JSON.stringify(manifest({ id: 'other/test-coverage' })));
  await db().update(users).set({ staff: true }).where(eq(users.id, member));
  context.user = member;
  context.workspace = workspace;
  await withdrawVersion('other/test-coverage', '0.1.0', 'Staff pulled this.');
  const [row] = await db()
    .select()
    .from(graderVersions)
    .where(eq(graderVersions.graderId, 'other/test-coverage'));
  expect(row.withdrawnAt).toBeInstanceOf(Date);
});

test('a user who is neither staff nor the owner still cannot withdraw', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  context.user = secondOwner;
  context.workspace = otherWorkspace;
  await claimHandle('other');
  await expect(withdrawVersion('acme/test-coverage', '0.1.0', 'Nope.')).rejects.toThrow(
    'Grader unavailable',
  );
  const [row] = await db()
    .select()
    .from(graderVersions)
    .where(eq(graderVersions.graderId, 'acme/test-coverage'));
  expect(row.withdrawnAt).toBeNull();
});

test('verifying a version that does not exist is refused, not silently accepted', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await db().update(users).set({ staff: true }).where(eq(users.id, owner));
  await expect(verifyVersion('acme/test-coverage', '9.9.9')).rejects.toThrow(
    'Version unavailable',
  );
});

test('the queue holds every unreviewed, unwithdrawn version, newest first', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await publishGrader(JSON.stringify(manifest({ version: '0.2.0' })));
  await db().update(users).set({ staff: true }).where(eq(users.id, owner));
  const queue = ours(await reviewQueue());
  expect(queue.map((entry) => entry.version)).toEqual(['0.2.0', '0.1.0']);
  expect(queue[0].manifest.card.title).toBe('Test Coverage');
  expect(queue[0].author).toBe('acme');
});

// Three versions, not two: with only two rows tied on publishedAt, Postgres's
// heap-scan order can coincidentally still come back descending even with no
// ORDER BY tiebreak at all, so the assertion would not reliably fail if the
// desc(version) clause were ever removed. Three rows pinned to the exact same
// timestamp, asserted in exact descending order, does fail without it —
// verified locally by removing the `desc(version)` tiebreak and re-running
// this test, which returned ['0.3.0', '0.1.0', '0.2.0']: not descending, and
// not the plain ascending insertion order either — just whatever order
// Postgres's plan happened to produce for three rows with an identical sort
// key and no tiebreak.
test('a queue tie on publishedAt breaks by version, newest first', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await publishGrader(JSON.stringify(manifest({ version: '0.2.0' })));
  await publishGrader(JSON.stringify(manifest({ version: '0.3.0' })));
  const tied = new Date('2026-09-15T00:00:00Z');
  await db()
    .update(graderVersions)
    .set({ publishedAt: tied })
    .where(eq(graderVersions.graderId, 'acme/test-coverage'));
  await db().update(users).set({ staff: true }).where(eq(users.id, owner));
  const queue = ours(await reviewQueue());
  expect(queue.map((entry) => entry.version)).toEqual(['0.3.0', '0.2.0', '0.1.0']);
});

test('a non-staff user cannot read the queue or verify', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await db().update(users).set({ staff: false }).where(eq(users.id, owner));
  await expect(reviewQueue()).rejects.toThrow('not found');
  await expect(verifyVersion('acme/test-coverage', '0.1.0')).rejects.toThrow('not found');
  // Filtered by graderId, not a bare select: the shared _test database also
  // carries the seeded built-in graders' rows by the time this test runs.
  const [row] = await db()
    .select()
    .from(graderVersions)
    .where(eq(graderVersions.graderId, 'acme/test-coverage'));
  expect(row.verifiedAt).toBeNull();
});

test('verifying records the reviewer and the date, and takes it out of the queue', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await db().update(users).set({ staff: true }).where(eq(users.id, owner));
  await verifyVersion('acme/test-coverage', '0.1.0');
  const [row] = await db()
    .select()
    .from(graderVersions)
    .where(eq(graderVersions.graderId, 'acme/test-coverage'));
  expect(row.verifiedAt).toBeInstanceOf(Date);
  expect(row.verifiedBy).toBe(owner);
  expect(ours(await reviewQueue())).toEqual([]);
});

test('a new version starts unreviewed however many predecessors were read', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await db().update(users).set({ staff: true }).where(eq(users.id, owner));
  await verifyVersion('acme/test-coverage', '0.1.0');
  await publishGrader(JSON.stringify(manifest({ version: '0.2.0' })));
  expect(ours(await reviewQueue()).map((entry) => entry.version)).toEqual(['0.2.0']);
});

test('a withdrawn version leaves the queue without being verified', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await withdrawVersion('acme/test-coverage', '0.1.0', 'Not ready.');
  await db().update(users).set({ staff: true }).where(eq(users.id, owner));
  expect(ours(await reviewQueue())).toEqual([]);
});
