import { Octokit } from 'octokit';
import { runDeclarative } from '../domain/grading/declarative';
import { agentReadinessManifest } from '../domain/grading/graders/agent-readiness';
import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  repositoryClient: vi.fn(),
  get: vi.fn(),
  resolveCommit: vi.fn(),
  getCommit: vi.fn(),
  getTree: vi.fn(),
  getBlob: vi.fn(),
}));
vi.mock('./repositories', () => ({ repositoryClient: mocks.repositoryClient }));
import { collectFiles, collectTree, resolveHeadSha, FileCollectionError } from './collect-files';
const READINESS_GLOBS = agentReadinessManifest.needs['repo.files']!;
const blob = (path = 'README.md', sha = 'b1', size = 4) => ({
  path,
  sha,
  size,
  mode: '100644',
  type: 'blob',
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.repositoryClient.mockResolvedValue({
    repo: { owner: 'owner', name: 'repo' },
    client: {
      rest: {
        repos: { get: mocks.get, getCommit: mocks.resolveCommit },
        git: { getCommit: mocks.getCommit, getTree: mocks.getTree, getBlob: mocks.getBlob },
      },
    },
  });
  mocks.get.mockResolvedValue({ data: { default_branch: 'main' } });
  mocks.resolveCommit.mockResolvedValue({ data: { sha: 'abc' } });
  mocks.getCommit.mockResolvedValue({ data: { sha: 'abc', tree: { sha: 'tree-abc' } } });
  mocks.getTree.mockResolvedValue({ data: { truncated: false, tree: [blob()] } });
  mocks.getBlob.mockResolvedValue({
    data: { encoding: 'base64', content: Buffer.from('text').toString('base64'), size: 4 },
  });
});
test('all blob requests use the resolved commit tree', async () => {
  const snapshot = await collectFiles('fixture-repo', 'abc', READINESS_GLOBS);
  expect(snapshot).toEqual({
    sha: 'abc',
    complete: true,
    documents: [{ path: 'README.md', blobSha: 'b1', text: 'text' }],
  });
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.getCommit).toHaveBeenCalledWith(expect.objectContaining({ commit_sha: 'abc' }));
  expect(mocks.getTree).toHaveBeenCalledWith(expect.objectContaining({ tree_sha: 'tree-abc' }));
  expect(mocks.getBlob).toHaveBeenCalledWith(expect.objectContaining({ file_sha: 'b1' }));
});
test('resolves once then stays pinned when default branch moves', async () => {
  mocks.getCommit.mockImplementation(async ({ commit_sha }) => ({
    data: { sha: commit_sha === 'main' ? 'abc' : commit_sha, tree: { sha: `tree-${commit_sha}` } },
  }));
  expect(await resolveHeadSha('fixture-repo')).toBe('abc');
  mocks.getCommit.mockClear();
  const snapshot = await collectFiles('fixture-repo', 'abc', READINESS_GLOBS);
  expect(snapshot.sha).toBe('abc');
  expect(mocks.getCommit).toHaveBeenCalledTimes(1);
  expect(mocks.getCommit).toHaveBeenCalledWith(expect.objectContaining({ commit_sha: 'abc' }));
});
test('downloads nested rubric docs only and skips symlinks and gitlinks', async () => {
  mocks.getTree.mockResolvedValue({
    data: {
      truncated: false,
      tree: [
        blob('rEaDmE.md'),
        blob('AGENTS.md'),
        blob('CLAUDE.md'),
        blob('docs/nested/setup.md'),
        blob('src/index.ts'),
        blob('docs/image.png'),
        { ...blob('docs/link.md'), mode: '120000' },
        { ...blob('docs/module.md'), mode: '160000', type: 'commit' },
      ],
    },
  });
  expect(
    (await collectFiles('fixture-repo', 'abc', READINESS_GLOBS)).documents.map((d) => d.path),
  ).toEqual(['rEaDmE.md', 'AGENTS.md', 'CLAUDE.md', 'docs/nested/setup.md']);
  expect(mocks.getBlob).toHaveBeenCalledTimes(4);
});
test('walks truncated trees breadth first with path prefixes', async () => {
  mocks.getTree
    .mockResolvedValueOnce({ data: { truncated: true, tree: [blob('partial.md')] } })
    .mockResolvedValueOnce({
      data: {
        truncated: false,
        tree: [{ path: 'docs', sha: 'subtree', mode: '040000', type: 'tree' }],
      },
    })
    .mockResolvedValueOnce({ data: { truncated: false, tree: [blob('setup.md')] } });
  expect(await collectFiles('fixture-repo', 'abc', READINESS_GLOBS)).toMatchObject({
    complete: true,
    documents: [{ path: 'docs/setup.md' }],
  });
  expect(mocks.getTree.mock.calls.map(([p]) => p.tree_sha)).toEqual([
    'tree-abc',
    'tree-abc',
    'subtree',
  ]);
});
test('nonrecursive truncation is incomplete', async () => {
  mocks.getTree.mockResolvedValue({ data: { truncated: true, tree: [] } });
  expect((await collectFiles('fixture-repo', 'abc', READINESS_GLOBS)).complete).toBe(false);
});
test('confirmed absence of README is complete', async () => {
  mocks.getTree.mockResolvedValue({ data: { truncated: false, tree: [blob('src/index.ts')] } });
  expect(await collectFiles('fixture-repo', 'abc', READINESS_GLOBS)).toEqual({
    sha: 'abc',
    complete: true,
    documents: [],
  });
  expect(mocks.getBlob).not.toHaveBeenCalled();
});
test('oversize relevant files are incomplete without downloading', async () => {
  mocks.getTree.mockResolvedValue({
    data: { truncated: false, tree: [blob('README.md', 'b1', 131073)] },
  });
  expect((await collectFiles('fixture-repo', 'abc', READINESS_GLOBS)).complete).toBe(false);
  expect(mocks.getBlob).not.toHaveBeenCalled();
});
test.each([Buffer.from([0xff]), Buffer.from('binary\0data'), Buffer.alloc(131073, 65)])(
  'rejects invalid UTF8, binary and understated oversized blobs',
  async (bytes) => {
    mocks.getBlob.mockResolvedValue({
      data: { encoding: 'base64', size: 4, content: bytes.toString('base64') },
    });
    expect(await collectFiles('fixture-repo', 'abc', READINESS_GLOBS)).toMatchObject({
      complete: false,
      documents: [],
    });
  },
);
test('caps selected documents', async () => {
  mocks.getTree.mockResolvedValue({
    data: {
      truncated: false,
      tree: Array.from({ length: 201 }, (_, i) => blob(`docs/${i}.md`, `b${i}`)),
    },
  });
  const snapshot = await collectFiles('fixture-repo', 'abc', READINESS_GLOBS);
  expect(snapshot.complete).toBe(false);
  expect(snapshot.documents).toHaveLength(200);
});
test('caps tree entries', async () => {
  mocks.getTree.mockResolvedValue({
    data: { truncated: false, tree: Array.from({ length: 10001 }, () => blob('unrelated.ts')) },
  });
  expect((await collectFiles('fixture-repo', 'abc', READINESS_GLOBS)).complete).toBe(false);
});
test.each([
  [403, true, 'github_unavailable'],
  [429, true, 'github_unavailable'],
  [500, true, 'github_unavailable'],
  [401, false, 'installation_unavailable'],
  [404, false, 'repository_unavailable'],
  [409, false, 'empty_repository'],
])('safe failure for status %i', async (status, retryable, code) => {
  mocks.getCommit.mockRejectedValue({
    status,
    message: 'secret raw content',
    request: { token: 'secret' },
  });
  await expect(collectFiles('fixture-repo', 'abc', READINESS_GLOBS)).rejects.toMatchObject({
    code,
    retryable,
  });
  try {
    await collectFiles('fixture-repo', 'abc', READINESS_GLOBS);
  } catch (error) {
    expect(error).toBeInstanceOf(FileCollectionError);
    expect(JSON.stringify(error)).not.toContain('secret');
  }
});
test('inactive or revoked installation produces safe terminal error', async () => {
  mocks.repositoryClient.mockRejectedValue(new Error('Repository unavailable: private-id'));
  await expect(collectFiles('fixture-repo', 'abc', READINESS_GLOBS)).rejects.toMatchObject({
    code: 'repository_unavailable',
    retryable: false,
  });
});
test('blob concurrency is at most four and every request has a timeout', async () => {
  mocks.getTree.mockResolvedValue({
    data: { truncated: false, tree: Array.from({ length: 9 }, (_, i) => blob(`docs/${i}.md`)) },
  });
  let active = 0;
  let peak = 0;
  mocks.getBlob.mockImplementation(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return { data: { size: 4, encoding: 'base64', content: 'dGV4dA==' } };
  });
  await collectFiles('fixture-repo', 'abc', READINESS_GLOBS);
  expect(peak).toBe(4);
  for (const mock of [mocks.getCommit, mocks.getTree, mocks.getBlob])
    for (const [p] of mock.mock.calls) expect(p.request.signal).toBeInstanceOf(AbortSignal);
  const signals = [mocks.getCommit, mocks.getTree, mocks.getBlob].flatMap((mock) =>
    mock.mock.calls.map(([p]) => p.request.signal),
  );
  expect(new Set(signals).size).toBe(signals.length);
});
test('actual aggregate bytes cap marks incomplete', async () => {
  mocks.getTree.mockResolvedValue({
    data: { truncated: false, tree: Array.from({ length: 17 }, (_, i) => blob(`docs/${i}.md`)) },
  });
  mocks.getBlob.mockResolvedValue({
    data: { encoding: 'base64', size: 4, content: Buffer.alloc(131072, 65).toString('base64') },
  });
  const result = await collectFiles('fixture-repo', 'abc', READINESS_GLOBS);
  expect(result.complete).toBe(false);
  expect(result.documents).toHaveLength(16);
});
test('explicit installation permission denial is terminal', async () => {
  mocks.getTree.mockRejectedValue({
    status: 403,
    message: 'Resource not accessible by integration',
  });
  await expect(collectFiles('fixture-repo', 'abc', READINESS_GLOBS)).rejects.toMatchObject({
    code: 'installation_unavailable',
    retryable: false,
  });
});
test('unknown blob size is incomplete', async () => {
  mocks.getBlob.mockResolvedValue({
    data: { encoding: 'base64', size: null, content: 'dGV4dA==' },
  });
  expect(await collectFiles('fixture-repo', 'abc', READINESS_GLOBS)).toMatchObject({
    complete: false,
    documents: [],
  });
});
test('truncated subtree traversal is bounded by total entries', async () => {
  mocks.getTree.mockResolvedValueOnce({ data: { truncated: true, tree: [] } }).mockResolvedValue({
    data: {
      truncated: false,
      tree: Array.from({ length: 10000 }, (_, i) => ({
        path: `dir${i}`,
        sha: `tree${i}`,
        type: 'tree',
        mode: '040000',
      })),
    },
  });
  expect((await collectFiles('fixture-repo', 'abc', READINESS_GLOBS)).complete).toBe(false);
  expect(mocks.getTree).toHaveBeenCalledTimes(2);
});
test('does not fetch README formats outside the Markdown rubric', async () => {
  mocks.getTree.mockResolvedValue({
    data: { truncated: false, tree: [blob('README.png'), blob('README.txt')] },
  });
  expect(await collectFiles('fixture-repo', 'abc', READINESS_GLOBS)).toMatchObject({
    complete: true,
    documents: [],
  });
  expect(mocks.getBlob).not.toHaveBeenCalled();
});

