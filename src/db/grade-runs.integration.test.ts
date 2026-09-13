import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, closeDb } from './index';
import {
  installations,
  repositories,
  users,
  workspaces,
  workspaceMemberships,
  workspaceRepositories,
} from './schema';
import { requestGrade } from './queries/grade-runs';
const context = vi.hoisted(() => ({ user: '', workspace: '', demo: false }));
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
});
const fixtureRepositories: string[] = [];
afterAll(async () => {
  if (fixtureRepositories.length) {
    await db().delete(gradeRuns).where(inArray(gradeRuns.repositoryId, fixtureRepositories));
    await db()
      .delete(workspaceRepositories)
      .where(inArray(workspaceRepositories.repositoryId, fixtureRepositories));
    await db().delete(repositories).where(inArray(repositories.id, fixtureRepositories));
    await db().delete(installations).where(inArray(installations.id, fixtureRepositories));
  }
  await db()
    .delete(workspaceMemberships)
    .where(eq(workspaceMemberships.workspaceId, context.workspace));
  await db().delete(workspaces).where(eq(workspaces.id, context.workspace));
  await db().delete(users).where(eq(users.id, context.user));
  await closeDb();
});
async function seed() {
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
test('concurrent clicks share one active run', async () => {
  const id = await seed();
  const [a, b] = await Promise.all([
    requestGrade(id, AGENT_READINESS),
    requestGrade(id, AGENT_READINESS),
  ]);
  expect(a.id).toBe(b.id);
});

import { and, eq, inArray } from 'drizzle-orm';
import { gradeRuns, gradingRubrics } from './schema';
import {
  beginGrade,
  pinGradeSha,
  completeGrade,
  failGrade,
  loadGradeRun,
  latestGrade,
  getGrade,
  gradeHistory,
  gradeSummaries,
  registerRubric,
  listUndispatchedGrades,
  validateGradeRun,
} from './queries/grade-runs';
import { dispatchGrade } from '../inngest/dispatch-grade';
import { evaluateGradeRun, resolveGradeCommit } from '../inngest/functions/grade-repository';
import { runDeclarative } from '../domain/grading/declarative';
import { AGENT_READINESS, agentReadinessManifest } from '../domain/grading/graders/agent-readiness';
import { registerGrader } from '../domain/grading/registry';
import { rubricView } from '../domain/grading/rubric-view';
const github = vi.hoisted(() => ({ resolve: vi.fn(), collect: vi.fn() }));
vi.mock('../github/collect-readiness', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../github/collect-readiness')>()),
  resolveReadinessSha: github.resolve,
  collectReadiness: github.collect,
}));
const sha = 'a'.repeat(40);
const result = runDeclarative(agentReadinessManifest, {
  sha,
  complete: true,
  documents: [{ path: 'README.md', blobSha: 'b'.repeat(40), text: 'private source marker' }],
});
async function finished(repo: string) {
  const run = await requestGrade(repo, AGENT_READINESS);
  await beginGrade(run.id);
  await pinGradeSha(run.id, sha);
  await completeGrade(run.id, result);
  return run;
}
test('completed records remain immutable and survive newer failures and results', async () => {
  const repo = await seed();
  const a = await finished(repo);
  const original = await getGrade(repo, a.id, AGENT_READINESS);
  await failGrade(a.id);
  await pinGradeSha(a.id, 'c'.repeat(40));
  await completeGrade(a.id, { ...result, score: 100 });
  await beginGrade(a.id);
  expect(await getGrade(repo, a.id, AGENT_READINESS)).toEqual(original);
  const b = await requestGrade(repo, AGENT_READINESS);
  await failGrade(b.id, 'private provider token');
  expect((await latestGrade(repo, AGENT_READINESS))?.id).toBe(a.id);
  const retry = await requestGrade(repo, AGENT_READINESS);
  expect(retry.id).not.toBe(b.id);
  expect((await loadGradeRun(retry.id))?.retryOf).toBe(b.id);
  await failGrade(retry.id);
  const c = await finished(repo);
  expect((await latestGrade(repo, AGENT_READINESS))?.id).toBe(c.id);
  expect((await gradeHistory(repo, AGENT_READINESS)).map((x) => x.id)).toEqual([c.id, a.id]);
  expect(await getGrade(repo, a.id, AGENT_READINESS)).toEqual(original);
  expect(JSON.stringify(await loadGradeRun(a.id))).not.toContain('private source marker');
  expect((await loadGradeRun(b.id))?.errorCode).toBe('collection_failed');
});
test('dispatch failure before acknowledgement remains reconcilable with stable event id', async () => {
  const run = await requestGrade(await seed(), AGENT_READINESS);
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error('network after accepted'))
    .mockResolvedValue(undefined);
  await expect(dispatchGrade(run.id, send)).rejects.toThrow();
  expect(await listUndispatchedGrades()).toContain(run.id);
  await dispatchGrade(run.id, send);
  await dispatchGrade(run.id, send);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
  expect((await loadGradeRun(run.id))?.dispatchedAt).toBeInstanceOf(Date);
});
test('duplicate delivery and collection retry reuse the persisted SHA without source step output', async () => {
  const run = await requestGrade(await seed(), AGENT_READINESS);
  await beginGrade(run.id);
  github.resolve.mockResolvedValueOnce(sha).mockResolvedValue('c'.repeat(40));
  expect(await resolveGradeCommit(run.id)).toBe(sha);
  expect(await resolveGradeCommit(run.id)).toBe(sha);
  expect(github.resolve).toHaveBeenCalledTimes(1);
  github.collect
    .mockRejectedValueOnce(new Error('secret-token'))
    .mockResolvedValue({ sha, complete: true, documents: [] });
  await expect(evaluateGradeRun(run.id)).rejects.toThrow('Repository evidence collection failed');
  expect((await loadGradeRun(run.id))?.sha).toBe(sha);
  expect(await evaluateGradeRun(run.id)).toBeUndefined();
  await evaluateGradeRun(run.id);
  expect(github.collect).toHaveBeenCalledTimes(2);
  expect(github.collect.mock.calls.every((call) => call[1] === sha)).toBe(true);
  expect((await loadGradeRun(run.id))?.state).toBe('complete');
});
test('revocation before start and inactive installation prevent work', async () => {
  const repo = await seed();
  const run = await requestGrade(repo, AGENT_READINESS);
  await db().delete(workspaceRepositories).where(eq(workspaceRepositories.repositoryId, repo));
  await expect(beginGrade(run.id)).rejects.toThrow('Grade access revoked');
  await expect(resolveGradeCommit(run.id)).rejects.toThrow('Grade unavailable');
  expect((await loadGradeRun(run.id))?.state).toBe('failed');
  const repo2 = await seed();
  const run2 = await requestGrade(repo2, AGENT_READINESS);
  await db().update(installations).set({ active: false }).where(eq(installations.id, repo2));
  await expect(beginGrade(run2.id)).rejects.toThrow();
});
test('read authorization, repository/run association, and batch filtering protect private evidence', async () => {
  const repo = await seed();
  const run = await finished(repo);
  const other = await seed();
  expect(await getGrade(other, run.id, AGENT_READINESS)).toBeNull();
  await db().delete(workspaceRepositories).where(eq(workspaceRepositories.repositoryId, repo));
  await expect(latestGrade(repo, AGENT_READINESS)).rejects.toThrow('not found');
  await expect(gradeHistory(repo, AGENT_READINESS)).rejects.toThrow('not found');
  await expect(getGrade(repo, run.id, AGENT_READINESS)).rejects.toThrow('not found');
  await expect(requestGrade(repo, AGENT_READINESS)).rejects.toThrow('not found');
  expect((await gradeSummaries([repo, other], AGENT_READINESS)).map((x) => x.repositoryId)).toEqual(
    [other],
  );
});
test('rubric definitions cannot change in place and unknown pinned versions never use latest evaluator', async () => {
  await registerRubric(agentReadinessManifest);
  await registerRubric(agentReadinessManifest);
  await expect(registerRubric({ ...agentReadinessManifest, checks: [] })).rejects.toThrow(
    'mismatch',
  );
  const definition = { ...agentReadinessManifest, version: 'future-test' };
  await registerRubric(definition);
  const run = await requestGrade(await seed(), AGENT_READINESS);
  await db()
    .update(gradeRuns)
    .set({ rubricVersion: definition.version })
    .where(eq(gradeRuns.id, run.id));
  await expect(beginGrade(run.id)).rejects.toThrow('Unsupported rubric version');
});
test('incomplete collection fails with no score; demo mutation is rejected', async () => {
  const repo = await seed();
  const run = await requestGrade(repo, AGENT_READINESS);
  await beginGrade(run.id);
  await pinGradeSha(run.id, sha);
  github.collect.mockResolvedValue({ sha, complete: false, documents: [] });
  await evaluateGradeRun(run.id);
  expect(await loadGradeRun(run.id)).toMatchObject({
    state: 'failed',
    result: null,
    errorCode: 'incomplete_collection',
  });
  await db().update(repositories).set({ isDemo: true }).where(eq(repositories.id, repo));
  context.demo = true;
  try {
    await expect(requestGrade(repo, AGENT_READINESS)).rejects.toThrow('read-only');
  } finally {
    context.demo = false;
  }
});

