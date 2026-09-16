import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDb } from './index';
import {
  authoringRemedies,
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

import {
  beginAuthoring,
  completeAuthoringRun,
  failAuthoringRun,
  getPlan,
  latestPlan,
  listUndispatchedPlans,
  loadAuthoringRun,
  pinAuthoringSha,
  validateAuthoringRun,
} from './queries/authoring-runs';

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
    const runIds = (
      await db()
        .select({ id: authoringRuns.id })
        .from(authoringRuns)
        .where(inArray(authoringRuns.repositoryId, fixtures))
    ).map((run) => run.id);
    if (runIds.length) {
      await db().delete(authoringRemedies).where(inArray(authoringRemedies.authoringRunId, runIds));
    }
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

const sha = 'b'.repeat(40);

async function queuedRun(repositoryId: string) {
  const id = randomUUID();
  await db().insert(authoringRuns).values({
    id,
    repositoryId,
    kind: 'plan',
    workflow: 'readiness-remediation',
    requestedBy: context.user,
    requestedWorkspaceId: context.workspace,
    state: 'queued',
    authorVersion: 'readiness-floor-v01',
  });
  return id;
}

// The one-active-run unique index spans both kinds, so an execute fixture
// gets its own repository rather than sharing one with a queued plan run.
async function queuedExecuteRun(repositoryId: string) {
  const id = randomUUID();
  const planRunId = await queuedRun(repositoryId);
  await db()
    .update(authoringRuns)
    .set({ state: 'complete', sha, completedAt: new Date() })
    .where(eq(authoringRuns.id, planRunId));
  await db().insert(authoringRuns).values({
    id,
    repositoryId,
    kind: 'execute',
    workflow: 'readiness-remediation',
    planRunId,
    requestedBy: context.user,
    requestedWorkspaceId: context.workspace,
    state: 'queued',
    authorVersion: 'readiness-floor-v01',
  });
  return id;
}

const remedy = {
  checkId: 'root-agent-instructions',
  path: 'AGENTS.md',
  rationale: 'No nonempty root AGENTS.md or CLAUDE.md was found.',
  ordinal: 0,
};

test('moves a queued run to running and records when it started', async () => {
  const runId = await queuedRun(await seed());
  const run = await beginAuthoring(runId);
  expect(run?.state).toBe('running');
  expect(run?.startedAt).toBeInstanceOf(Date);
});

test('pins a sha once and refuses a malformed one', async () => {
  const runId = await queuedRun(await seed());
  await beginAuthoring(runId);
  expect(await pinAuthoringSha(runId, sha)).toBe(sha);
  await expect(pinAuthoringSha(runId, 'not-a-sha')).rejects.toThrow('Invalid commit SHA');
});

test('completes a run and stores its remedies in order', async () => {
  const runId = await queuedRun(await seed());
  await beginAuthoring(runId);
  await pinAuthoringSha(runId, sha);
  await completeAuthoringRun(runId, [
    remedy,
    { ...remedy, checkId: 'root-readme', path: 'README.md', ordinal: 1 },
  ]);
  const run = await loadAuthoringRun(runId);
  expect(run?.state).toBe('complete');
  expect(run?.completedAt).toBeInstanceOf(Date);
  const stored = await db()
    .select()
    .from(authoringRemedies)
    .where(eq(authoringRemedies.authoringRunId, runId));
  expect(stored.map((row) => row.ordinal).sort()).toEqual([0, 1]);
});

test('refuses to complete a run that proposed nothing, because a plan with no remedies is not a plan', async () => {
  const runId = await queuedRun(await seed());
  await beginAuthoring(runId);
  await pinAuthoringSha(runId, sha);
  await expect(completeAuthoringRun(runId, [])).rejects.toThrow('Plan proposed nothing');
  expect((await loadAuthoringRun(runId))?.state).toBe('running');
});

test('fails a run with a safe code and rewrites an unknown one', async () => {
  const first = await queuedRun(await seed());
  await failAuthoringRun(first, 'access_revoked');
  expect((await loadAuthoringRun(first))?.errorCode).toBe('access_revoked');
  const second = await queuedRun(await seed());
  await failAuthoringRun(second, 'postgres said: connection to 10.0.0.1 refused');
  expect((await loadAuthoringRun(second))?.errorCode).toBe('plan_failed');
});

test('lists only runs that were never dispatched', async () => {
  const runId = await queuedRun(await seed());
  expect(await listUndispatchedPlans()).toContain(runId);
  await db()
    .update(authoringRuns)
    .set({ dispatchedAt: new Date() })
    .where(eq(authoringRuns.id, runId));
  expect(await listUndispatchedPlans()).not.toContain(runId);
});

test('does not list a queued, undispatched execute run', async () => {
  const runId = await queuedExecuteRun(await seed());
  expect(await listUndispatchedPlans()).not.toContain(runId);
});

test('refuses to validate a run whose repository opted back out', async () => {
  const repositoryId = await seed();
  const runId = await queuedRun(repositoryId);
  const run = await loadAuthoringRun(runId);
  await expect(validateAuthoringRun(run!)).resolves.toBeUndefined();
  await db()
    .update(repositories)
    .set({ actEnabled: false })
    .where(eq(repositories.id, repositoryId));
  await expect(validateAuthoringRun(run!)).rejects.toThrow('Plan access revoked');
});

test('reads back a completed plan with its remedies, and refuses one from another repository', async () => {
  const repositoryId = await seed();
  const runId = await queuedRun(repositoryId);
  await beginAuthoring(runId);
  await pinAuthoringSha(runId, sha);
  await completeAuthoringRun(runId, [remedy]);
  const plan = await getPlan(repositoryId, runId);
  expect(plan?.remedies).toHaveLength(1);
  expect(plan?.remedies[0].path).toBe('AGENTS.md');
  expect(await getPlan(await seed(), runId)).toBeNull();
  expect((await latestPlan(repositoryId))?.id).toBe(runId);
});

test('refuses to read an execute run back as a plan, even with the correct repository id', async () => {
  const repositoryId = await seed();
  const runId = await queuedExecuteRun(repositoryId);
  expect(await getPlan(repositoryId, runId)).toBeNull();
});