test('decorated Octokit integration denial remains a safe terminal error', async () => {
  mocks.getTree.mockRejectedValue({
    status: 403,
    message: 'Resource not accessible by integration - https://docs.github.com/private-info',
    response: {
      data: {
        message: 'Resource not accessible by integration',
        documentation_url: 'https://docs.github.com/private-info',
      },
    },
  });
  await expect(collectFiles('fixture-repo', 'abc', READINESS_GLOBS)).rejects.toMatchObject({
    code: 'installation_unavailable',
    retryable: false,
    message: 'GitHub installation access is unavailable.',
  });
});
test('deadline aborts the installed Octokit fetch transport', async () => {
  vi.useFakeTimers();
  try {
    let transportSignal: AbortSignal | undefined;
    const fetch = vi.fn(
      (_url: unknown, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          transportSignal = options?.signal ?? undefined;
          transportSignal?.addEventListener('abort', () => reject(transportSignal?.reason), {
            once: true,
          });
        }),
    );
    const client = new Octokit({
      request: { fetch },
      retry: { enabled: false },
      throttle: { enabled: false },
    });
    mocks.repositoryClient.mockResolvedValue({ repo: { owner: 'owner', name: 'repo' }, client });
    const pending = expect(
      collectFiles('fixture-repo', 'abc', READINESS_GLOBS),
    ).rejects.toMatchObject({
      retryable: true,
      code: 'collection_failed',
    });
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(transportSignal?.aborted).toBe(true);
    await pending;
  } finally {
    vi.useRealTimers();
  }
});
test('deadline bounds a stalled authentication hook before fetch', async () => {
  vi.useFakeTimers();
  try {
    const fetch = vi.fn();
    const client = new Octokit({
      request: { fetch },
      retry: { enabled: false },
      throttle: { enabled: false },
    });
    client.hook.wrap('request', () => new Promise(() => {}));
    mocks.repositoryClient.mockResolvedValue({ repo: { owner: 'owner', name: 'repo' }, client });
    const pending = expect(
      collectFiles('fixture-repo', 'abc', READINESS_GLOBS),
    ).rejects.toMatchObject({
      retryable: true,
      code: 'collection_failed',
    });
    await vi.advanceTimersByTimeAsync(30000);
    await pending;
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
test('deadline also bounds installation client acquisition', async () => {
  vi.useFakeTimers();
  try {
    mocks.repositoryClient.mockImplementation(() => new Promise(() => {}));
    const pending = expect(resolveHeadSha('fixture-repo')).rejects.toMatchObject({
      retryable: true,
      code: 'collection_failed',
    });
    await vi.advanceTimersByTimeAsync(30000);
    await pending;
    expect(mocks.get).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
test.each(['docs/architecture.MD', 'docs/setup.markdown', 'Docs/nested/setup.MARKDOWN'])(
  'collected %s receives the grader documentation points',
  async (path) => {
    mocks.getTree.mockResolvedValue({ data: { truncated: false, tree: [blob(path)] } });
    const snapshot = await collectFiles('fixture-repo', 'abc', READINESS_GLOBS);
    expect(snapshot.complete).toBe(true);
    expect(snapshot.documents).toEqual([{ path, blobSha: 'b1', text: 'text' }]);
    const grade = runDeclarative(agentReadinessManifest, snapshot);
    expect(grade.checks.find((check) => check.id === 'docs-markdown')).toMatchObject({
      status: 'pass',
      points: 20,
      paths: [path],
    });
  },
);
test('collects the files a manifest declared and nothing else', async () => {
  mocks.getTree.mockResolvedValue({
    data: {
      truncated: false,
      tree: [blob('README.md', 'b1'), blob('src/index.ts', 'b2'), blob('src/deep/a.ts', 'b3')],
    },
  });
  const snapshot = await collectFiles('fixture-repo', 'abc', ['src/**/*.ts']);
  expect(snapshot.documents.map((d) => d.path)).toEqual(['src/index.ts', 'src/deep/a.ts']);
});
test('the readiness globs reproduce the hardcoded predicate, case variants included', async () => {
  mocks.getTree.mockResolvedValue({
    data: {
      truncated: false,
      tree: [
        blob('README.md', 'b1'),
        blob('readme.md', 'b2'),
        blob('AGENTS.md', 'b3'),
        blob('CLAUDE.md', 'b4'),
        blob('docs/guide.md', 'b5'),
        blob('docs/deep/nested.markdown', 'b6'),
        blob('Docs/case.md', 'b7'),
        blob('src/index.ts', 'b8'),
        blob('package.json', 'b9'),
      ],
    },
  });
  const snapshot = await collectFiles('fixture-repo', 'abc', READINESS_GLOBS);
  expect(snapshot.documents.map((d) => d.path)).toEqual([
    'README.md',
    'readme.md',
    'AGENTS.md',
    'CLAUDE.md',
    'docs/guide.md',
    'docs/deep/nested.markdown',
    'Docs/case.md',
  ]);
});
test('an empty pattern list collects nothing and stays complete', async () => {
  mocks.getTree.mockResolvedValue({
    data: { truncated: false, tree: [blob('README.md', 'b1')] },
  });
  expect(await collectFiles('fixture-repo', 'abc', [])).toEqual({
    sha: 'abc',
    complete: true,
    documents: [],
  });
});
test('a tree over the document cap reports an incomplete snapshot', async () => {
  mocks.getTree.mockResolvedValue({
    data: {
      truncated: false,
      tree: Array.from({ length: 201 }, (_unused, index) =>
        blob(`docs/file-${index}.md`, `b${index}`),
      ),
    },
  });
  const snapshot = await collectFiles('fixture-repo', 'abc', READINESS_GLOBS);
  expect(snapshot.complete).toBe(false);
  expect(snapshot.documents).toHaveLength(200);
});

test('collectTree lists matching blob paths and sizes, sorted, and never fetches a blob', async () => {
  mocks.getTree.mockResolvedValue({
    data: {
      truncated: false,
      tree: [
        blob('src/b.ts', 'b2', 10),
        blob('README.md', 'b1', 4),
        { path: 'src', type: 'tree', sha: 't1', mode: '040000' },
        { ...blob('link.md'), mode: '120000' },
        { ...blob('vendor/module'), mode: '160000', type: 'commit' },
      ],
    },
  });
  const snapshot = await collectTree('fixture-repo', 'abc', ['**/*']);
  expect(snapshot).toEqual({
    sha: 'abc',
    complete: true,
    tree: [
      { path: 'README.md', size: 4 },
      { path: 'src/b.ts', size: 10 },
    ],
  });
  expect(mocks.getBlob).not.toHaveBeenCalled();
  expect(mocks.getCommit).toHaveBeenCalledWith(expect.objectContaining({ commit_sha: 'abc' }));
});

test('collectTree keeps only paths the declared globs match', async () => {
  mocks.getTree.mockResolvedValue({
    data: { truncated: false, tree: [blob('src/b.ts', 'b2', 10), blob('README.md', 'b1', 4)] },
  });
  const snapshot = await collectTree('fixture-repo', 'abc', ['src/**']);
  expect(snapshot.tree).toEqual([{ path: 'src/b.ts', size: 10 }]);
});

test('collectTree is incomplete past the tree entry cap', async () => {
  mocks.getTree.mockResolvedValue({
    data: {
      truncated: false,
      tree: Array.from({ length: 10_001 }, (_, i) => blob(`f${i}.ts`, `s${i}`, 1)),
    },
  });
  const snapshot = await collectTree('fixture-repo', 'abc', ['**/*']);
  expect(snapshot.complete).toBe(false);
});

test('collectTree walks a truncated recursive tree breadth first', async () => {
  mocks.getTree.mockImplementation(async ({ tree_sha, recursive }) => {
    if (recursive) return { data: { truncated: true, tree: [blob('partial.ts')] } };
    if (tree_sha === 'tree-abc')
      return {
        data: {
          truncated: false,
          tree: [blob('README.md', 'b1', 4), { path: 'src', type: 'tree', sha: 't-src', mode: '040000' }],
        },
      };
    return { data: { truncated: false, tree: [blob('a.ts', 'b3', 7)] } };
  });
  const snapshot = await collectTree('fixture-repo', 'abc', ['**/*']);
  expect(snapshot).toEqual({
    sha: 'abc',
    complete: true,
    tree: [
      { path: 'README.md', size: 4 },
      { path: 'src/a.ts', size: 7 },
    ],
  });
});

test('collectTree maps provider failures the way collectFiles does', async () => {
  mocks.getCommit.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
  await expect(collectTree('fixture-repo', 'abc', ['**/*'])).rejects.toMatchObject({
    code: 'repository_unavailable',
  });
});
