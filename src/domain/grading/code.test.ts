import { expect, test } from 'vitest';
import { parseManifest, type CodeManifest } from './manifest';
import { assembleCodeResult, codeGraderInput, GraderFailedError } from './code';

const draft = (over: Record<string, unknown> = {}) => ({
  id: 'fieldnote/code-fixture',
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'test-discipline',
  kind: 'code',
  needs: { 'repo.tree': ['**/*'] },
  code: { source: 'export default () => ({ checks: [] });' },
  insufficientReason: 'Too little here to judge.',
  disclaimer: 'Evidence, not certification.',
  card: { title: 'Fixture', tagline: 'Is it?', groups: [{ title: 'All', checks: ['a', 'b'] }] },
  checks: [
    { id: 'a', title: 'A', points: 60, explain: { pass: 'A holds.', fail: 'A does not hold.' } },
    { id: 'b', title: 'B', points: 40, explain: { pass: 'B holds.', fail: 'B does not hold.' } },
  ],
  ...over,
});
const manifest = parseManifest(draft()) as CodeManifest;
const snapshot = {
  sha: 'a'.repeat(40),
  complete: true,
  documents: [],
  tree: [
    { path: 'src/a.test.ts', size: 1 },
    { path: 'src/a.ts', size: 1 },
  ],
  metrics: null,
};
const input = codeGraderInput(manifest, snapshot);

const fails = (answer: unknown, target: CodeManifest = manifest) =>
  expect(() => assembleCodeResult(target, input, answer)).toThrow(GraderFailedError);

test('a program receives only the families its manifest declared, and nothing about whose repository it is', () => {
  expect(input).toEqual({ evidence: { tree: snapshot.tree } });
  expect(Object.keys(input)).toEqual(['evidence']);

  const files = parseManifest(draft({ needs: { 'repo.files': ['README.md'] } })) as CodeManifest;
  const documents = [{ path: 'README.md', blobSha: 'b1', text: 'hi' }];
  expect(codeGraderInput(files, { ...snapshot, documents })).toEqual({ evidence: { documents } });

  const both = parseManifest(
    draft({ needs: { 'repo.files': ['README.md'], 'repo.tree': ['**/*'] } }),
  ) as CodeManifest;
  expect(Object.keys(codeGraderInput(both, { ...snapshot, documents }).evidence).sort()).toEqual([
    'documents',
    'tree',
  ]);
});

test('a scored answer is assembled from the manifest prose, with points, paths and the count', () => {
  const { result, insufficient } = assembleCodeResult(manifest, input, {
    checks: [
      { id: 'a', status: 'pass', paths: ['src/a.test.ts'] },
      { id: 'b', status: 'pass', count: { matched: 3, of: 4 } },
    ],
  });
  expect(insufficient).toBe(false);
  expect(result).toEqual({
    score: 100,
    rubricVersion: '0.1.0',
    evaluatorVersion: '1.0.0',
    checks: [
      {
        id: 'a',
        points: 60,
        maxPoints: 60,
        status: 'pass',
        paths: ['src/a.test.ts'],
        lineRanges: [],
        explanation: 'A holds. Evidence, not certification.',
      },
      {
        id: 'b',
        points: 40,
        maxPoints: 40,
        status: 'pass',
        paths: [],
        lineRanges: [],
        explanation: 'B holds. Measured 3 of 4. Evidence, not certification.',
      },
    ],
  });
});

test('a failing check scores nothing and shows no paths, as a declarative check does', () => {
  const { result } = assembleCodeResult(manifest, input, {
    checks: [
      { id: 'a', status: 'fail', paths: ['src/a.ts'] },
      { id: 'b', status: 'pass' },
    ],
  });
  expect(result.score).toBe(40);
  expect(result.checks[0]).toMatchObject({ points: 0, paths: [], explanation: 'A does not hold. Evidence, not certification.' });
});

test('an insufficient answer keeps every check and carries the manifest sentence, with no score', () => {
  const { result, insufficient } = assembleCodeResult(manifest, input, {
    checks: [
      { id: 'a', status: 'pass' },
      { id: 'b', status: 'fail' },
    ],
    insufficient: true,
  });
  expect(insufficient).toBe(true);
  expect(result.score).toBeNull();
  expect(result.incompleteReason).toBe('Too little here to judge.');
  expect(result.checks).toHaveLength(2);
});

test('duplicate paths are listed once', () => {
  const { result } = assembleCodeResult(manifest, input, {
    checks: [
      { id: 'a', status: 'pass', paths: ['src/a.ts', 'src/a.ts'] },
      { id: 'b', status: 'pass' },
    ],
  });
  expect(result.checks[0].paths).toEqual(['src/a.ts']);
});

const both = [
  { id: 'a', status: 'pass' },
  { id: 'b', status: 'pass' },
];

test('an answer that is not an object fails', () => fails('nope'));
test('an answer with free text anywhere fails', () => {
  fails({ checks: both, explanation: '<script>alert(1)</script>' });
  fails({ checks: [{ ...both[0], explanation: 'mine' }, both[1]] });
  fails({ checks: [{ ...both[0], count: { matched: 1, of: 2, note: 'x' } }, both[1]] });
});
test('a check id the manifest does not declare fails, markup included', () => {
  fails({ checks: [...both, { id: '<b>c</b>', status: 'pass' }] });
});
test('a declared check left out fails', () => fails({ checks: [both[0]] }));
test('a check reported twice fails', () => fails({ checks: [...both, both[0]] }));
test('a status other than pass or fail fails', () => fails({ checks: [{ id: 'a', status: 'maybe' }, both[1]] }));
test('a path the program was not given fails', () =>
  fails({ checks: [{ id: 'a', status: 'pass', paths: ['../../etc/passwd'] }, both[1]] }));
test('more than twenty paths on a check fails', () =>
  fails({ checks: [{ id: 'a', status: 'pass', paths: Array(21).fill('src/a.ts') }, both[1]] }));
test('a count that is not whole, not positive or not ordered fails', () => {
  fails({ checks: [{ id: 'a', status: 'pass', count: { matched: 1.5, of: 2 } }, both[1]] });
  fails({ checks: [{ id: 'a', status: 'pass', count: { matched: -1, of: 2 } }, both[1]] });
  fails({ checks: [{ id: 'a', status: 'pass', count: { matched: 3, of: 2 } }, both[1]] });
});
test('insufficient from a grader with no sentence for it fails', () => {
  const silent = parseManifest(draft({ insufficientReason: undefined })) as CodeManifest;
  fails({ checks: both, insufficient: true }, silent);
});
test('insufficient: false is not part of the contract', () => fails({ checks: both, insufficient: false }));
