import { expect, test } from 'vitest';
import { runCheck } from './primitives';
import type { GraderCheck } from './manifest';
import type { MetricsWindow, SourceDocument } from './types';

const doc = (path: string, text: string): SourceDocument => ({
  path,
  blobSha: `${path}-sha`,
  text,
});
const explain = { pass: 'Found it.', fail: 'Missing.' };
const DISCLAIMER = 'Evidence, not certification.';
const check = (over: Record<string, unknown>): GraderCheck =>
  ({ id: 'c', title: 'C', points: 100, explain, ...over }) as unknown as GraderCheck;

const fileExists = (args: Record<string, unknown>) => check({ primitive: 'file-exists', args });

test('file-exists finds a root file, case-sensitively by default', () => {
  const args = {
    root: true,
    nonempty: true,
    anyOf: ['AGENTS.md', 'CLAUDE.md'],
    caseInsensitive: false,
  };
  const documents = [doc('AGENTS.md', '\nUse pnpm.'), doc('docs/AGENTS.md', 'nope')];
  const result = runCheck(fileExists(args), { documents }, DISCLAIMER);
  expect(result).toMatchObject({ status: 'pass', points: 100, paths: ['AGENTS.md'] });
  expect(result.lineRanges).toEqual([
    { path: 'AGENTS.md', blobSha: 'AGENTS.md-sha', start: 2, end: 2 },
  ]);
  expect(result.explanation).toBe(`Found it. ${DISCLAIMER}`);
});

test('file-exists with nonempty rejects a blank file and explains the failure', () => {
  const args = { root: true, nonempty: true, anyOf: ['AGENTS.md'], caseInsensitive: false };
  const result = runCheck(fileExists(args), { documents: [doc('AGENTS.md', ' \n\t')] }, DISCLAIMER);
  expect(result).toMatchObject({ status: 'fail', points: 0, paths: [], lineRanges: [] });
  expect(result.explanation).toBe(`Missing. ${DISCLAIMER}`);
});

test('file-exists honours caseInsensitive', () => {
  const args = { root: true, nonempty: true, anyOf: ['README.md'], caseInsensitive: true };
  expect(runCheck(fileExists(args), { documents: [doc('readME.MD', '# Project')] }, DISCLAIMER).paths).toEqual([
    'readME.MD',
  ]);
});

test('glob-count counts matching nonempty documents against min', () => {
  const counted = check({
    primitive: 'glob-count',
    args: { pattern: 'docs/**/*.{md,markdown}', caseInsensitive: true, nonempty: true, min: 2 },
  });
  const one = [doc('DOCS/a.MARKDOWN', 'A'), doc('docs/empty.md', '  '), doc('docs/n.txt', 'no')];
  expect(runCheck(counted, { documents: one }, DISCLAIMER).status).toBe('fail');
  const result = runCheck(counted, { documents: [...one, doc('docs/b.md', 'B')] }, DISCLAIMER);
  expect(result.status).toBe('pass');
  expect(result.paths).toEqual(['DOCS/a.MARKDOWN', 'docs/b.md']);
});

test('heading-has-fence scans its scope in the order the scope names it', () => {
  const scoped = check({
    primitive: 'heading-has-fence',
    args: {
      headings: ['setup'],
      scope: [
        { pattern: 'README.md', caseInsensitive: true },
        { pattern: 'AGENTS.md', caseInsensitive: false },
      ],
    },
  });
  const body = ['## Setup', '```sh', 'pnpm install', '```'].join('\n');
  const result = runCheck(scoped, { documents: [doc('AGENTS.md', body), doc('README.md', body)] }, DISCLAIMER);
  expect(result.paths).toEqual(['README.md', 'AGENTS.md']);
  expect(result.status).toBe('pass');
});

test('a document matched by two scope entries is scanned once', () => {
  const scoped = check({
    primitive: 'heading-has-fence',
    args: {
      headings: ['setup'],
      scope: [
        { pattern: '*.md', caseInsensitive: false },
        { pattern: 'README.md', caseInsensitive: false },
      ],
    },
  });
  const result = runCheck(
    scoped,
    { documents: [doc('README.md', ['## Setup', '```', 'x', '```'].join('\n'))] },
    DISCLAIMER,
  );
  expect(result.lineRanges).toHaveLength(1);
});

// The property the spec asks of every primitive: evidence must resolve.
const generated: SourceDocument[] = Array.from({ length: 40 }, (_, i) =>
  doc(
    ['AGENTS.md', 'README.md', 'docs/a.md', 'docs/deep/b.markdown', 'src/x.ts'][i % 5],
    [
      '',
      '# Title',
      ['## Setup', '```sh', `cmd ${i}`, '```'].join('\n'),
      ['```md', '## Setup', '```'].join('\n'),
      `line ${i}\n\n## Install\n~~~\nrun\n~~~`,
    ][i % 5],
  ),
);

