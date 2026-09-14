// The barrel comes first on purpose. Registration is a side effect of
// importing a grader, ES modules evaluate imports in source order, and the
// order assertion below is about the barrel's declared order — not about
// which import this test file happens to list first.
import { AGENT_READINESS, DELIVERY_HEALTH, deliveryHealthManifest } from './index';
import { expect, test } from 'vitest';
import { runDeclarative } from '../declarative';
import { getGrader, listGraders } from '../registry';
import type { MetricsWindow, RepositorySnapshot } from '../types';

const metricsWindow = (over: Partial<MetricsWindow> = {}): MetricsWindow => ({
  days: 30,
  start: '2026-08-15T00:00:00.000Z',
  endExclusive: '2026-09-14T00:00:00.000Z',
  mergedPullRequests: 53,
  'first-pass-rate': { numerator: 36, denominator: 53, value: (100 * 36) / 53 },
  'ci-success-rate': { numerator: 95, denominator: 100, value: 95 },
  'ci-recovery-rate': { numerator: 1, denominator: 4, value: 25 },
  ...over,
});

const snapshot = (metrics: MetricsWindow): RepositorySnapshot => ({
  sha: 'commit-sha',
  complete: true,
  documents: [],
  metrics,
});

test('delivery health grades a pinned window at version 0.2.0', () => {
  expect(deliveryHealthManifest.version).toBe('0.2.0');
  expect(deliveryHealthManifest.subject).toBe('repository_window');
});

test('the grader registers and is an ordinary one', () => {
  expect(getGrader(DELIVERY_HEALTH)).toBe(deliveryHealthManifest);
  expect(deliveryHealthManifest.checks.reduce((sum, c) => sum + c.points, 0)).toBe(100);
  expect(deliveryHealthManifest.mode).toBe('deterministic');
  expect(deliveryHealthManifest.category).toBe('delivery-health');
});

test('both built-ins are listed, readiness first', () => {
  // The row on the Grades tab renders in this order, so it is a product
  // decision worth pinning rather than an accident of the module graph.
  expect(listGraders().map((grader) => grader.id)).toEqual([AGENT_READINESS, DELIVERY_HEALTH]);
});

test('a repository that merges cleanly and recovers scores 100', () => {
  const result = runDeclarative(
    deliveryHealthManifest,
    snapshot(
      metricsWindow({
        'first-pass-rate': { numerator: 45, denominator: 53, value: (100 * 45) / 53 },
        'ci-recovery-rate': { numerator: 3, denominator: 4, value: 75 },
      }),
    ),
  );
  expect(result.score).toBe(100);
});

test('a repository that merges by attrition scores only CI', () => {
  const result = runDeclarative(deliveryHealthManifest, snapshot(metricsWindow()));
  // first-pass 68% >= 60 passes (40), ci-success 95% >= 90 passes (30),
  // ci-recovery 25% < 50 fails (0).
  expect(result.score).toBe(70);
  expect(result.checks.find((check) => check.id === 'failures-get-fixed')?.status).toBe('fail');
});
