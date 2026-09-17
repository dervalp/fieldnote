import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDb } from './index';
import {
  authoringRuns,
  installations,
  repositories,
  users,
  workspaces,
  workspaceMemberships,
  workspaceRepositories,
} from './schema';

const context = vi.hoisted(() => ({ user: '', workspace: '', demo: false }));
const grade = vi.hoisted(() => ({ latest: vi.fn() }));
const github = vi.hoisted(() => ({ permissions: vi.fn() }));

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
vi.mock('./queries/grade-runs', () => ({ latestGrade: grade.latest }));
vi.mock('../github/installation-permissions', () => ({
  fetchGrantedPermissions: github.permissions,
}));

import { requestPlan } from './queries/authoring-runs';
import { requestSetupPlan } from './queries/fieldnote-setup';

const failing = {
  id: 'grade',
  score: 40,
  sha: 'a'.repeat(40),
  rubricVersion: '0.1.0',
  evaluatorVersion: '1.0.0',
  computedAt: new Date('2026-09-11'),
  checks: [
    {
      id: 'root-agent-instructions',
      points: 0,
      maxPoints: 20,
      status: 'fail' as const,
      paths: [],
      lineRanges: [],
      explanation: 'No nonempty root AGENTS.md or CLAUDE.md was found.',
    },
  ],
};

beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
  context.user = randomUUID();
  context.workspace = randomUUID();
  await db().insert(users).values({ id: context.user, login: 'author', credentials: 'fixture' });
  await db()
    .insert(workspaces)
    .values({ id: context.workspace, name: 'Authoring', defaultForUserId: context.user });
  await db()
    .insert(workspaceMemberships)
    .values({ workspaceId: context.workspace, userId: context.user, role: 'member' });
});

const fixtures: string[] = [];

afterAll(async () => {
  if (fixtures.length) {
    await db().delete(authoringRuns).where(inArray(authoringRuns.repositoryId, fixtures));
    await db()
      .delete(workspaceRepositories)
      .where(inArray(workspaceRepositories.repositoryId, fixtures));
    await db().delete(repositories).where(inArray(repositories.id, fixtures));
    await db().delete(installations).where(inArray(installations.id, fixtures));
  }
  await db()
    .delete(workspaceMemberships)
    .where(eq(workspaceMemberships.workspaceId, context.workspace));
  await db().delete(workspaces).where(eq(workspaces.id, context.workspace));
  await db().delete(users).where(eq(users.id, context.user));
  await closeDb();
});

beforeEach(() => {
  grade.latest.mockResolvedValue(failing);
  github.permissions.mockResolvedValue({ contents: 'write', pullRequests: 'write' });
});

async function seed(actEnabled = true) {
  const id = randomUUID();
  fixtures.push(id);
  await db().insert(installations).values({
    id,
    githubInstallationId: id,
    accountLogin: 'octo',
    accountType: 'Organization',
    active: true,
  });
  await db().insert(repositories).values({
    id,
    installationId: id,
    githubRepositoryId: id,
    owner: 'octo',
    name: 'repo',
    defaultBranch: 'main',
    isPrivate: false,
    active: true,
    actEnabled,
  });
  await db()
    .insert(workspaceRepositories)
    .values({ workspaceId: context.workspace, repositoryId: id, connectedBy: context.user });
  return id;
}

test('queues a plan run for an available repository', async () => {
  const repositoryId = await seed();
  const run = await requestPlan(repositoryId);
  expect(run.state).toBe('queued');
  const [row] = await db().select().from(authoringRuns).where(eq(authoringRuns.id, run.id));
  expect(row.kind).toBe('plan');
  expect(row.authorVersion).toBe('readiness-floor-v01');
  expect(row.model).toBeNull();
});

test('returns the run already in flight rather than queueing a second', async () => {
  const repositoryId = await seed();
  const first = await requestPlan(repositoryId);
  const second = await requestPlan(repositoryId);
  expect(second.id).toBe(first.id);
});

test('concurrent clicks share one active run', async () => {
  const repositoryId = await seed();
  const [a, b] = await Promise.all([requestPlan(repositoryId), requestPlan(repositoryId)]);
  expect(a.id).toBe(b.id);
});

test('refuses a repository that has not opted in', async () => {
  const repositoryId = await seed(false);
  await expect(requestPlan(repositoryId)).rejects.toThrow('Act unavailable');
});

test('refuses an installation that grants only read', async () => {
  const repositoryId = await seed();
  github.permissions.mockResolvedValue({ contents: 'read', pullRequests: 'read' });
  await expect(requestPlan(repositoryId)).rejects.toThrow('Act unavailable');
});

test('refuses when nothing is failing', async () => {
  const repositoryId = await seed();
  grade.latest.mockResolvedValue({ ...failing, checks: [] });
  await expect(requestPlan(repositoryId)).rejects.toThrow('Act unavailable');
});

test('refuses when the repository has never been graded', async () => {
  const repositoryId = await seed();
  grade.latest.mockResolvedValue(null);
  await expect(requestPlan(repositoryId)).rejects.toThrow('Act unavailable');
});

test('lets a permission check that cannot complete fail loudly rather than reading as unavailable', async () => {
  const repositoryId = await seed();
  github.permissions.mockRejectedValue(new Error('Installation permissions unavailable'));
  await expect(requestPlan(repositoryId)).rejects.toThrow('Installation permissions unavailable');
});

test('concurrent setup requests share one run without depending on a readiness grade', async () => {
  const repositoryId = await seed();
  grade.latest.mockResolvedValue(null);
  const [a, b] = await Promise.all([
    requestSetupPlan(repositoryId),
    requestSetupPlan(repositoryId),
  ]);
  expect(a.id).toBe(b.id);
  const [stored] = await db().select().from(authoringRuns).where(eq(authoringRuns.id, a.id));
  expect(stored).toMatchObject({
    kind: 'plan',
    workflow: 'fieldnote-setup',
    state: 'queued',
    authorVersion: 'fieldnote-setup-v1',
  });
  await expect(requestPlan(repositoryId)).rejects.toThrow();
});

test('setup refuses a competing readiness workflow', async () => {
  const repositoryId = await seed();
  await requestPlan(repositoryId);
  await expect(requestSetupPlan(repositoryId)).rejects.toThrow('Another authoring workflow');
});

test('setup requires opt-in and granted write permissions', async () => {
  await expect(requestSetupPlan(await seed(false))).rejects.toThrow('Act unavailable');
  github.permissions.mockResolvedValue({ contents: 'read', pullRequests: 'read' });
  await expect(requestSetupPlan(await seed())).rejects.toThrow('Act unavailable');
});
