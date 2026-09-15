import { expect, test } from 'vitest';
import { parseManifest } from './manifest';
import { runDeclarative } from './declarative';
import { rubricView } from './rubric-view';
import { manifestHash } from './manifest-hash';

const manifest = (over: Record<string, unknown> = {}) => ({
  id: 'fieldnote/registry-fixture',
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'documentation',
  kind: 'declarative',
  needs: { 'repo.files': ['README.md'] },
  disclaimer: 'Evidence, not certification.',
  card: {
    title: 'Example',
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
  ...over,
});

test('kind: code parses like any other grader', () => {
  const parsed = parseManifest({
    ...manifest({
      id: 'fieldnote/code-fixture',
      kind: 'code',
      code: { source: 'export default () => ({ checks: [] });' },
      needs: { 'repo.tree': ['**/*'] },
    }),
    checks: [
      {
        id: 'readme',
        title: 'Project documentation',
        points: 100,
        explain: { pass: 'Found a README.', fail: 'No README.' },
      },
    ],
  });
  expect(parsed.kind).toBe('code');
});

test('runDeclarative refuses a code manifest by kind', () => {
  const code = parseManifest({
    ...manifest({
      id: 'fieldnote/code-fixture',
      kind: 'code',
      code: { source: 'export default () => ({ checks: [] });' },
      needs: { 'repo.tree': ['**/*'] },
    }),
    checks: [
      {
        id: 'readme',
        title: 'Project documentation',
        points: 100,
        explain: { pass: 'Found a README.', fail: 'No README.' },
      },
    ],
  });
  expect(() => runDeclarative(code, { sha: 'abc', complete: true, documents: [] })).toThrow(
    'runDeclarative runs declarative graders only',
  );
});

test('the rubric view is frozen and carries only the versioned check arithmetic', () => {
  const registered = parseManifest(manifest());
  const view = rubricView(registered);
  expect(view).toEqual({
    graderId: 'fieldnote/registry-fixture',
    version: '0.1.0',
    evaluatorVersion: '1.0.0',
    checks: [{ id: 'readme', maxPoints: 100 }],
  });
  expect(Object.isFrozen(view)).toBe(true);
  expect(Object.isFrozen(view.checks)).toBe(true);
});

test('the manifest hash ignores key order and changes with content', () => {
  const registered = parseManifest(manifest());
  expect(manifestHash(registered)).toBe(manifestHash(JSON.parse(JSON.stringify(registered))));
  expect(manifestHash({ x: 1, y: 2 })).toBe(manifestHash({ y: 2, x: 1 }));
  expect(manifestHash(registered)).not.toBe(manifestHash({ ...registered, version: '0.2.0' }));
});

test('runDeclarative scores a complete snapshot and withholds a score from an incomplete one', () => {
  const grader = parseManifest(manifest());
  const documents = [{ path: 'README.md', blobSha: 'sha', text: '# Project' }];
  expect(runDeclarative(grader, { sha: 'c', complete: true, documents })).toMatchObject({
    score: 100,
    rubricVersion: '0.1.0',
    evaluatorVersion: '1.0.0',
  });
  const partial = runDeclarative(grader, { sha: 'c', complete: false, documents });
  expect(partial.score).toBeNull();
  expect(partial.incompleteReason).toBeDefined();
});

test('runDeclarative emits checks in manifest order over path-sorted documents', () => {
  const grader = parseManifest(
    manifest({
      id: 'fieldnote/order-fixture',
      card: {
        title: 'Order Test',
        tagline: 'Order',
        groups: [{ title: 'All', checks: ['readme', 'agents'] }],
      },
      checks: [
        {
          id: 'readme',
          title: 'R',
          points: 50,
          explain: { pass: 'p', fail: 'f' },
          primitive: 'file-exists',
          args: { root: true, nonempty: true, anyOf: ['README.md'] },
        },
        {
          id: 'agents',
          title: 'A',
          points: 50,
          explain: { pass: 'p', fail: 'f' },
          primitive: 'file-exists',
          args: { root: true, nonempty: true, anyOf: ['AGENTS.md', 'CLAUDE.md'] },
        },
      ],
    }),
  );
  const result = runDeclarative(grader, {
    sha: 'c',
    complete: true,
    documents: [
      { path: 'CLAUDE.md', blobSha: 'c', text: 'c' },
      { path: 'AGENTS.md', blobSha: 'a', text: 'a' },
      { path: 'README.md', blobSha: 'r', text: 'r' },
    ],
  });
  expect(result.checks.map((entry) => entry.id)).toEqual(['readme', 'agents']);
  expect(result.checks[1].paths).toEqual(['AGENTS.md', 'CLAUDE.md']);
});
