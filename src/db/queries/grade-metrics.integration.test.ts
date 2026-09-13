import { beforeAll, beforeEach, afterAll, expect, test, vi } from 'vitest';
import { inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, closeDb } from '..';
import * as s from '../schema';
import { persistDashboardEvidence } from './dashboard-evidence';
import { collectMetrics } from './grade-metrics';
import { INCOMPLETE } from '../../domain/grading/declarative';

// This suite reuses basic-dashboard.integration.test.ts's arrangement rather
// than inventing its own: the same installation/repository/PR/evidence shape,
// so the two suites cannot disagree about what a complete or partial window is.
const repositoryId = 'grade-metrics-a';
const partialRepositoryId = 'grade-metrics-b';
const repos = [repositoryId, partialRepositoryId];

const need = {
  windowDays: 30 as const,
  minMergedPullRequests: 10,
  insufficientReason: 'Not enough merged work to judge.',
};

beforeAll(async () => {
  // "Now" (2026-09-13, in every test below) must stay well before the real
  // clock the coverage check reads for its own 'current-day' rule, or the
  // window's last day would always read back as still in progress.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-20T12:00:00Z'));
  await migrate(db(), { migrationsFolder: 'drizzle' });
  await db()
    .insert(s.installations)
    .values({
      id: 'grade-metrics-install',
      githubInstallationId: 'grade-metrics-install',
      accountLogin: 'test',
      accountType: 'User',
    })
    .onConflictDoNothing();
  await db()
    .insert(s.repositories)
    .values(
      repos.map((id) => ({
        id,
        installationId: 'grade-metrics-install',
        githubRepositoryId: id,
        owner: 'test',
        name: id,
        defaultBranch: 'main',
        isPrivate: true,
        trackingStartedAt: new Date('2026-01-01'),
      })),
    )
    .onConflictDoNothing();
});

beforeEach(async () => {
  const prs = await db()
    .select({ id: s.pullRequests.id })
    .from(s.pullRequests)
    .where(inArray(s.pullRequests.repositoryId, repos));
  const ids = prs.map((p) => p.id);
  if (ids.length) {
    await db().delete(s.prWorkflowAttempts).where(inArray(s.prWorkflowAttempts.pullRequestId, ids));
    await db().delete(s.reviewEvents).where(inArray(s.reviewEvents.pullRequestId, ids));
    await db()
      .delete(s.dashboardPrEvidence)
      .where(inArray(s.dashboardPrEvidence.pullRequestId, ids));
    await db().delete(s.pullRequests).where(inArray(s.pullRequests.id, ids));
  }
  await db().delete(s.workflowAttempts).where(inArray(s.workflowAttempts.repositoryId, repos));
  await db().delete(s.historyBackfills).where(inArray(s.historyBackfills.repositoryId, repos));
  await db().delete(s.repositoryImports).where(inArray(s.repositoryImports.repositoryId, repos));
  await db().update(s.repositories).set({ active: true }).where(inArray(s.repositories.id, repos));
});

afterAll(async () => {
  vi.useRealTimers();
  await closeDb();
});

async function insertPr(
  targetRepositoryId: string,
  n: number,
  outcome: 'first-pass' | 'recovered' | 'failed' = 'first-pass',
) {
  const id = `${targetRepositoryId}-${n}`;
  const openedAt = '2026-09-01T00:00:00Z';
  const mergedAt = '2026-09-03T12:00:00Z';
  await db()
    .insert(s.pullRequests)
    .values({
      id,
      repositoryId: targetRepositoryId,
      githubPrId: id,
      githubPrNumber: n,
      title: 'Test',
      state: 'closed',
      authorLogin: 'test',
      headSha: 'head',
      baseSha: 'base',
      openedAt: new Date(openedAt),
      mergedAt: new Date(mergedAt),
      sourceUpdatedAt: new Date('2026-09-09'),
      facts: {
        openedAt,
        mergedAt,
        closedAt: mergedAt,
        revisions: [],
        checks: [],
        files: [],
        historyComplete: true,
        issues: [],
      },
    });
  const attempts =
    outcome === 'recovered'
      ? [
          {
            repositoryId: targetRepositoryId,
            runId: id,
            attempt: 1,
            headSha: 'head',
            status: 'completed',
            conclusion: 'failure',
            startedAt: '2026-09-03T01:00:00Z',
            completedAt: '2026-09-03T01:30:00Z',
          },
          {
            repositoryId: targetRepositoryId,
            runId: id,
            attempt: 2,
            headSha: 'head',
            status: 'completed',
            conclusion: 'success',
            startedAt: '2026-09-03T02:00:00Z',
            completedAt: '2026-09-03T02:30:00Z',
          },
        ]
      : [
          {
            repositoryId: targetRepositoryId,
            runId: id,
            attempt: 1,
            headSha: 'head',
            status: 'completed',
            conclusion: outcome === 'failed' ? 'failure' : 'success',
            startedAt: '2026-09-03T01:00:00Z',
            completedAt: '2026-09-03T02:00:00Z',
          },
        ];
  await persistDashboardEvidence({
    id,
    repositoryId: targetRepositoryId,
    openedAt,
    mergedAt,
    mergeHeadSha: 'head',
    reviewExpected: false,
    ciExpected: true,
    chronologyComplete: true,
    reviewsComplete: true,
    ciComplete: true,
    reviews: [],
    attempts,
  });
  return id;
}

