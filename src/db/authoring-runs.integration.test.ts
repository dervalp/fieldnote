import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { inArray } from 'drizzle-orm';
import { db, closeDb } from './index';
import {
  authoringRemedies,
  authoringRuns,
  installations,
  repositories,
  users,
  workspaces,
  workspaceMemberships,
} from './schema';

const owner = randomUUID();
const workspace = randomUUID();
const fixtures: string[] = [];
const runIds: string[] = [];

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

afterAll(async () => {
  if (fixtures.length) {
    await db().delete(authoringRemedies).where(inArray(authoringRemedies.authoringRunId, runIds));
    await db().delete(authoringRuns).where(inArray(authoringRuns.repositoryId, fixtures));
    await db().delete(repositories).where(inArray(repositories.id, fixtures));
    await db().delete(installations).where(inArray(installations.id, fixtures));
  }
  await db()
    .delete(workspaceMemberships)
    .where(inArray(workspaceMemberships.workspaceId, [workspace]));
  await db()
    .delete(workspaces)
    .where(inArray(workspaces.id, [workspace]));
  await db()
    .delete(users)
    .where(inArray(users.id, [owner]));
  await closeDb();
});

async function seedRepository() {
  const id = randomUUID();
  fixtures.push(id);
  await db().insert(installations).values({
    id,
    githubInstallationId: id,
    accountLogin: 'octo',
    accountType: 'Organization',
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
  });
  return id;
}

function queued(repositoryId: string) {
  const id = randomUUID();
  runIds.push(id);
  return {
    id,
    repositoryId,
    kind: 'plan' as const,
    workflow: 'readiness-remediation' as const,
    requestedBy: owner,
    requestedWorkspaceId: workspace,
    state: 'queued' as const,
    authorVersion: 'readiness-floor-v01',
  };
}

test('allows one active run per repository and refuses a second', async () => {
  const repositoryId = await seedRepository();
  await db().insert(authoringRuns).values(queued(repositoryId));
  await expect(db().insert(authoringRuns).values(queued(repositoryId))).rejects.toThrow();
});

test('allows a new run once the active one is no longer queued or running', async () => {
  const repositoryId = await seedRepository();
  const first = queued(repositoryId);
  await db().insert(authoringRuns).values(first);
  await db()
    .update(authoringRuns)
    .set({ state: 'failed', completedAt: new Date() })
    .where(inArray(authoringRuns.id, [first.id]));
  await expect(db().insert(authoringRuns).values(queued(repositoryId))).resolves.toBeDefined();
});

test('refuses to mark a run complete without a sha', async () => {
  const repositoryId = await seedRepository();
  const run = queued(repositoryId);
  await db().insert(authoringRuns).values(run);
  await expect(
    db()
      .update(authoringRuns)
      .set({ state: 'complete', completedAt: new Date() })
      .where(inArray(authoringRuns.id, [run.id])),
  ).rejects.toThrow();
});

test('refuses an unknown kind', async () => {
  const repositoryId = await seedRepository();
  await expect(
    db()
      .insert(authoringRuns)
      .values({ ...queued(repositoryId), kind: 'ponder' as unknown as 'plan' }),
  ).rejects.toThrow();
});

test('refuses the same check and path twice in one run, and allows one path for two checks', async () => {
  const repositoryId = await seedRepository();
  const run = queued(repositoryId);
  await db().insert(authoringRuns).values(run);
  const remedy = (checkId: string, ordinal: number) => ({
    id: randomUUID(),
    authoringRunId: run.id,
    checkId,
    path: 'AGENTS.md',
    rationale: 'because',
    ordinal,
  });
  await db().insert(authoringRemedies).values(remedy('root-agent-instructions', 0));
  // One file answers several failing checks — this must be allowed.
  await expect(
    db().insert(authoringRemedies).values(remedy('documented-setup', 1)),
  ).resolves.toBeDefined();
  // The same change proposed twice must not be.
  await expect(
    db().insert(authoringRemedies).values(remedy('root-agent-instructions', 2)),
  ).rejects.toThrow();
});
