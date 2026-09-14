import { expect, test } from 'vitest';
import { runCheck } from './primitives';
import type { GraderCheck } from './manifest';
import type { SourceDocument } from './types';

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
  const result = runCheck(fileExists(args), documents, DISCLAIMER);
  expect(result).toMatchObject({ status: 'pass', points: 100, paths: ['AGENTS.md'] });
  expect(result.lineRanges).toEqual([
    { path: 'AGENTS.md', blobSha: 'AGENTS.md-sha', start: 2, end: 2 },
  ]);
  expect(result.explanation).toBe(`Found it. ${DISCLAIMER}`);
});

test('file-exists with nonempty rejects a blank file and explains the failure', () => {
  const args = { root: true, nonempty: true, anyOf: ['AGENTS.md'], caseInsensitive: false };
  const result = runCheck(fileExists(args), [doc('AGENTS.md', ' \n\t')], DISCLAIMER);
  expect(result).toMatchObject({ status: 'fail', points: 0, paths: [], lineRanges: [] });
  expect(result.explanation).toBe(`Missing. ${DISCLAIMER}`);
});

test('file-exists honours caseInsensitive', () => {
  const args = { root: true, nonempty: true, anyOf: ['README.md'], caseInsensitive: true };
  expect(runCheck(fileExists(args), [doc('readME.MD', '# Project')], DISCLAIMER).paths).toEqual([
    'readME.MD',
  ]);
});

test('glob-count counts matching nonempty documents against min', () => {
  const counted = check({
    primitive: 'glob-count',
    args: { pattern: 'docs/**/*.{md,markdown}', caseInsensitive: true, nonempty: true, min: 2 },
  });
  const one = [doc('DOCS/a.MARKDOWN', 'A'), doc('docs/empty.md', '  '), doc('docs/n.txt', 'no')];
  expect(runCheck(counted, one, DISCLAIMER).status).toBe('fail');
  const result = runCheck(counted, [...one, doc('docs/b.md', 'B')], DISCLAIMER);
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
  const result = runCheck(scoped, [doc('AGENTS.md', body), doc('README.md', body)], DISCLAIMER);
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
    [doc('README.md', ['## Setup', '```', 'x', '```'].join('\n'))],
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
    const result = runCheck(subject, generated, DISCLAIMER);
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
