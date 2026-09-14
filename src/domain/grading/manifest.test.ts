import { expect, test } from 'vitest';
import { ManifestError, parseManifest } from './manifest';

type Draft = Record<string, unknown>;

const valid = (): Draft => ({
  id: 'fieldnote/example',
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
    groups: [{ title: 'Docs', checks: ['a', 'b'] }],
  },
  checks: [
    {
      id: 'a',
      title: 'A',
      points: 60,
      explain: { pass: 'Found it.', fail: 'Did not find it.' },
      primitive: 'file-exists',
      args: { root: true, nonempty: true, anyOf: ['README.md'] },
    },
    {
      id: 'b',
      title: 'B',
      points: 40,
      explain: { pass: 'Found it.', fail: 'Did not find it.' },
      primitive: 'glob-count',
      args: { pattern: 'docs/**/*.md', nonempty: true, min: 1 },
    },
  ],
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rejects = (mutate: (manifest: any) => void, code: string) => {
  const manifest = valid();
  mutate(manifest);
  try {
    parseManifest(manifest);
  } catch (error) {
    expect(error).toBeInstanceOf(ManifestError);
    expect((error as ManifestError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
};

test('a well-formed manifest parses', () => {
  const manifest = parseManifest(valid());
  expect(manifest.id).toBe('fieldnote/example');
  expect(manifest.checks).toHaveLength(2);
});

test('points that do not total 100 are rejected', () => {
  rejects((m) => void (m.checks[0].points = 59), 'points_not_100');
});

test('a duplicate check id is rejected', () => {
  rejects((m) => {
    m.checks[1].id = 'a';
    m.card.groups[0].checks = ['a', 'a'];
  }, 'duplicate_check_id');
});

test('a check absent from card.groups is rejected', () => {
  rejects((m) => void (m.card.groups[0].checks = ['a']), 'check_not_grouped');
});

test('a check named twice in card.groups is rejected', () => {
  rejects((m) => void m.card.groups.push({ title: 'Again', checks: ['a'] }), 'check_grouped_twice');
});

test('a group naming an unknown check is rejected', () => {
  rejects((m) => void m.card.groups[0].checks.push('c'), 'unknown_check_grouped');
});

test('an unknown subject is accepted by the schema and rejected by the invariants', () => {
  rejects((m) => void (m.subject = 'pull_request'), 'subject_unsupported');
});

test('kind: code parses — it is rejected at registration, not here', () => {
  const manifest = valid();
  manifest.kind = 'code';
  expect(parseManifest(manifest).kind).toBe('code');
});

test('an unknown category, an unknown primitive and a missing field are schema errors', () => {
  rejects((m) => void (m.category = 'vibes'), 'schema');
  rejects((m) => void (m.checks[0].primitive = 'file-vibes'), 'schema');
  rejects((m) => void delete m.card, 'schema');
  rejects((m) => void (m.card.tagline = ''), 'schema');
});

test('heading-has-fence scope entries carry their own case sensitivity', () => {
  const manifest = valid();
  (manifest.checks as Draft[])[1] = {
    id: 'b',
    title: 'B',
    points: 40,
    explain: { pass: 'Found it.', fail: 'Did not find it.' },
    primitive: 'heading-has-fence',
    args: {
      headings: ['setup'],
      scope: [{ pattern: 'README.md', caseInsensitive: true }, { pattern: 'AGENTS.md' }],
    },
  };
  const parsed = parseManifest(manifest);
  expect(parsed.checks[1].primitive).toBe('heading-has-fence');
  expect(parsed.checks[1].args).toMatchObject({
    scope: [
      { pattern: 'README.md', caseInsensitive: true },
      { pattern: 'AGENTS.md', caseInsensitive: false },
    ],
  });
});

const metricsValid = (): Draft => ({
  ...valid(),
  needs: {
    'fieldnote.metrics': {
      windowDays: 30,
      minMergedPullRequests: 10,
      insufficientReason: 'Not enough merged work to judge.',
    },
  },
  checks: [
    {
      id: 'a',
      title: 'A',
      points: 60,
      explain: { pass: 'Clean.', fail: 'Not clean.' },
      primitive: 'metric-threshold',
      args: { metric: 'first-pass-rate', atLeastPercent: 60 },
    },
    {
      id: 'b',
      title: 'B',
      points: 40,
      explain: { pass: 'Green.', fail: 'Red.' },
      primitive: 'metric-threshold',
      args: { metric: 'ci-success-rate', atLeastPercent: 90 },
    },
  ],
});

test('a metrics manifest parses and keeps its window', () => {
  const manifest = parseManifest(metricsValid());
  expect(manifest.needs['fieldnote.metrics']).toMatchObject({
    windowDays: 30,
    minMergedPullRequests: 10,
  });
  expect(manifest.checks[0].primitive).toBe('metric-threshold');
});

test('a manifest declaring no evidence family at all is rejected', () => {
  rejects((m) => void (m.needs = {}), 'needs_empty');
});

test('a metric check without fieldnote.metrics is rejected', () => {
  const manifest = metricsValid();
  (manifest as Draft).needs = { 'repo.files': ['README.md'] };
  try {
    parseManifest(manifest);
  } catch (error) {
    expect((error as ManifestError).code).toBe('needs_mismatch');
    return;
  }
  throw new Error('expected needs_mismatch');
});

test('a file check without repo.files is rejected', () => {
  rejects(
    (m) =>
      void (m.needs = {
        'fieldnote.metrics': {
          windowDays: 30,
          minMergedPullRequests: 10,
          insufficientReason: 'Not enough.',
        },
      }),
    'needs_mismatch',
  );
});

test('a family no check uses is rejected — it would ask for evidence nobody reads', () => {
  rejects(
    (m) =>
      void (m.needs['fieldnote.metrics'] = {
        windowDays: 30,
        minMergedPullRequests: 10,
        insufficientReason: 'Not enough.',
      }),
    'needs_mismatch',
  );
});

test('a window that is not one of the product presets is a schema error', () => {
  const manifest = metricsValid();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (manifest as any).needs['fieldnote.metrics'].windowDays = 45;
  try {
    parseManifest(manifest);
  } catch (error) {
    expect((error as ManifestError).code).toBe('schema');
    return;
  }
  throw new Error('expected schema');
});

test('a bar outside 0-100 and a missing card title are schema errors', () => {
  rejects((m) => void delete m.card.title, 'schema');
  const manifest = metricsValid();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (manifest as any).checks[0].args.atLeastPercent = 101;
  try {
    parseManifest(manifest);
  } catch (error) {
    expect((error as ManifestError).code).toBe('schema');
    return;
  }
  throw new Error('expected schema');
});

test('more than twenty repo.files patterns is needs_too_broad', () => {
  rejects(
    (m) =>
      void (m.needs['repo.files'] = Array.from({ length: 21 }, (_u, i) => `dir-${i}/**/*.md`)),
    'needs_too_broad',
  );
});

test('exactly twenty repo.files patterns is accepted', () => {
  const manifest = valid();
  manifest.needs = {
    'repo.files': Array.from({ length: 20 }, (_u, i) => `dir-${i}/**/*.md`),
  };
  expect(() => parseManifest(manifest)).not.toThrow();
});
