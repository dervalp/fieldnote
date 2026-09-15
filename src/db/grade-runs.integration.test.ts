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
import { installBuiltIns, seedBuiltInGraders } from './queries/graders';
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
  await seedBuiltInGraders();
  await installBuiltIns(context.workspace);
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
test('concurrent clicks share one active run', async () => {
  const id = await fixtureRepository();
  const [a, b] = await Promise.all([
    requestGrade(id, AGENT_READINESS),
    requestGrade(id, AGENT_READINESS),
  ]);
  expect(a.id).toBe(b.id);
});

import { eq, inArray } from 'drizzle-orm';
import { gradeRuns, graderInstalls, graders, graderVersions } from './schema';
import {
  beginGrade,
  pinGradeSha,
  completeGrade,
  failGrade,
  loadGradeRun,
  latestGrade,
  latestCompletedGrade,
  getGrade,
  gradeHistory,
  gradeSummaries,
  pinnedManifest,
  listUndispatchedGrades,
  validateGradeRun,
  insufficientGrade,
  scheduleGrade,
  activeGradeRun,
} from './queries/grade-runs';
import { dispatchGrade } from '../inngest/dispatch-grade';
import { evaluateGradeRun, resolveGradeCommit } from '../inngest/functions/grade-repository';
import { runDeclarative } from '../domain/grading/declarative';
import { AGENT_READINESS, agentReadinessManifest } from '../domain/grading/graders/agent-readiness';
import { DELIVERY_HEALTH, deliveryHealthManifest } from '../domain/grading/graders/delivery-health';
import { needsHash } from '../domain/grading/needs-consent';
import type { GraderManifest } from '../domain/grading/manifest';
// Publishes and installs a fixture grader directly into the registry tables —
// the equivalent, under a seeded registry, of the old registerGrader(): a
// grader that exists only for this file's "a second grader" fixture, never a
// real built-in.
async function publishAndInstall(manifest: GraderManifest) {
  await db().insert(graders).values({ id: manifest.id }).onConflictDoNothing();
  await db()
    .insert(graderVersions)
    .values({
      graderId: manifest.id,
      version: manifest.version,
      evaluatorVersion: manifest.evaluatorVersion,
      manifest,
    })
    .onConflictDoNothing();
  await db()
    .insert(graderInstalls)
    .values({
      workspaceId: context.workspace,
      graderId: manifest.id,
      version: manifest.version,
      installedBy: context.user,
      consentedNeeds: needsHash(manifest.needs),
    })
    .onConflictDoNothing();
}
// Publishes a fixture version of an EXISTING grader (agentReadinessManifest's
// id) without installing it — for tests that only need pinnedManifest/
// validateGradeRun to resolve a specific, distinct (graderId, version), never
// through a workspace install. Withdrawn immediately: latestPublishedVersion
// must keep reporting the real built-in as "latest" for every other test in
// this file that requests AGENT_READINESS, and pinnedManifest resolves a
// withdrawn version exactly as well as a live one (it stops new installs, not
// history) — see pinnedManifest's own doc comment.
async function publishWithdrawnVersion(manifest: GraderManifest) {
  await db()
    .insert(graderVersions)
    .values({
      graderId: manifest.id,
      version: manifest.version,
      evaluatorVersion: manifest.evaluatorVersion,
      manifest,
      withdrawnAt: new Date(),
    })
    .onConflictDoNothing();
}
const github = vi.hoisted(() => ({ resolve: vi.fn(), collect: vi.fn() }));
vi.mock('../github/collect-files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../github/collect-files')>()),
  resolveHeadSha: github.resolve,
  collectFiles: github.collect,
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
  const repo = await fixtureRepository();
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
  const run = await requestGrade(await fixtureRepository(), AGENT_READINESS);
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
  const run = await requestGrade(await fixtureRepository(), AGENT_READINESS);
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
  const repo = await fixtureRepository();
  const run = await requestGrade(repo, AGENT_READINESS);
  await db().delete(workspaceRepositories).where(eq(workspaceRepositories.repositoryId, repo));
  await expect(beginGrade(run.id)).rejects.toThrow('Grade access revoked');
  await expect(resolveGradeCommit(run.id)).rejects.toThrow('Grade unavailable');
  expect((await loadGradeRun(run.id))?.state).toBe('failed');
  const repo2 = await fixtureRepository();
  const run2 = await requestGrade(repo2, AGENT_READINESS);
  await db().update(installations).set({ active: false }).where(eq(installations.id, repo2));
  await expect(beginGrade(run2.id)).rejects.toThrow();
});
test('read authorization, repository/run association, and batch filtering protect private evidence', async () => {
  const repo = await fixtureRepository();
  const run = await finished(repo);
  const other = await fixtureRepository();
  expect(await getGrade(other, run.id, AGENT_READINESS)).toBeNull();
  await db().delete(workspaceRepositories).where(eq(workspaceRepositories.repositoryId, repo));
  await expect(latestGrade(repo, AGENT_READINESS)).rejects.toThrow('not found');
  await expect(gradeHistory(repo, AGENT_READINESS)).rejects.toThrow('not found');
  await expect(getGrade(repo, run.id, AGENT_READINESS)).rejects.toThrow('not found');
  await expect(requestGrade(repo, AGENT_READINESS)).rejects.toThrow('not found');
  expect(
    (await gradeSummaries([repo, other], [AGENT_READINESS])).map((x) => x.repositoryId),
  ).toEqual([other]);
});
test('a pinned version that was never published raises Unsupported rubric version', async () => {
  // grader_versions is immutable and resolved by exact (grader_id, version):
  // there is no "latest evaluator" to fall back on when the pinned version
  // itself was never published.
  const run = await requestGrade(await fixtureRepository(), AGENT_READINESS);
  await db()
    .update(gradeRuns)
    .set({ rubricVersion: 'never-published-fixture' })
    .where(eq(gradeRuns.id, run.id));
  await expect(beginGrade(run.id)).rejects.toThrow('Unsupported rubric version');
});
test('incomplete collection fails with no score; demo mutation is rejected', async () => {
  const repo = await fixtureRepository();
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
  const repo = await fixtureRepository();
  const first = await requestGrade(repo, AGENT_READINESS);
  expect((await requestGrade(repo, AGENT_READINESS)).id).toBe(first.id);
  const other = {
    ...agentReadinessManifest,
    id: 'fieldnote/second-fixture',
    card: { ...agentReadinessManifest.card, tagline: 'A second grader, for the index only.' },
  };
  await publishAndInstall(other);
  const second = await requestGrade(repo, other.id);
  expect(second.id).not.toBe(first.id);
  expect(await gradeHistory(repo, other.id)).toEqual([]);
  expect((await loadGradeRun(second.id))?.graderId).toBe('fieldnote/second-fixture');
});

