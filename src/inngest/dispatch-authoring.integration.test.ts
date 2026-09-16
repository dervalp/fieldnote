import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, test, vi } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, closeDb } from '../db';
import {
  authoringRuns,
  installations,
  repositories,
  users,
  workspaces,
  workspaceMemberships,
} from '../db/schema';
import { listUndispatchedPlans } from '../db/queries/authoring-runs';
import { floorAuthorVersion } from '../domain/act/remedies';
import { dispatchAuthoringPlan } from './dispatch-authoring';

// These browser-only dependencies are not used by the trusted dispatcher.
vi.mock('../auth/session', () => ({ currentUser: async () => ({ id: 'unused' }) }));
vi.mock('../lib/env', () => ({ env: () => ({ DEMO_MODE: 'false' }) }));

const owner = randomUUID();
const workspace = randomUUID();

beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
  await db().insert(users).values({ id: owner, login: 'author', credentials: 'fixture' });
  await db()
    .insert(workspaces)
    .values({ id: workspace, name: 'Authoring', defaultForUserId: owner });
  await db()
    .insert(workspaceMemberships)
    .values({ workspaceId: workspace, userId: owner, role: 'member' });
});
afterAll(closeDb);

async function seedRepository() {
  const id = randomUUID();
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
  return id;
}

async function seedRun(
  repositoryId: string,
  state: 'queued' | 'running' | 'failed' = 'queued',
  kind: 'plan' | 'execute' = 'plan',
) {
  const id = randomUUID();
  const planRunId = kind === 'execute' ? (await seedRun(repositoryId, 'failed')).id : null;
  await db().insert(authoringRuns).values({
    id,
    repositoryId,
    kind,
    workflow: 'readiness-remediation',
    planRunId,
    requestedBy: owner,
    requestedWorkspaceId: workspace,
    state,
    authorVersion: floorAuthorVersion,
  });
  return { id };
}

test('dispatch failure leaves the run recoverable, and dispatching twice sends once', async () => {
  const repositoryId = await seedRepository();
  const run = await seedRun(repositoryId);

  await expect(
    dispatchAuthoringPlan(run.id, async () => {
      throw new Error('offline');
    }),
  ).rejects.toThrow('offline');
  expect(await listUndispatchedPlans()).toContain(run.id);

  const send = vi.fn().mockResolvedValue(undefined);
  await dispatchAuthoringPlan(run.id, send);
  await dispatchAuthoringPlan(run.id, send);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith({
    id: run.id,
    name: 'repository/authoring.plan.requested',
    data: { runId: run.id },
  });
  expect(await listUndispatchedPlans()).not.toContain(run.id);
});

test('a run that is no longer queued is not dispatched', async () => {
  const send = vi.fn();

  const runningRepo = await seedRepository();
  const running = await seedRun(runningRepo, 'running');
  await dispatchAuthoringPlan(running.id, send);

  const failedRepo = await seedRepository();
  const failed = await seedRun(failedRepo, 'failed');
  await dispatchAuthoringPlan(failed.id, send);

  expect(send).not.toHaveBeenCalled();
  expect(await listUndispatchedPlans()).not.toContain(running.id);
  expect(await listUndispatchedPlans()).not.toContain(failed.id);
});

test('a queued, undispatched execute run is not dispatched as a plan', async () => {
  const repositoryId = await seedRepository();
  const run = await seedRun(repositoryId, 'queued', 'execute');
  const send = vi.fn();
  await dispatchAuthoringPlan(run.id, send);
  expect(send).not.toHaveBeenCalled();
  expect(await listUndispatchedPlans()).not.toContain(run.id);
});
