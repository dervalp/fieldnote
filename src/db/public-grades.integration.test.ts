import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDb } from './index';
import {
  installations,
  publicGrades as publicGradeRows,
  repositories,
  users,
  workspaces,
  workspaceMemberships,
  workspaceRepositories,
  gradeRuns,
} from './schema';
import { publicGradeSettings, writePublicGrade } from './queries/public-grade-settings';
import { AGENT_READINESS } from '../domain/grading/graders/agent-readiness';

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
beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
  owner = randomUUID();
  secondOwner = randomUUID();
  member = randomUUID();
  workspace = randomUUID();
  await db()
    .insert(users)
    .values([
      { id: owner, login: 'owner', credentials: 'fixture' },
      { id: secondOwner, login: 'owner-two', credentials: 'fixture' },
      { id: member, login: 'member', credentials: 'fixture' },
    ]);
  await db().insert(workspaces).values({ id: workspace, name: 'Public', defaultForUserId: owner });
  await db()
    .insert(workspaceMemberships)
    .values([
      { workspaceId: workspace, userId: owner, role: 'owner' },
      { workspaceId: workspace, userId: secondOwner, role: 'owner' },
      { workspaceId: workspace, userId: member, role: 'member' },
    ]);
});

const fixtureRepositories: string[] = [];
afterAll(async () => {
  if (fixtureRepositories.length) {
    await db()
      .delete(publicGradeRows)
      .where(inArray(publicGradeRows.repositoryId, fixtureRepositories));
    await db().delete(gradeRuns).where(inArray(gradeRuns.repositoryId, fixtureRepositories));
    await db()
      .delete(workspaceRepositories)
      .where(inArray(workspaceRepositories.repositoryId, fixtureRepositories));
    await db().delete(repositories).where(inArray(repositories.id, fixtureRepositories));
    await db().delete(installations).where(inArray(installations.id, fixtureRepositories));
  }
  // requireWorkspace() calls ensureDefaultWorkspace() for whoever the session
  // names, and secondOwner and member have no defaultForUserId of their own —
  // only the fixture "workspace" does. That call silently creates a personal
  // workspace and membership the first time either of them goes through
  // writePublicGrade(). Sweep by user id and by defaultForUserId rather than
  // just the fixture workspace id, so those rows don't survive the run and
  // trip the users foreign key below.
  await db()
    .delete(workspaceMemberships)
    .where(inArray(workspaceMemberships.userId, [owner, secondOwner, member]));
  await db()
    .delete(workspaces)
    .where(inArray(workspaces.defaultForUserId, [owner, secondOwner, member]));
  await db().delete(users).where(inArray(users.id, [owner, secondOwner, member]));
  await closeDb();
});

type RepoOptions = { isPrivate?: boolean; active?: boolean; installationActive?: boolean; isDemo?: boolean; linked?: boolean; owner?: string; name?: string };
async function fixtureRepository(options: RepoOptions = {}): Promise<string> {
  const id = randomUUID();
  fixtureRepositories.push(id);
  await db().insert(installations).values({
    id,
    githubInstallationId: id,
    accountLogin: 'test',
    accountType: 'User',
    active: options.installationActive ?? true,
  });
  await db()
    .insert(repositories)
    .values({
      id,
      installationId: id,
      githubRepositoryId: id,
      owner: options.owner ?? `owner-${id.slice(0, 8)}`,
      name: options.name ?? 'repo',
      defaultBranch: 'main',
      isPrivate: options.isPrivate ?? false,
      active: options.active ?? true,
      isDemo: options.isDemo ?? false,
    });
  if (options.linked ?? true)
    await db()
      .insert(workspaceRepositories)
      .values({ workspaceId: workspace, repositoryId: id, connectedBy: owner });
  return id;
}

beforeEach(() => {
  context.user = owner;
  context.workspace = workspace;
  context.demo = false;
});

test('an owner shares, revokes and shares again, and the row survives', async () => {
  const repositoryId = await fixtureRepository();
  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  expect(await publicGradeSettings(repositoryId)).toEqual({ [AGENT_READINESS]: { shared: true } });

  await writePublicGrade(repositoryId, AGENT_READINESS, false);
  expect(await publicGradeSettings(repositoryId)).toEqual({ [AGENT_READINESS]: { shared: false } });
  const [revoked] = await db()
    .select()
    .from(publicGradeRows)
    .where(eq(publicGradeRows.repositoryId, repositoryId));
  expect(revoked.revokedAt).toBeInstanceOf(Date);

  context.user = secondOwner;
  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  const [reshared] = await db()
    .select()
    .from(publicGradeRows)
    .where(eq(publicGradeRows.repositoryId, repositoryId));
  expect(reshared.revokedAt).toBeNull();
  expect(reshared.enabledBy).toBe(secondOwner);
});

test('a member cannot share', async () => {
  const repositoryId = await fixtureRepository();
  context.user = member;
  await expect(writePublicGrade(repositoryId, AGENT_READINESS, true)).rejects.toThrow('not found');
  expect(await db().select().from(publicGradeRows).where(eq(publicGradeRows.repositoryId, repositoryId))).toEqual([]);
});

test('a signed-out visitor cannot share', async () => {
  const repositoryId = await fixtureRepository();
  context.user = '';
  await expect(writePublicGrade(repositoryId, AGENT_READINESS, true)).rejects.toThrow();
});

test('the demo workspace cannot share', async () => {
  const repositoryId = await fixtureRepository();
  context.demo = true;
  await expect(writePublicGrade(repositoryId, AGENT_READINESS, true)).rejects.toThrow();
});

test('an unknown grader cannot be shared', async () => {
  const repositoryId = await fixtureRepository();
  await expect(writePublicGrade(repositoryId, 'nobody/nothing', true)).rejects.toThrow();
});

test('a repository the workspace is not connected to cannot be shared', async () => {
  const repositoryId = await fixtureRepository({ linked: false });
  await expect(writePublicGrade(repositoryId, AGENT_READINESS, true)).rejects.toThrow();
});
