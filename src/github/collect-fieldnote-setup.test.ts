import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  repositoryClient: vi.fn(),
  getCommit: vi.fn(),
  getTree: vi.fn(),
  getBlob: vi.fn(),
  loadDetectionsForWorker: vi.fn(),
}));

vi.mock('./repositories', () => ({ repositoryClient: mocks.repositoryClient }));
vi.mock('../db/queries/ai-involvement', () => ({
  loadDetectionsForWorker: mocks.loadDetectionsForWorker,
}));

import { collectFieldnoteSetup, FieldnoteSetupCollectionError } from './collect-fieldnote-setup';

const blob = (path: string, sha = path, size = 4) => ({
  path,
  sha,
  size,
  mode: '100644',
  type: 'blob',
});

const encoded = (text: string | Buffer) => {
  const bytes = Buffer.isBuffer(text) ? text : Buffer.from(text);
  return { data: { encoding: 'base64', content: bytes.toString('base64'), size: bytes.length } };
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.repositoryClient.mockResolvedValue({
    repo: { owner: 'owner', name: 'repo' },
    client: {
      rest: {
        git: {
          getCommit: mocks.getCommit,
          getTree: mocks.getTree,
          getBlob: mocks.getBlob,
        },
      },
    },
  });
  mocks.getCommit.mockResolvedValue({ data: { tree: { sha: 'tree-abc' } } });
  mocks.getTree.mockResolvedValue({ data: { truncated: false, tree: [blob('README.md')] } });
  mocks.getBlob.mockResolvedValue(encoded('text'));
  mocks.loadDetectionsForWorker.mockResolvedValue([]);
});

test('collects only setup evidence at the pinned commit and derives unconfirmed candidates', async () => {
  mocks.getTree.mockResolvedValue({
    data: {
      truncated: false,
      tree: [
        blob('AGENTS.md'),
        blob('.claude/settings.json'),
        blob('.fieldnote/skills.lock.json'),
        blob('.github/workflows/ci.yml'),
        blob('Dockerfile'),
        blob('package.json'),
        blob('docs/adr/001-decision.md'),
        blob('.github/PULL_REQUEST_TEMPLATE.md'),
        blob('src/index.ts'),
        blob('pnpm-lock.yaml'),
        blob('.env'),
        blob('docs/diagram.png'),
      ],
    },
  });
  mocks.loadDetectionsForWorker.mockResolvedValue([
    {
      agent: 'gemini',
      kind: 'coding-agent',
      signal: 'executed',
      firstSeenAt: null,
      lastSeenAt: null,
      occurrences: 1,
      evidence: [{ source: 'branch-prefix', value: 'gemini/setup', prCount: 1 }],
    },
  ]);

  const snapshot = await collectFieldnoteSetup('fixture-repo', 'abc');

  expect(snapshot.sha).toBe('abc');
  expect(snapshot.complete).toBe(true);
  expect(snapshot.paths).toEqual([
    '.claude/settings.json',
    '.fieldnote/skills.lock.json',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/workflows/ci.yml',
    'AGENTS.md',
    'Dockerfile',
    'docs/adr/001-decision.md',
    'package.json',
  ]);
  expect(snapshot.documents.map((document) => document.path)).toEqual(snapshot.paths);
  expect(snapshot.candidates).toContainEqual(
    expect.objectContaining({
      agent: 'claude-code',
      confirmed: false,
      evidence: expect.arrayContaining([{ source: 'path', value: '.claude/settings.json' }]),
    }),
  );
  expect(snapshot.candidates).toContainEqual(
    expect.objectContaining({
      agent: 'gemini',
      confirmed: false,
      evidence: [{ source: 'executed', value: 'gemini/setup' }],
    }),
  );
  expect(mocks.getCommit).toHaveBeenCalledWith(expect.objectContaining({ commit_sha: 'abc' }));
});