test.each([
  fileExists({
    root: true,
    nonempty: true,
    anyOf: ['AGENTS.md', 'README.md'],
    caseInsensitive: true,
  }),
  check({
    primitive: 'glob-count',
    args: { pattern: 'docs/**/*.{md,markdown}', caseInsensitive: true, nonempty: true, min: 1 },
  }),
  check({
    primitive: 'heading-has-fence',
    args: {
      headings: ['setup', 'install'],
      scope: [{ pattern: '**/*.{md,markdown}', caseInsensitive: true }],
    },
  }),
])(
  '$primitive points only at line ranges that resolve inside the document they name',
  (subject) => {
    const result = runCheck(subject, { documents: generated }, DISCLAIMER);
    expect(result.paths).toEqual(result.lineRanges.map((range) => range.path));
    expect(result.lineRanges.length).toBeGreaterThan(0);
    for (const range of result.lineRanges) {
      const document = generated.find((d) => d.path === range.path && d.blobSha === range.blobSha);
      expect(document).toBeDefined();
      const lines = document!.text.split(/\r?\n/);
      expect(range.start).toBeGreaterThanOrEqual(1);
      expect(range.end).toBeGreaterThanOrEqual(range.start);
      expect(range.end).toBeLessThanOrEqual(lines.length);
    }
  },
);

const reading = (numerator: number, denominator: number) => ({
  numerator,
  denominator,
  value: denominator ? (100 * numerator) / denominator : null,
});

const metricsWindow = (over: Partial<MetricsWindow> = {}): MetricsWindow => ({
  days: 30,
  start: '2026-08-15T00:00:00.000Z',
  endExclusive: '2026-09-14T00:00:00.000Z',
  mergedPullRequests: 53,
  'first-pass-rate': reading(36, 53),
  'ci-success-rate': reading(95, 100),
  'ci-recovery-rate': reading(1, 4),
  ...over,
});

const metric = (args: Record<string, unknown>) => check({ primitive: 'metric-threshold', args });

test('metric-threshold passes at the bar and prints the measurement', () => {
  const result = runCheck(
    metric({ metric: 'first-pass-rate', atLeastPercent: 60 }),
    { documents: [], metrics: metricsWindow() },
    DISCLAIMER,
  );
  expect(result).toMatchObject({ status: 'pass', points: 100, paths: [], lineRanges: [] });
  expect(result.explanation).toBe(
    `Found it. Measured 68% (36 of 53) over the 30 days ending 2026-09-13, against a 60% bar. ${DISCLAIMER}`,
  );
});

test('metric-threshold compares the rounded value, so the printed number decided it', () => {
  // 59.6% rounds to 60 and must pass, because 60% is what a reader sees.
  const metrics = metricsWindow({ 'first-pass-rate': reading(149, 250) });
  const result = runCheck(
    metric({ metric: 'first-pass-rate', atLeastPercent: 60 }),
    { documents: [], metrics },
    DISCLAIMER,
  );
  expect(result.status).toBe('pass');
  expect(result.explanation).toContain('Measured 60% (149 of 250)');
});

test('metric-threshold fails below the bar and still prints the measurement', () => {
  const result = runCheck(
    metric({ metric: 'ci-recovery-rate', atLeastPercent: 50 }),
    { documents: [], metrics: metricsWindow() },
    DISCLAIMER,
  );
  expect(result).toMatchObject({ status: 'fail', points: 0 });
  expect(result.explanation).toBe(
    `Missing. Measured 25% (1 of 4) over the 30 days ending 2026-09-13, against a 50% bar. ${DISCLAIMER}`,
  );
});

test('a metric with no denominator fails rather than passing by vacuum', () => {
  const metrics = metricsWindow({ 'ci-success-rate': reading(0, 0) });
  const result = runCheck(
    metric({ metric: 'ci-success-rate', atLeastPercent: 90 }),
    { documents: [], metrics },
    DISCLAIMER,
  );
  expect(result.status).toBe('fail');
  expect(result.explanation).toBe(
    `Missing. Nothing measurable in the 30 days ending 2026-09-13. ${DISCLAIMER}`,
  );
});

test('a metric check with no window at all is a bug, not a repository state', () => {
  expect(() =>
    runCheck(
      metric({ metric: 'first-pass-rate', atLeastPercent: 60 }),
      { documents: [] },
      DISCLAIMER,
    ),
  ).toThrow(/metric evidence/i);
});
