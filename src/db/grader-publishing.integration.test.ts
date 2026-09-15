import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDb } from './index';
import { users, workspaces, workspaceMemberships } from './schema';
import { claimHandle } from './queries/grader-publishing';

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

afterAll(async () => {
  // requireWorkspace() calls ensureDefaultWorkspace() for whoever the session
  // names, and secondOwner and member have no defaultForUserId of their own —
  // only the fixture "workspace" does. That call silently creates a personal
  // workspace and membership the first time either of them goes through
  // claimHandle(). Sweep by user id and by defaultForUserId rather than just
  // the fixture workspace ids, so those rows don't survive the run and trip
  // the users foreign key below.
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
