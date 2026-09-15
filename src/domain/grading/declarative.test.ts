import { expect, test } from 'vitest';
import { INCOMPLETE, runDeclarative } from './declarative';
import { parseManifest } from './manifest';
import type { MetricsWindow, RepositorySnapshot } from './types';

const metricsManifest = parseManifest({
  id: 'fieldnote/example-metrics',
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository_window',
  mode: 'deterministic',
  category: 'delivery-health',
  kind: 'declarative',
  needs: {
    'fieldnote.metrics': {
      windowDays: 30,
      minMergedPullRequests: 10,
      insufficientReason: 'Not enough merged work to judge.',
    },
  },
  disclaimer: 'A delivery record.',
  card: {
    title: 'Example Metrics',
    tagline: 'Does work reach green cleanly?',
    groups: [{ title: 'CI', checks: ['green'] }],
  },
  checks: [
    {
      id: 'green',
      title: 'CI ends green',
      points: 100,
      explain: { pass: 'Green.', fail: 'Red.' },
      primitive: 'metric-threshold',
      args: { metric: 'ci-success-rate', atLeastPercent: 90 },
    },
  ],
});

// A genuinely file-only grader. Asserting "no window" against the metrics
// manifest would mean running a metric-threshold check with no window,
// which Task 2 specified as a throw — a wiring bug, not a repository
// state. The test must use a grader that really reads files.
const filesManifest = parseManifest({
  id: 'fieldnote/example-files',
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'documentation',
  kind: 'declarative',
  needs: { 'repo.files': ['README.md'] },
  disclaimer: 'Evidence, not certification.',
  card: {
    title: 'Example Files',
    tagline: 'Is anything written down?',
    groups: [{ title: 'Docs', checks: ['readme'] }],
  },
  checks: [
    {
      id: 'readme',
      title: 'Project documentation',
      points: 100,
      explain: { pass: 'Found a README.', fail: 'No README.' },
      primitive: 'file-exists',
      args: { root: true, nonempty: true, anyOf: ['README.md'] },
    },
  ],
});

const metrics: MetricsWindow = {
  days: 30,
  start: '2026-08-15T00:00:00.000Z',
  endExclusive: '2026-09-14T00:00:00.000Z',
  mergedPullRequests: 53,
  'first-pass-rate': { numerator: 36, denominator: 53, value: (100 * 36) / 53 },
  'ci-success-rate': { numerator: 95, denominator: 100, value: 95 },
  'ci-recovery-rate': { numerator: 1, denominator: 4, value: 25 },
};

const snapshot = (over: Partial<RepositorySnapshot> = {}): RepositorySnapshot => ({
  sha: 'commit-sha',
  complete: true,
  documents: [],
  metrics,
  ...over,
});

test('a metrics grader scores and records the window it scored', () => {
  const result = runDeclarative(metricsManifest, snapshot());
  expect(result.score).toBe(100);
  expect(result.window).toEqual({
    start: '2026-08-15T00:00:00.000Z',
    endExclusive: '2026-09-14T00:00:00.000Z',
    days: 30,
  });
});

test('an incomplete window is still recorded — the dates are not in doubt', () => {
  const result = runDeclarative(metricsManifest, snapshot({ complete: false }));
  expect(result.score).toBeNull();
  expect(result.window).toEqual({
    start: '2026-08-15T00:00:00.000Z',
    endExclusive: '2026-09-14T00:00:00.000Z',
    days: 30,
  });
});

test('a file-only grader records no window at all', () => {
  const result = runDeclarative(filesManifest, {
    sha: 'commit-sha',
    complete: true,
    documents: [{ path: 'README.md', blobSha: 'readme-sha', text: '# Project' }],
  });
  expect(result.score).toBe(100);
  // Absence, not an undefined value: this object is stored in a jsonb
  // column, and toBeUndefined() alone cannot tell the two apart.
  expect('window' in result).toBe(false);
});

test("the snapshot's own reason wins, because it belongs to the grader", () => {
  const result = runDeclarative(
    metricsManifest,
    snapshot({ complete: false, incompleteReason: 'Not enough merged work to judge.' }),
  );
  expect(result.incompleteReason).toBe('Not enough merged work to judge.');
});

test("collection failing is fieldnote's sentence, and it is the fallback", () => {
  const result = runDeclarative(metricsManifest, snapshot({ complete: false }));
  expect(result.incompleteReason).toBe(INCOMPLETE);
});