test('one active run per grader: a second grader may run alongside, the same one may not', async () => {
  const repo = await seed();
  const first = await requestGrade(repo, AGENT_READINESS);
  expect((await requestGrade(repo, AGENT_READINESS)).id).toBe(first.id);
  const other = registerGrader({
    ...agentReadinessManifest,
    id: 'fieldnote/second-fixture',
    card: { ...agentReadinessManifest.card, tagline: 'A second grader, for the index only.' },
  });
  const second = await requestGrade(repo, other.id);
  expect(second.id).not.toBe(first.id);
  expect(await gradeHistory(repo, other.id)).toEqual([]);
  expect((await loadGradeRun(second.id))?.graderId).toBe('fieldnote/second-fixture');
});

test('a version freezes the rubric, not the card copy', async () => {
  await registerRubric(agentReadinessManifest);
  // Presentation-only drift: the reader-facing copy changes, nothing that
  // decides a score does.
  const recopied = {
    ...agentReadinessManifest,
    card: { ...agentReadinessManifest.card, tagline: 'Reworded for the card.' },
  };
  const stored = await registerRubric(recopied);
  expect((stored.manifest as typeof agentReadinessManifest).card.tagline).toBe(
    'Reworded for the card.',
  );
});

test('a version still freezes a threshold that would move every score', async () => {
  await registerRubric(agentReadinessManifest);
  // rubricView carries only { id, maxPoints }, so this change is invisible to
  // the definition hash — and it is exactly the kind of change that must not
  // pass silently.
  const reweighted = {
    ...agentReadinessManifest,
    checks: agentReadinessManifest.checks.map((check, index) =>
      index === 0 ? { ...check, args: { ...check.args, nonempty: false } } : check,
    ),
  } as typeof agentReadinessManifest;
  await expect(registerRubric(reweighted)).rejects.toThrow('Rubric version definition mismatch');
});

