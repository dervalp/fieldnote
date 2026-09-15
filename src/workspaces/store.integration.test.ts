import { afterAll, beforeAll, expect, test } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { closeDb, db } from '../db';
import { graderInstalls, users, workspaceMemberships, workspaces } from '../db/schema';
import { createWorkspace, ensureDefaultWorkspace, listWorkspaces } from './store';
import { AGENT_READINESS } from '../domain/grading/graders/agent-readiness';

beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
  await db()
    .insert(users)
    .values({ id: 'fixture-user', login: 'fixture-user', credentials: 'fixture' })
    .onConflictDoNothing();
  const priorMemberships = await db()
    .delete(workspaceMemberships)
    .where(eq(workspaceMemberships.userId, 'fixture-user'))
    .returning({ workspaceId: workspaceMemberships.workspaceId });
  for (const { workspaceId } of priorMemberships) {
    await db().delete(workspaces).where(eq(workspaces.id, workspaceId));
  }
});

afterAll(closeDb);

test('concurrent sign-ins create one default', async () => {
  const [a, b] = await Promise.all([
    ensureDefaultWorkspace('fixture-user'),
    ensureDefaultWorkspace('fixture-user'),
  ]);
  expect(a.id).toBe(b.id);
  expect(await listWorkspaces('fixture-user')).toHaveLength(1);
});

test('an install deleted between sign-ins is not resurrected by a later one', async () => {
  // ensureDefaultWorkspace() runs on every authenticated request. If the
  // early-return path (the workspace already exists) ran installBuiltIns()
  // too, an uninstall would only last until the user's next page load — this
  // is the regression guard for that.
  const workspace = await ensureDefaultWorkspace('fixture-user');
  const before = await db()
    .select()
    .from(graderInstalls)
    .where(and(eq(graderInstalls.workspaceId, workspace.id), eq(graderInstalls.graderId, AGENT_READINESS)));
  expect(before).toHaveLength(1);

  await db()
    .delete(graderInstalls)
    .where(and(eq(graderInstalls.workspaceId, workspace.id), eq(graderInstalls.graderId, AGENT_READINESS)));

  await ensureDefaultWorkspace('fixture-user');
  const after = await db()
    .select()
    .from(graderInstalls)
    .where(and(eq(graderInstalls.workspaceId, workspace.id), eq(graderInstalls.graderId, AGENT_READINESS)));
  expect(after).toHaveLength(0);
});

test('a user can create a second named workspace as owner', async () => {
  const created = await createWorkspace('fixture-user', '  Product team  ');

  expect(created.name).toBe('Product team');
  expect(await listWorkspaces('fixture-user')).toEqual(
    expect.arrayContaining([{ ...created, role: 'owner' }]),
  );
  expect(await listWorkspaces('fixture-user')).toHaveLength(2);
});

test('workspace names must contain 1 to 80 trimmed characters', async () => {
  await expect(createWorkspace('fixture-user', '   ')).rejects.toThrow();
  await expect(createWorkspace('fixture-user', 'x'.repeat(81))).rejects.toThrow();
  expect(await listWorkspaces('fixture-user')).toHaveLength(2);
});

test('workspace membership foreign keys reject unknown users', async () => {
  const [workspace] = await listWorkspaces('fixture-user');

  await expect(
    db().insert(workspaceMemberships).values({
      workspaceId: workspace.id,
      userId: 'missing-user',
      role: 'member',
    }),
  ).rejects.toThrow();
});

test('a user can have only one membership per workspace', async () => {
  const [workspace] = await listWorkspaces('fixture-user');

  await expect(
    db().insert(workspaceMemberships).values({
      workspaceId: workspace.id,
      userId: 'fixture-user',
      role: 'member',
    }),
  ).rejects.toThrow();
});