test('a version still freezes a threshold that would move every score', async () => {
  const repo = await fixtureRepository();
  const run = await requestGrade(repo, AGENT_READINESS);
  // There is no separate definition view anymore for a threshold like
  // `nonempty` to hide behind — grader_versions.manifest is the only stored
  // shape, args included. What must still hold is that pinning is by exact
  // version, not by grader id: publishing a reweighted fixture under a new
  // version must not change what the already-pinned version resolves to.
  const reweighted = {
    ...agentReadinessManifest,
    version: '9.9.91',
    checks: agentReadinessManifest.checks.map((check, index) =>
      index === 0 && 'args' in check ? { ...check, args: { ...check.args, nonempty: false } } : check,
    ),
  } as typeof agentReadinessManifest;
  await publishWithdrawnVersion(reweighted);
  expect((await loadGradeRun(run.id))?.rubricVersion).toBe(agentReadinessManifest.version);
  const pinned = await pinnedManifest(AGENT_READINESS, agentReadinessManifest.version);
  expect((pinned.checks[0] as { args: { nonempty: boolean } }).args.nonempty).toBe(true);
  const fixturePinned = await pinnedManifest(AGENT_READINESS, reweighted.version);
  expect((fixturePinned.checks[0] as { args: { nonempty: boolean } }).args.nonempty).toBe(false);
  await expect(beginGrade(run.id)).resolves.not.toThrow();
});