// Discovery must cover the whole 30-day window with margin, or a day at
// either edge reads back as 'outside-collected-history' and coverage drops
// to 'partial' — the same trap basic-dashboard.integration.test.ts avoids.
async function completeHistory(targetRepositoryId: string) {
  await db()
    .insert(s.repositoryImports)
    .values({
      id: `${targetRepositoryId}-import`,
      repositoryId: targetRepositoryId,
      state: 'complete',
      total: 1,
      completed: 1,
      finishedAt: new Date('2026-09-20'),
    });
  await db()
    .insert(s.historyBackfills)
    .values({
      id: `${targetRepositoryId}-history`,
      repositoryId: targetRepositoryId,
      status: 'complete',
      cutoff: new Date('2025-09-10'),
      cursor: JSON.stringify({ page: null, sweep: 1, revision: 1, failures: 0 }),
      finishedAt: new Date('2026-09-20'),
    });
}

test('readings come from the totals, and the window names its dates', async () => {
  await insertPr(repositoryId, 1, 'first-pass');
  await insertPr(repositoryId, 2, 'failed');
  await completeHistory(repositoryId);
  const collected = await collectMetrics(repositoryId, need, new Date('2026-09-13T12:00:00Z'));
  expect(collected.metrics.days).toBe(30);
  expect(collected.metrics.endExclusive).toBe('2026-09-14T00:00:00.000Z');
  expect(collected.metrics['first-pass-rate']).toMatchObject({ numerator: 1, denominator: 2 });
});

test('the recovery rate counts only runs that went red', async () => {
  // Seeded: 8 first-pass runs, 1 recovered, 1 failed.
  // MetricTotals.ciRecovered would be 1/10 = 10%; the check asks 1/2 = 50%.
  for (let n = 1; n <= 8; n++) await insertPr(repositoryId, n, 'first-pass');
  await insertPr(repositoryId, 9, 'recovered');
  await insertPr(repositoryId, 10, 'failed');
  await completeHistory(repositoryId);
  const collected = await collectMetrics(repositoryId, need, new Date('2026-09-13T12:00:00Z'));
  expect(collected.metrics['ci-recovery-rate']).toMatchObject({ numerator: 1, denominator: 2 });
  expect(collected.metrics['ci-recovery-rate'].value).toBe(50);
});

test("too little merged work is incomplete, in the grader's own words", async () => {
  await insertPr(repositoryId, 1, 'first-pass');
  await insertPr(repositoryId, 2, 'failed');
  await completeHistory(repositoryId);
  const collected = await collectMetrics(
    repositoryId,
    { ...need, minMergedPullRequests: 1000 },
    new Date('2026-09-13T12:00:00Z'),
  );
  expect(collected.complete).toBe(false);
  expect(collected.incompleteReason).toBe('Not enough merged work to judge.');
  // The window is still returned: the numbers exist, they are just not enough.
  expect(collected.metrics.mergedPullRequests).toBeGreaterThanOrEqual(0);
});

test("partial coverage is incomplete in fieldnote's words, not the grader's", async () => {
  // A second repository, seeded with the same pull requests but with its
  // import left unfinished, so aggregatePeriod reports coverage 'partial'.
  // basic-dashboard.integration.test.ts sets this up by leaving
  // repositories.trackingStartedAt in place while omitting the import record
  // its coverage reasons look for; copy that arrangement rather than inventing
  // one, so the two suites cannot disagree about what partial means.
  await insertPr(partialRepositoryId, 1, 'first-pass');
  const collected = await collectMetrics(
    partialRepositoryId,
    need,
    new Date('2026-09-13T12:00:00Z'),
  );
  expect(collected.complete).toBe(false);
  expect(collected.incompleteReason).toBe(INCOMPLETE);
});
