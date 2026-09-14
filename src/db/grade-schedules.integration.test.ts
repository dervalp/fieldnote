import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { and, eq, inArray } from 'drizzle-orm';
import { db, closeDb } from './index';
import {
  installations,
  repositories,
  users,
  workspaces,
  workspaceMemberships,
  workspaceRepositories,
  gradeSchedules as scheduleRows,
} from './schema';
import {
  gradeSchedules,
  writeGradeSchedule,
  listGradeSchedules,
  scheduleAvailable,
} from './queries/grade-schedules';
import { AGENT_READINESS } from '../domain/grading/graders/agent-readiness';
import { ManifestError } from '../domain/grading/manifest';
const context = vi.hoisted(() => ({ user: '', workspace: '', demo: false }));
// A second, independent identity: their own user, their own default
// workspace, their own membership — mirroring context's own setup — so the
// "outsider" and "enabler leaves" tests can simulate two distinct people
// instead of making the harness's sole user workspace-less (which trips
// requireWorkspace()'s own fallback-to-notFound path before the code under
// test is ever reached).
let secondUser = '';
let secondWorkspace = '';
vi.mock('../auth/session', () => ({
  currentUser: async () => ({ id: context.user }),
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
beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
  context.user = randomUUID();
  context.workspace = randomUUID();
  await db().insert(users).values({ id: context.user, login: 'grader', credentials: 'fixture' });
  await db()
    .insert(workspaces)
    .values({ id: context.workspace, name: 'Grader', defaultForUserId: context.user });
  await db()
    .insert(workspaceMemberships)
    .values({ workspaceId: context.workspace, userId: context.user, role: 'member' });
  secondUser = randomUUID();
  secondWorkspace = randomUUID();
  await db()
    .insert(users)
    .values({ id: secondUser, login: 'outsider', credentials: 'fixture' });
  await db()
    .insert(workspaces)
    .values({ id: secondWorkspace, name: 'Outsider', defaultForUserId: secondUser });
  await db()
    .insert(workspaceMemberships)
    .values({ workspaceId: secondWorkspace, userId: secondUser, role: 'member' });
});
const fixtureRepositories: string[] = [];
afterAll(async () => {
  if (fixtureRepositories.length) {
    await db()
      .delete(scheduleRows)
      .where(inArray(scheduleRows.repositoryId, fixtureRepositories));
    await db()
      .delete(workspaceRepositories)
      .where(inArray(workspaceRepositories.repositoryId, fixtureRepositories));
    await db().delete(repositories).where(inArray(repositories.id, fixtureRepositories));
    await db().delete(installations).where(inArray(installations.id, fixtureRepositories));
  }
  await db()
    .delete(workspaceMemberships)
    .where(eq(workspaceMemberships.userId, secondUser));
  await db()
    .delete(workspaceMemberships)
    .where(eq(workspaceMemberships.workspaceId, context.workspace));
  await db().delete(workspaces).where(eq(workspaces.id, secondWorkspace));
  await db().delete(workspaces).where(eq(workspaces.id, context.workspace));
  await db().delete(users).where(eq(users.id, secondUser));
  await db().delete(users).where(eq(users.id, context.user));
  await closeDb();
});
async function fixtureRepository() {
  const id = randomUUID();
  fixtureRepositories.push(id);
  await db()
    .insert(installations)
    .values({ id, githubInstallationId: id, accountLogin: 'test', accountType: 'User' });
  await db().insert(repositories).values({
    id,
    installationId: id,
    githubRepositoryId: id,
    owner: 'test',
    name: 'repo',
    defaultBranch: 'main',
    isPrivate: true,
  });
  await db()
    .insert(workspaceRepositories)
    .values({ workspaceId: context.workspace, repositoryId: id, connectedBy: context.user });
  return id;
}

test('a schedule is off until it is written, and presence means on', async () => {
  const repositoryId = await fixtureRepository();
  expect(await gradeSchedules(repositoryId)).toEqual({});
  await writeGradeSchedule(repositoryId, AGENT_READINESS, true);
  expect(await gradeSchedules(repositoryId)).toEqual({
    [AGENT_READINESS]: { enabledBy: context.user, paused: false },
  });
  await writeGradeSchedule(repositoryId, AGENT_READINESS, false);
  expect(await gradeSchedules(repositoryId)).toEqual({});
});

test('enabling twice is idempotent', async () => {
  const repositoryId = await fixtureRepository();
  await writeGradeSchedule(repositoryId, AGENT_READINESS, true);
  await writeGradeSchedule(repositoryId, AGENT_READINESS, true);
  expect(Object.keys(await gradeSchedules(repositoryId))).toEqual([AGENT_READINESS]);
});

test('an unknown grader is refused', async () => {
  const repositoryId = await fixtureRepository();
  await expect(writeGradeSchedule(repositoryId, 'nobody/nothing', true)).rejects.toThrow(
    ManifestError,
  );
});

test('the demo workspace is read-only', async () => {
  const repositoryId = await fixtureRepository();
  context.demo = true;
  try {
    await expect(writeGradeSchedule(repositoryId, AGENT_READINESS, true)).rejects.toThrow();
  } finally {
    context.demo = false;
  }
});

test('a user outside the workspace cannot enable a schedule', async () => {
  // The outsider has a real membership — just not in the workspace this
  // repository is connected to. requireWorkspace() resolves fine (to their
  // own workspace); requireRepository() is what refuses them, with
  // 'not found' — not writeGradeSchedule's trailing availability join.
  //
  // That join checks nothing requireRepository doesn't already check (or
  // check more strictly): the same workspace-repository link, the same
  // active-repository/active-installation conditions, and a membership that
  // requireWorkspace() already guarantees by construction. So on this
  // session-bound path requireRepository always shadows it. The join stays
  // anyway — it is the same defence-in-depth shape requestGrade/
  // insertGradeRun uses, inside the same transaction, and it is genuinely
  // reachable on the session-free path: see 'the scheduler cannot create a
  // run for a repository the workspace lost' in
  // src/db/grade-runs.integration.test.ts, which drives it through
  // scheduleGrade() (no requireRepository ahead of it) and does get
  // 'Repository unavailable'.
  const repositoryId = await fixtureRepository();
  const originalUser = context.user;
  const originalWorkspace = context.workspace;
  context.user = secondUser;
  context.workspace = secondWorkspace;
  try {
    await expect(writeGradeSchedule(repositoryId, AGENT_READINESS, true)).rejects.toThrow(
      'not found',
    );
  } finally {
    context.user = originalUser;
    context.workspace = originalWorkspace;
  }
});

test('a schedule pauses when the enabler leaves the workspace', async () => {
  // Two distinct people: the second user enables the schedule and then
  // leaves the (shared) workspace; the first user is the one still reading
  // the page. Only the enabler's access should matter to `paused`.
  const repositoryId = await fixtureRepository();
  await db()
    .insert(workspaceMemberships)
    .values({ workspaceId: context.workspace, userId: secondUser, role: 'member' });
  const originalUser = context.user;
  context.user = secondUser;
  try {
    await writeGradeSchedule(repositoryId, AGENT_READINESS, true);
  } finally {
    context.user = originalUser;
  }
  const row = (await listGradeSchedules()).find((entry) => entry.repositoryId === repositoryId)!;
  expect(row.enabledBy).toBe(secondUser);
  expect(await scheduleAvailable(row)).toBe(true);
  await db()
    .delete(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, context.workspace),
        eq(workspaceMemberships.userId, secondUser),
      ),
    );
  try {
    expect(await scheduleAvailable(row)).toBe(false);
    expect((await gradeSchedules(repositoryId))[AGENT_READINESS].paused).toBe(true);
  } finally {
    await db()
      .insert(workspaceMemberships)
      .values({ workspaceId: context.workspace, userId: secondUser, role: 'member' })
      .onConflictDoNothing();
  }
  // The row survives. Nothing is deleted, and it resumes by itself.
  expect(Object.keys(await gradeSchedules(repositoryId))).toEqual([AGENT_READINESS]);
});