test('validateGradeRun accepts card drift but rejects frozen field changes', async () => {
  const repo = await fixtureRepository();
  // Presentation-only drift: a version that only recaptions the card is an
  // ordinary, independently valid version — nothing about it is rejected.
  const cardDrifted = {
    ...agentReadinessManifest,
    version: '9.9.92',
    card: { ...agentReadinessManifest.card, tagline: 'Modified tagline for drift test.' },
  };
  await publishWithdrawnVersion(cardDrifted);
  const cardRun = await requestGrade(repo, AGENT_READINESS);
  await db()
    .update(gradeRuns)
    .set({ rubricVersion: cardDrifted.version })
    .where(eq(gradeRuns.id, cardRun.id));
  const run = await loadGradeRun(cardRun.id);
  if (!run) throw new Error('Run not found');
  await expect(validateGradeRun(run)).resolves.not.toThrow();

  // Card copy is never frozen. evaluatorVersion is: a run whose recorded
  // evaluatorVersion no longer matches its pinned version's is the one drift
  // validateGradeRun still refuses.
  const mismatchRun = await requestGrade(repo, AGENT_READINESS);
  await db()
    .update(gradeRuns)
    .set({ evaluatorVersion: 'stale-evaluator-fixture' })
    .where(eq(gradeRuns.id, mismatchRun.id));
  const run2 = await loadGradeRun(mismatchRun.id);
  if (!run2) throw new Error('Run not found');
  await expect(validateGradeRun(run2)).rejects.toThrow('Unsupported rubric version');
});

test('an insufficient run stores its unscored result', async () => {
  const repositoryId = await fixtureRepository();
  const run = await requestGrade(repositoryId, DELIVERY_HEALTH);
  await beginGrade(run.id);
  await pinGradeSha(run.id, 'a'.repeat(40));
  await insufficientGrade(run.id, {
    score: null,
    checks: [],
    rubricVersion: deliveryHealthManifest.version,
    evaluatorVersion: deliveryHealthManifest.evaluatorVersion,
    incompleteReason: deliveryHealthManifest.needs['fieldnote.metrics']!.insufficientReason,
  });
  const stored = await loadGradeRun(run.id);
  expect(stored?.state).toBe('insufficient');
  expect(stored?.result?.score).toBeNull();
  expect(stored?.result?.incompleteReason).toBe(
    deliveryHealthManifest.needs['fieldnote.metrics']!.insufficientReason,
  );
  expect(stored?.completedAt).toBeInstanceOf(Date);
});

test('insufficientGrade refuses a result that has a score', async () => {
  const repositoryId = await fixtureRepository();
  const run = await requestGrade(repositoryId, DELIVERY_HEALTH);
  await beginGrade(run.id);
  await pinGradeSha(run.id, 'b'.repeat(40));
  await expect(
    insufficientGrade(run.id, {
      score: 80,
      checks: [],
      rubricVersion: deliveryHealthManifest.version,
      evaluatorVersion: deliveryHealthManifest.evaluatorVersion,
    }),
  ).rejects.toThrow('Invalid grade result');
});

test('a complete run still cannot store a null score', async () => {
  const repositoryId = await fixtureRepository();
  const run = await requestGrade(repositoryId, DELIVERY_HEALTH);
  await beginGrade(run.id);
  await pinGradeSha(run.id, 'c'.repeat(40));
  await expect(
    db()
      .update(gradeRuns)
      .set({
        state: 'complete',
        result: {
          score: null,
          checks: [],
          rubricVersion: deliveryHealthManifest.version,
          evaluatorVersion: deliveryHealthManifest.evaluatorVersion,
        },
        completedAt: new Date(),
      })
      .where(eq(gradeRuns.id, run.id)),
  ).rejects.toThrow();
});

