import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const fixture = vi.hoisted(() => ({
  userId: 'workspace-access-user',
  cookieWorkspaceId: undefined as string | undefined,
  paginate: vi.fn(),
  setCookie: vi.fn(),
  demoMode: false,
}));

vi.mock('../auth/session', () => ({
  cookieOptions: { httpOnly: true, secure: false, sameSite: 'lax', path: '/' },
  currentUser: async () => ({
    id: fixture.userId,
    login: fixture.userId,
    displayName: null,
    avatarUrl: null,
  }),
  userClient: async () => ({ paginate: fixture.paginate, rest: { apps: {} } }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => (fixture.cookieWorkspaceId ? { value: fixture.cookieWorkspaceId } : undefined),
    set: fixture.setCookie,
  }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
}));
vi.mock('../lib/env', () => ({
  env: () => ({ DEMO_MODE: fixture.demoMode ? 'true' : 'false' }),
}));
vi.mock('../github/repositories', () => ({ reconcileInstallation: async () => [] }));

import { withPrincipal } from '../auth/principal';
import { closeDb, db } from '../db';
import {
  installations,
  repositories,
  users,
  workspaceMemberships,
  workspaceRepositories,
  workspaces,
} from '../db/schema';
import {
  accessibleRepositories,
  linkRepository,
  requireRepository,
  requireWorkspace,
  setActiveWorkspace,
  unlinkRepository,
} from './access';

const userIds = ['workspace-access-user', 'workspace-access-other', 'workspace-access-outsider'];
const workspaceIds = ['workspace-access-own', 'workspace-access-other'];
const repositoryId = 'workspace-access-repo';
const installationId = 'workspace-access-installation';

beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
  await db()
    .insert(users)
    .values(userIds.map((id) => ({ id, login: id, credentials: 'fixture' })));
  await db()
    .insert(workspaces)
    .values([
      { id: workspaceIds[0], name: 'Own workspace', defaultForUserId: userIds[0] },
      { id: workspaceIds[1], name: 'Other workspace' },
    ]);
  await db()
    .insert(workspaceMemberships)
    .values([
      { workspaceId: workspaceIds[0], userId: userIds[0], role: 'owner' },
      { workspaceId: workspaceIds[1], userId: userIds[0], role: 'member' },
      { workspaceId: workspaceIds[1], userId: userIds[1], role: 'owner' },
    ]);
  await db().insert(installations).values({
    id: installationId,
    githubInstallationId: '987654',
    accountLogin: 'fixture',
    accountType: 'Organization',
  });
  await db().insert(repositories).values({
    id: repositoryId,
    installationId,
    githubRepositoryId: '456789',
    owner: 'fixture',
    name: 'workspace-access',
    defaultBranch: 'main',
    isPrivate: true,
  });
  await db().insert(workspaceRepositories).values({
    workspaceId: workspaceIds[1],
    repositoryId,
    connectedBy: userIds[1],
  });
});

beforeEach(() => {
  fixture.userId = userIds[0];
  fixture.cookieWorkspaceId = workspaceIds[0];
  fixture.paginate.mockReset();
  fixture.setCookie.mockReset();
  fixture.demoMode = false;
});

afterAll(async () => {
  await db()
    .delete(workspaceRepositories)
    .where(inArray(workspaceRepositories.workspaceId, workspaceIds));
  const generated = await db()
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(inArray(workspaces.defaultForUserId, userIds));
  await db().delete(workspaceMemberships).where(inArray(workspaceMemberships.userId, userIds));
  await db()
    .delete(workspaces)
    .where(inArray(workspaces.id, [...workspaceIds, ...generated.map(({ id }) => id)]));
  await db().delete(repositories).where(eq(repositories.id, repositoryId));
  await db().delete(installations).where(eq(installations.id, installationId));
  await db().delete(users).where(inArray(users.id, userIds));
  await closeDb();
});

test('a GitHub-visible repo is not automatically a workspace repo', async () => {
  fixture.paginate
    .mockResolvedValueOnce([{ id: 987654, suspended_at: null }])
    .mockResolvedValueOnce([{ id: 456789, permissions: { admin: true } }]);

  expect(await accessibleRepositories()).toEqual([]);
  await expect(linkRepository(workspaceIds[1], repositoryId)).rejects.toThrow('not found');
});

test('a member reads every active linked repository without a personal GitHub request', async () => {
  fixture.cookieWorkspaceId = workspaceIds[1];

  expect(await accessibleRepositories()).toEqual([
    expect.objectContaining({ id: repositoryId, canAdmin: false }),
  ]);
  expect(fixture.paginate).not.toHaveBeenCalled();
});

test('an explicit workspace id never falls back to another membership', async () => {
  fixture.userId = userIds[1];
  fixture.cookieWorkspaceId = workspaceIds[1];

  await expect(requireWorkspace(workspaceIds[0])).rejects.toThrow('not found');
});

test('an explicit empty workspace id is rejected instead of falling back', async () => {
  await expect(requireWorkspace('')).rejects.toThrow('not found');
});