test('walks a truncated immutable tree breadth first', async () => {
  mocks.getTree
    .mockResolvedValueOnce({ data: { truncated: true, tree: [blob('partial.md')] } })
    .mockResolvedValueOnce({
      data: {
        truncated: false,
        tree: [{ path: 'docs', sha: 'docs-tree', mode: '040000', type: 'tree' }],
      },
    })
    .mockResolvedValueOnce({ data: { truncated: false, tree: [blob('adr/001.md')] } });

  await expect(collectFieldnoteSetup('fixture-repo', 'abc')).resolves.toMatchObject({
    complete: true,
    paths: ['docs/adr/001.md'],
  });
  expect(mocks.getTree.mock.calls.map(([input]) => input.tree_sha)).toEqual([
    'tree-abc',
    'tree-abc',
    'docs-tree',
  ]);
});

test('excludes symlinks, submodules, secrets, source, ordinary locks, and binary evidence', async () => {
  mocks.getTree.mockResolvedValue({
    data: {
      truncated: false,
      tree: [
        blob('README.md'),
        { ...blob('CLAUDE.md'), mode: '120000' },
        { ...blob('.agents/instructions.md'), mode: '160000', type: 'commit' },
        blob('.agents/tool.ts'),
        blob('.env.production'),
        blob('src/app.ts'),
        blob('package-lock.json'),
        blob('docs/logo.png'),
      ],
    },
  });

  await expect(collectFieldnoteSetup('fixture-repo', 'abc')).resolves.toMatchObject({
    complete: true,
    paths: ['README.md'],
    documents: [expect.objectContaining({ path: 'README.md' })],
  });
  expect(mocks.getBlob).toHaveBeenCalledTimes(1);
});

test('marks invalid UTF-8 and embedded-NUL relevant blobs incomplete without returning them', async () => {
  mocks.getTree.mockResolvedValue({
    data: { truncated: false, tree: [blob('README.md', 'utf8'), blob('AGENTS.md', 'nul')] },
  });
  mocks.getBlob.mockImplementation(async ({ file_sha }) =>
    encoded(file_sha === 'utf8' ? Buffer.from([0xff]) : Buffer.from('bad\0text')),
  );

  await expect(collectFieldnoteSetup('fixture-repo', 'abc')).resolves.toMatchObject({
    complete: false,
    documents: [],
  });
});

test('enforces tree-entry, document, per-file, and decoded-total bounds', async () => {
  mocks.getTree.mockResolvedValue({
    data: {
      truncated: false,
      tree: [
        ...Array.from({ length: 15_000 }, (_, index) => blob(`src/${index}.ts`)),
        blob('README.md', 'after-entry-cap'),
      ],
    },
  });
  await expect(collectFieldnoteSetup('fixture-repo', 'abc')).resolves.toMatchObject({
    complete: false,
  });

  mocks.getTree.mockResolvedValue({
    data: {
      truncated: false,
      tree: Array.from({ length: 401 }, (_, index) => blob(`docs/adr/${index}.md`)),
    },
  });
  await expect(collectFieldnoteSetup('fixture-repo', 'abc')).resolves.toMatchObject({
    complete: false,
    documents: Array.from({ length: 400 }, () => expect.anything()),
  });

  mocks.getTree.mockResolvedValue({
    data: { truncated: false, tree: [blob('README.md', 'large', 262_145)] },
  });
  await expect(collectFieldnoteSetup('fixture-repo', 'abc')).resolves.toMatchObject({
    complete: false,
    documents: [],
  });

  mocks.getTree.mockResolvedValue({
    data: {
      truncated: false,
      tree: Array.from({ length: 17 }, (_, index) => blob(`docs/adr/${index}.md`, `b${index}`)),
    },
  });
  mocks.getBlob.mockResolvedValue(encoded(Buffer.alloc(262_144, 65)));
  await expect(collectFieldnoteSetup('fixture-repo', 'abc')).resolves.toMatchObject({
    complete: false,
    documents: Array.from({ length: 16 }, () => expect.anything()),
  });
});

test('returns a sanitized provider failure', async () => {
  mocks.getCommit.mockRejectedValue({
    status: 500,
    message: 'repository secret',
    request: { token: 'secret' },
  });

  await expect(collectFieldnoteSetup('fixture-repo', 'abc')).rejects.toMatchObject({
    code: 'github_unavailable',
    retryable: true,
  });
  try {
    await collectFieldnoteSetup('fixture-repo', 'abc');
  } catch (error) {
    expect(error).toBeInstanceOf(FieldnoteSetupCollectionError);
    expect(JSON.stringify(error)).not.toContain('secret');
  }
});
