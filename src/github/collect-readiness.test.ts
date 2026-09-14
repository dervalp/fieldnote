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
import {
  collectReadiness,
  resolveReadinessSha,
  ReadinessCollectionError,
} from './collect-readiness';
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
  const snapshot = await collectReadiness('fixture-repo', 'abc');
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
  expect(await resolveReadinessSha('fixture-repo')).toBe('abc');
  mocks.getCommit.mockClear();
  const snapshot = await collectReadiness('fixture-repo', 'abc');
  expect(snapshot.sha).toBe('abc');
  expect(mocks.getCommit).toHaveBeenCalledTimes(1);
  expect(mocks.getCommit).toHaveBeenCalledWith(expect.objectContaining({ commit_sha: 'abc' }));
});
test('omitted SHA resolves the default branch once', async () => {
  expect((await collectReadiness('fixture-repo')).sha).toBe('abc');
  expect(mocks.get).toHaveBeenCalledTimes(1);
  expect(mocks.getCommit.mock.calls.map(([p]) => p.commit_sha)).toEqual(['abc']);
  expect(mocks.resolveCommit).toHaveBeenCalledTimes(1);
  expect(mocks.resolveCommit).toHaveBeenCalledWith(expect.objectContaining({ ref: 'main' }));
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
  expect((await collectReadiness('fixture-repo', 'abc')).documents.map((d) => d.path)).toEqual([
    'rEaDmE.md',
    'AGENTS.md',
    'CLAUDE.md',
    'docs/nested/setup.md',
  ]);
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
  expect(await collectReadiness('fixture-repo', 'abc')).toMatchObject({
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
  expect((await collectReadiness('fixture-repo', 'abc')).complete).toBe(false);
});
test('confirmed absence of README is complete', async () => {
  mocks.getTree.mockResolvedValue({ data: { truncated: false, tree: [blob('src/index.ts')] } });
  expect(await collectReadiness('fixture-repo', 'abc')).toEqual({
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
  expect((await collectReadiness('fixture-repo', 'abc')).complete).toBe(false);
  expect(mocks.getBlob).not.toHaveBeenCalled();
});
test.each([Buffer.from([0xff]), Buffer.from('binary\0data'), Buffer.alloc(131073, 65)])(
  'rejects invalid UTF8, binary and understated oversized blobs',
  async (bytes) => {
    mocks.getBlob.mockResolvedValue({
      data: { encoding: 'base64', size: 4, content: bytes.toString('base64') },
    });
    expect(await collectReadiness('fixture-repo', 'abc')).toMatchObject({
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
  const snapshot = await collectReadiness('fixture-repo', 'abc');
  expect(snapshot.complete).toBe(false);
  expect(snapshot.documents).toHaveLength(200);
});
test('caps tree entries', async () => {
  mocks.getTree.mockResolvedValue({
    data: { truncated: false, tree: Array.from({ length: 10001 }, () => blob('unrelated.ts')) },
  });
  expect((await collectReadiness('fixture-repo', 'abc')).complete).toBe(false);
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
  await expect(collectReadiness('fixture-repo', 'abc')).rejects.toMatchObject({ code, retryable });
  try {
    await collectReadiness('fixture-repo', 'abc');
  } catch (error) {
    expect(error).toBeInstanceOf(ReadinessCollectionError);
    expect(JSON.stringify(error)).not.toContain('secret');
  }
});
test('inactive or revoked installation produces safe terminal error', async () => {
  mocks.repositoryClient.mockRejectedValue(new Error('Repository unavailable: private-id'));
  await expect(collectReadiness('fixture-repo', 'abc')).rejects.toMatchObject({
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
  await collectReadiness('fixture-repo', 'abc');
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
  const result = await collectReadiness('fixture-repo', 'abc');
  expect(result.complete).toBe(false);
  expect(result.documents).toHaveLength(16);
});
test('explicit installation permission denial is terminal', async () => {
  mocks.getTree.mockRejectedValue({
    status: 403,
    message: 'Resource not accessible by integration',
  });
  await expect(collectReadiness('fixture-repo', 'abc')).rejects.toMatchObject({
    code: 'installation_unavailable',
    retryable: false,
  });
});
test('unknown blob size is incomplete', async () => {
  mocks.getBlob.mockResolvedValue({
    data: { encoding: 'base64', size: null, content: 'dGV4dA==' },
  });
  expect(await collectReadiness('fixture-repo', 'abc')).toMatchObject({
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
  expect((await collectReadiness('fixture-repo', 'abc')).complete).toBe(false);
  expect(mocks.getTree).toHaveBeenCalledTimes(2);
});
test('does not fetch README formats outside the Markdown rubric', async () => {
  mocks.getTree.mockResolvedValue({
    data: { truncated: false, tree: [blob('README.png'), blob('README.txt')] },
  });
  expect(await collectReadiness('fixture-repo', 'abc')).toMatchObject({
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
  await expect(collectReadiness('fixture-repo', 'abc')).rejects.toMatchObject({
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
    const pending = expect(collectReadiness('fixture-repo', 'abc')).rejects.toMatchObject({
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
    const pending = expect(collectReadiness('fixture-repo', 'abc')).rejects.toMatchObject({
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
    const pending = expect(resolveReadinessSha('fixture-repo')).rejects.toMatchObject({
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
    const snapshot = await collectReadiness('fixture-repo', 'abc');
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