test('the demo workspace rejects an explicit empty workspace id', async () => {
  fixture.demoMode = true;
  await expect(requireWorkspace('')).rejects.toThrow('not found');
});

test('fails closed when a principal names a workspace the user is not in', async () => {
  await expect(
    withPrincipal({ userId: fixture.userId, workspaceId: 'w_not_a_member', source: 'cli' }, () =>
      requireWorkspace(),
    ),
  ).rejects.toThrow();
});

test('still honours a principal naming a workspace the user IS in', async () => {
  const workspace = await withPrincipal(
    { userId: fixture.userId, workspaceId: workspaceIds[0], source: 'cli' },
    () => requireWorkspace(),
  );
  expect(workspace.id).toBe(workspaceIds[0]);
});

test('concurrent first visits provision one default workspace for an existing session user', async () => {
  fixture.userId = userIds[2];
  fixture.cookieWorkspaceId = undefined;

  const [first, second] = await Promise.all([requireWorkspace(), requireWorkspace()]);

  expect(first).toEqual(second);
  expect(first).toMatchObject({ name: 'Personal workspace', role: 'owner' });
  expect(
    await db()
      .select()
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.userId, userIds[2])),
  ).toHaveLength(1);
});

test('a user who left an existing default workspace is not re-added', async () => {
  fixture.userId = userIds[2];
  fixture.cookieWorkspaceId = undefined;
  await db().delete(workspaceMemberships).where(eq(workspaceMemberships.userId, userIds[2]));

  await expect(requireWorkspace()).rejects.toThrow('not found');
  expect(
    await db()
      .select()
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.userId, userIds[2])),
  ).toEqual([]);
});

test('an outsider cannot read a linked repository', async () => {
  fixture.userId = userIds[2];
  fixture.cookieWorkspaceId = workspaceIds[1];

  await expect(requireRepository(repositoryId)).rejects.toThrow('not found');
  expect(fixture.paginate).not.toHaveBeenCalled();
});

test('a stale preference falls back to the user default without writing during render', async () => {
  fixture.cookieWorkspaceId = 'deleted-workspace';

  await expect(requireWorkspace()).resolves.toEqual({
    id: workspaceIds[0],
    name: 'Own workspace',
    role: 'owner',
  });
  expect(fixture.setCookie).not.toHaveBeenCalled();
});

test('changing the active workspace changes repository visibility', async () => {
  expect(await accessibleRepositories()).toEqual([]);
  fixture.cookieWorkspaceId = workspaceIds[1];
  expect(await accessibleRepositories()).toEqual([expect.objectContaining({ id: repositoryId })]);
});

test('suspended installations are excluded from member reads', async () => {
  fixture.cookieWorkspaceId = workspaceIds[1];
  await db()
    .update(installations)
    .set({ active: false })
    .where(eq(installations.id, installationId));
  expect(await accessibleRepositories()).toEqual([]);
  await db()
    .update(installations)
    .set({ active: true })
    .where(eq(installations.id, installationId));
});

test('disconnect removes only the selected workspace link', async () => {
  fixture.userId = userIds[1];
  fixture.cookieWorkspaceId = workspaceIds[1];
  await unlinkRepository(workspaceIds[1], repositoryId);
  expect(await accessibleRepositories()).toEqual([]);
  expect(
    await db().select().from(repositories).where(eq(repositories.id, repositoryId)),
  ).toHaveLength(1);
  await db().insert(workspaceRepositories).values({
    workspaceId: workspaceIds[1],
    repositoryId,
    connectedBy: userIds[1],
  });
});

test('an owner can link only a repository with a fresh GitHub admin grant', async () => {
  fixture.paginate
    .mockResolvedValueOnce([{ id: 987654, suspended_at: null }])
    .mockResolvedValueOnce([{ id: 456789, permissions: { admin: true } }]);
  await linkRepository(workspaceIds[0], repositoryId);
  expect(await requireRepository(repositoryId)).toMatchObject({ id: repositoryId });
  await unlinkRepository(workspaceIds[0], repositoryId);
});

test('an owner without a fresh GitHub admin grant cannot create a link', async () => {
  fixture.paginate
    .mockResolvedValueOnce([{ id: 987654, suspended_at: null }])
    .mockResolvedValueOnce([{ id: 456789, permissions: { admin: false } }]);

  await expect(linkRepository(workspaceIds[0], repositoryId)).rejects.toThrow('not found');
  expect(
    await db()
      .select()
      .from(workspaceRepositories)
      .where(
        and(
          eq(workspaceRepositories.workspaceId, workspaceIds[0]),
          eq(workspaceRepositories.repositoryId, repositoryId),
        ),
      ),
  ).toEqual([]);
});

test('the active workspace cookie uses the shared HTTP-only options', async () => {
  await setActiveWorkspace(workspaceIds[0]);
  expect(fixture.setCookie).toHaveBeenCalledWith(
    'fieldnote-workspace',
    workspaceIds[0],
    expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
  );
});
