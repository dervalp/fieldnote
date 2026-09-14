import { expect, test } from 'vitest';
import { ManifestError } from './manifest';
import { getGrader, graderCheckTitles, registerGrader } from './registry';
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
  card: { tagline: 'Is anything written down?', groups: [{ title: 'Docs', checks: ['readme'] }] },
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

test('a registered grader is retrievable by id and publishes its check titles', () => {
  registerGrader(manifest());
  expect(getGrader('fieldnote/registry-fixture').card.tagline).toBe('Is anything written down?');
  expect(graderCheckTitles('fieldnote/registry-fixture')).toEqual({
    readme: 'Project documentation',
  });
});

test('kind: code is accepted by the schema and rejected at registration', () => {
  try {
    registerGrader(manifest({ id: 'fieldnote/code-fixture', kind: 'code' }));
  } catch (error) {
    expect(error).toBeInstanceOf(ManifestError);
    expect((error as ManifestError).code).toBe('kind_unsupported');
    expect((error as ManifestError).message).toMatch(/not yet supported/);
    return;
  }
  throw new Error('expected kind_unsupported');
});

test('an unknown grader id is a distinguishable error, not undefined', () => {
  expect(() => getGrader('someone/absent')).toThrow(ManifestError);
});

test('the rubric view is frozen and carries only the versioned check arithmetic', () => {
  registerGrader(manifest());
  const view = rubricView(getGrader('fieldnote/registry-fixture'));
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
  const registered = registerGrader(manifest());
  expect(manifestHash(registered)).toBe(manifestHash(JSON.parse(JSON.stringify(registered))));
  expect(manifestHash({ x: 1, y: 2 })).toBe(manifestHash({ y: 2, x: 1 }));
  expect(manifestHash(registered)).not.toBe(manifestHash({ ...registered, version: '0.2.0' }));
});

test('runDeclarative scores a complete snapshot and withholds a score from an incomplete one', () => {
  const grader = registerGrader(manifest());
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
  const grader = registerGrader(
    manifest({
      id: 'fieldnote/order-fixture',
      card: { tagline: 'Order', groups: [{ title: 'All', checks: ['readme', 'agents'] }] },
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