test('a failed run still cannot store a result', async () => {
  const repositoryId = await fixtureRepository();
  const run = await requestGrade(repositoryId, DELIVERY_HEALTH);
  await beginGrade(run.id);
  await pinGradeSha(run.id, 'd'.repeat(40));
  await expect(
    db()
      .update(gradeRuns)
      .set({
        state: 'failed',
        result: {
          score: null,
          checks: [],
          rubricVersion: deliveryHealthManifest.version,
          evaluatorVersion: deliveryHealthManifest.evaluatorVersion,
        },
        completedAt: new Date(),
      })
      .where(eq(gradeRuns.id, run.id)),
  ).rejects.toThrow();
});

test('history and the latest grade ignore an insufficient run', async () => {
  const repositoryId = await fixtureRepository();
  const run = await requestGrade(repositoryId, DELIVERY_HEALTH);
  await beginGrade(run.id);
  await pinGradeSha(run.id, 'e'.repeat(40));
  await insufficientGrade(run.id, {
    score: null,
    checks: [],
    rubricVersion: deliveryHealthManifest.version,
    evaluatorVersion: deliveryHealthManifest.evaluatorVersion,
    incompleteReason: 'Not enough delivery record to judge.',
  });
  expect(await latestCompletedGrade(repositoryId, DELIVERY_HEALTH)).toBeNull();
  expect(await gradeHistory(repositoryId, DELIVERY_HEALTH)).toEqual([]);
  const [summary] = await gradeSummaries([repositoryId], [DELIVERY_HEALTH]);
  expect(summary.latest).toBeNull();
  // The current state, though, is exactly what `unscored` is for.
  expect(summary.unscored?.incompleteReason).toBe('Not enough delivery record to judge.');
});

test('a scheduled run is created with no session and records its trigger', async () => {
  const repositoryId = await fixtureRepository();
  const run = await scheduleGrade({
    repositoryId,
    graderId: AGENT_READINESS,
    enabledBy: context.user,
    workspaceId: context.workspace,
  });
  const stored = await loadGradeRun(run.id);
  expect(stored?.state).toBe('queued');
  expect(stored?.trigger).toBe('schedule');
  expect(stored?.requestedBy).toBe(context.user);
  expect(stored?.requestedWorkspaceId).toBe(context.workspace);
});

test('a manual run still records trigger manual', async () => {
  const repositoryId = await fixtureRepository();
  const run = await requestGrade(repositoryId, AGENT_READINESS);
  expect((await loadGradeRun(run.id))?.trigger).toBe('manual');
});

test('the scheduler cannot create a run for a repository the workspace lost', async () => {
  const repositoryId = await fixtureRepository();
  await db()
    .delete(workspaceRepositories)
    .where(eq(workspaceRepositories.repositoryId, repositoryId));
  await expect(
    scheduleGrade({
      repositoryId,
      graderId: AGENT_READINESS,
      enabledBy: context.user,
      workspaceId: context.workspace,
    }),
  ).rejects.toThrow('Repository unavailable');
});

test('activeGradeRun sees a queued run and not a completed one', async () => {
  const repositoryId = await fixtureRepository();
  const run = await requestGrade(repositoryId, AGENT_READINESS);
  expect(await activeGradeRun(repositoryId, AGENT_READINESS)).toBe(true);
  await failGrade(run.id);
  expect(await activeGradeRun(repositoryId, AGENT_READINESS)).toBe(false);
});

test('a code grader failure and a sandbox outage keep their own error codes', async () => {
  const repo = await fixtureRepository();
  const failed = await requestGrade(repo, AGENT_READINESS);
  await failGrade(failed.id, 'grader_failed');
  expect((await loadGradeRun(failed.id))?.errorCode).toBe('grader_failed');
  const outage = await requestGrade(repo, AGENT_READINESS);
  await failGrade(outage.id, 'sandbox_unavailable');
  expect((await loadGradeRun(outage.id))?.errorCode).toBe('sandbox_unavailable');
});