test('a stored manifest from before card.title still registers', async () => {
  // The row every existing installation holds: same rubric, no card title.
  // An earlier test in this file already registered this exact
  // (graderId, version) row, so it is deleted first — otherwise the primary
  // key would reject this insert.
  await db()
    .delete(gradingRubrics)
    .where(
      and(
        eq(gradingRubrics.graderId, agentReadinessManifest.id),
        eq(gradingRubrics.version, agentReadinessManifest.version),
      ),
    );
  const { card, ...rest } = agentReadinessManifest;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- discarded on purpose
  const { title: _title, ...cardWithoutTitle } = card;
  await db()
    .insert(gradingRubrics)
    .values({
      graderId: agentReadinessManifest.id,
      version: agentReadinessManifest.version,
      evaluatorVersion: agentReadinessManifest.evaluatorVersion,
      definition: rubricView(agentReadinessManifest),
      manifest: { ...rest, card: cardWithoutTitle },
    });
  const stored = await registerRubric(agentReadinessManifest);
  expect((stored.manifest as typeof agentReadinessManifest).card.title).toBe('Agent Readiness');
});

test('validateGradeRun accepts card drift but rejects frozen field changes', async () => {
  // Register the rubric and create a run.
  const repo = await seed();
  await registerRubric(agentReadinessManifest);
  const runInfo = await requestGrade(repo, AGENT_READINESS);
  const run = await loadGradeRun(runInfo.id);
  if (!run) throw new Error('Run not found');

  // Update stored rubric card only (this is allowed drift).
  const cardDrifted = {
    ...agentReadinessManifest,
    card: { ...agentReadinessManifest.card, tagline: 'Modified tagline for drift test.' },
  };
  await db()
    .update(gradingRubrics)
    .set({ manifest: cardDrifted })
    .where(
      and(
        eq(gradingRubrics.graderId, agentReadinessManifest.id),
        eq(gradingRubrics.version, agentReadinessManifest.version),
      ),
    );

  // validateGradeRun should accept the run despite card drift.
  await expect(validateGradeRun(run)).resolves.not.toThrow();

  // Now test that frozen field changes are rejected.
  // Create a second run.
  const run2Info = await requestGrade(repo, AGENT_READINESS);
  const run2 = await loadGradeRun(run2Info.id);
  if (!run2) throw new Error('Run not found');

  // Modify a frozen field in the stored rubric.
  const frozenDrifted = {
    ...agentReadinessManifest,
    checks: agentReadinessManifest.checks.map((check, index) =>
      index === 0 ? { ...check, args: { ...check.args, nonempty: false } } : check,
    ),
  } as typeof agentReadinessManifest;
  await db()
    .update(gradingRubrics)
    .set({ manifest: frozenDrifted })
    .where(
      and(
        eq(gradingRubrics.graderId, agentReadinessManifest.id),
        eq(gradingRubrics.version, agentReadinessManifest.version),
      ),
    );

  // validateGradeRun should reject the run.
  await expect(validateGradeRun(run2)).rejects.toThrow('Unsupported rubric version');

  // Clean up: restore the original manifest for subsequent tests.
  await db()
    .update(gradingRubrics)
    .set({ manifest: agentReadinessManifest })
    .where(
      and(
        eq(gradingRubrics.graderId, agentReadinessManifest.id),
        eq(gradingRubrics.version, agentReadinessManifest.version),
      ),
    );
});
