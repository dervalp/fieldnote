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
import { dispatchAuthoringPlan, dispatchSetupExecute } from './dispatch-authoring';
import { eq } from 'drizzle-orm';
import { fieldnoteSetupProposals } from '../db/schema';
import { listUndispatchedSetupExecutes } from '../db/queries/fieldnote-setup';

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

test('setup executions dispatch durably with a fresh event identity after a proposal refresh', async () => {
  const repositoryId = await seedRepository();
  const value = await seedRun(repositoryId, 'queued', 'execute');
  const [execution] = await db().select().from(authoringRuns).where(eq(authoringRuns.id, value.id));
  await db()
    .update(authoringRuns)
    .set({ workflow: 'fieldnote-setup' })
    .where(eq(authoringRuns.id, value.id));
  await db()
    .insert(fieldnoteSetupProposals)
    .values({
      authoringRunId: execution.planRunId!,
      repositorySha: 'a'.repeat(40),
      skillsRelease: 'skills-v0.1.0',
      skillsRevision: 'b'.repeat(40),
      releaseLockHash: `sha256:${'c'.repeat(64)}`,
      detectedAgents: [],
      state: 'ready',
    });
  const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  await expect(dispatchSetupExecute(value.id, send)).rejects.toThrow('offline');
  expect(await listUndispatchedSetupExecutes()).toContain(value.id);
  await dispatchSetupExecute(value.id, send);
  await dispatchSetupExecute(value.id, send);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]);
  expect(send.mock.calls[1][0]).toMatchObject({
    name: 'repository/fieldnote.setup.execute.requested',
    data: { runId: value.id },
  });
  await db()
    .update(authoringRuns)
    .set({ dispatchedAt: null })
    .where(eq(authoringRuns.id, value.id));
  await db()
    .update(fieldnoteSetupProposals)
    .set({ updatedAt: new Date('2030-01-01') })
    .where(eq(fieldnoteSetupProposals.authoringRunId, execution.planRunId!));
  await dispatchSetupExecute(value.id, send);
  expect(send.mock.calls[2][0].id).not.toBe(send.mock.calls[1][0].id);
});
