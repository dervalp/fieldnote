import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
vi.mock('server-only', () => ({}));
const fixture = vi.hoisted(() => ({
  workspaceId: 'settings-action-workspace',
  userId: 'settings-action-user',
}));
vi.mock('../../../auth/session', () => ({
  currentUser: async () => ({
    id: fixture.userId,
    login: 'fixture',
    displayName: null,
    avatarUrl: null,
  }),
  cookieOptions: {},
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: fixture.workspaceId }), set: () => {} }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('../../../lib/env', () => ({ env: () => ({ DEMO_MODE: 'false' }) }));
import { db, closeDb } from '../../../db';
import { users, workspaces, workspaceMemberships } from '../../../db/schema';
import { saveAccountName, saveWorkspaceName } from './actions';
async function cleanFixture() {
  await db()
    .delete(workspaceMemberships)
    .where(eq(workspaceMemberships.workspaceId, fixture.workspaceId));
  await db().delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
  await db().delete(users).where(eq(users.id, fixture.userId));
}
beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
  // Recover only this suite's fixed fixtures after an interrupted or failed run.
  await cleanFixture();
  await db().insert(users).values({ id: fixture.userId, login: 'fixture', credentials: 'fixture' });
  await db()
    .insert(workspaces)
    .values({ id: fixture.workspaceId, name: 'Original team', defaultForUserId: fixture.userId });
  await db()
    .insert(workspaceMemberships)
    .values({ workspaceId: fixture.workspaceId, userId: fixture.userId, role: 'owner' });
});
afterAll(async () => {
  try {
    await cleanFixture();
  } finally {
    await closeDb();
  }
});
test('trimmed account and workspace names persist independently', async () => {
  const account = new FormData();
  account.set('name', '  Jamie Davis  ');
  expect(await saveAccountName(account)).toEqual({});
  const [teamBefore] = await db()
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, fixture.workspaceId));
  expect(teamBefore.name).toBe('Original team');
  const team = new FormData();
  team.set('name', '  Acme engineering  ');
  expect(await saveWorkspaceName(team)).toEqual({});
  const [savedUser] = await db().select().from(users).where(eq(users.id, fixture.userId));
  const [savedTeam] = await db()
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, fixture.workspaceId));
  expect(savedUser.displayName).toBe('Jamie Davis');
  expect(savedTeam.name).toBe('Acme engineering');
});
