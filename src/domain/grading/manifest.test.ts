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
