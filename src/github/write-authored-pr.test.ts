import { createHash } from 'node:crypto';
import { beforeEach, expect, test, vi } from 'vitest';
import { authoredPrClient, compareCommitHistory } from './testing/authored-pr-client';
import {
  SetupWriteError,
  writeAuthoredPullRequest,
  type AuthoredPullRequestInput,
} from './write-authored-pr';

const blob = (content: string) =>
  createHash('sha1')
    .update(`blob ${Buffer.byteLength(content)}\0${content}`)
    .digest('hex');
const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const files = new Map([['.fieldnote/profile.md', '# Profile\nComplete.']]);
let input: AuthoredPullRequestInput;
let refs: Map<string, string>;
let trees: Map<string, Array<{ path: string; mode: string; type: string; sha: string }>>;
let commits: Map<
  string,
  { tree: { sha: string }; message: string; parents: Array<{ sha: string }> }
>;
let prs: Array<{
  number: number;
  state: string;
  html_url: string;
  head: { sha: string; ref: string };
  base: { ref: string };
}>;
let client: ReturnType<typeof fakeClient>;
function fakeClient() {
  return {
    rest: {
      repos: {
        get: vi.fn(async () => ({ data: { default_branch: 'main' } })),
        compareCommitsWithBasehead: vi.fn(async ({ basehead }: { basehead: string }) =>
          compareCommitHistory(commits, basehead),
        ),
      },
      git: {
        getRef: vi.fn(async ({ ref }: { ref: string }) => {
          if (!refs.has(ref)) throw { status: 404 };
          return { data: { object: { sha: refs.get(ref)! } } };
        }),
        getCommit: vi.fn(async ({ commit_sha }: { commit_sha: string }) => ({
          data: commits.get(commit_sha)!,
        })),
        getTree: vi.fn(async ({ tree_sha }: { tree_sha: string }) => ({
          data: { truncated: false, tree: trees.get(tree_sha)! },
        })),
        createBlob: vi.fn(async ({ content }: { content: string }) => ({
          data: { sha: blob(content) },
        })),
        createTree: vi.fn(
          async ({
            tree,
          }: {
            tree: Array<{ path: string; mode: string; type: string; sha: string }>;
          }) => {
            trees.set(
              'new-tree',
              structuredClone([
                ...trees
                  .get('base-tree')!
                  .filter((entry) => !tree.some((file) => file.path === entry.path)),
                ...tree,
              ]),
            );
            return { data: { sha: 'new-tree' } };
          },
        ),
        createCommit: vi.fn(
          async ({
            message,
            tree,
            parents,
          }: {
            message: string;
            tree: string;
            parents: string[];
          }) => {
            commits.set(head, {
              message,
              tree: { sha: tree },
              parents: parents.map((sha) => ({ sha })),
            });
            return { data: { sha: head } };
          },
        ),
        createRef: vi.fn(async ({ ref, sha }: { ref: string; sha: string }) => {
          if (refs.has(ref.slice(5))) throw { status: 422 };
          refs.set(ref.slice(5), sha);
          return { data: {} };
        }),
      },
      pulls: {
        list: vi.fn(async () => ({ data: prs })),
        create: vi.fn(async ({ head: branch, base: target }: { head: string; base: string }) => {
          const pr = {
            number: 42,
            state: 'open',
            html_url: 'https://github.test/pr/42',
            head: { ref: branch, sha: head },
            base: { ref: target },
          };
          prs.push(pr);
          return { data: pr };
        }),
      },
    },
  };
}
const call = () =>
  writeAuthoredPullRequest(
    input,
    client as unknown as Parameters<typeof writeAuthoredPullRequest>[1],
  );
beforeEach(() => {
  refs = new Map([['heads/main', base]]);
  trees = new Map([
    ['base-tree', [{ path: 'README.md', mode: '100644', type: 'blob', sha: 'readme' }]],
  ]);
  commits = new Map([[base, { tree: { sha: 'base-tree' }, message: 'base', parents: [] }]]);
  prs = [];
  input = {
    owner: 'octo',
    repo: 'repo',
    runId: 'execute',
    commitDate: '2026-09-16T00:00:00Z',
    proposalBaseSha: base,
    expectedBaseSha: base,
    release: 'skills-v0.1.0',
    revision: 'c'.repeat(40),
    files,
    agents: [
      { agent: 'codex', supported: true, skillsRoot: '.agents/skills' },
      { agent: 'cursor', supported: false, skillsRoot: null },
    ],
    evidenceCount: 3,
    authorize: vi.fn(async () => {}),
  };
  client = fakeClient();
});

test('writes additive UTF-8 git objects based on the current default branch and opens one PR', async () => {
  expect(await call()).toEqual({
    number: 42,
    branch: 'fieldnote/setup-skills-v0.1.0',
    headSha: head,
    url: 'https://github.test/pr/42',
  });
  expect(client.rest.git.createTree).toHaveBeenCalledWith(
    expect.objectContaining({
      base_tree: 'base-tree',
      tree: [
        {
          path: '.fieldnote/profile.md',
          mode: '100644',
          type: 'blob',
          sha: blob(files.get('.fieldnote/profile.md')!),
        },
      ],
    }),
  );
  expect(client.rest.git.createBlob).toHaveBeenCalledWith(
    expect.objectContaining({ encoding: 'utf-8' }),
  );
  expect(trees.get('new-tree')!.some((entry) => entry.path === 'README.md')).toBe(true);
  const body = (client.rest.pulls.create.mock.calls[0][0] as unknown as { body: string }).body;
  expect(body).toContain('codex');
  expect(body).toContain('cursor');
  expect(body).toContain('3');
  expect(body).not.toContain('# Profile');
});

test('recovers a ref or PR whose provider response was lost without another commit or PR', async () => {
  const create = client.rest.pulls.create.getMockImplementation()!;
  client.rest.pulls.create.mockImplementationOnce(async (args) => {
    await create(args);
    throw { status: 503, message: 'secret' };
  });
  await expect(call()).rejects.toMatchObject({ code: 'github_unavailable' });
  const result = await call();
  expect(result.number).toBe(42);
  expect(client.rest.git.createCommit).toHaveBeenCalledTimes(1);
  expect(client.rest.pulls.create).toHaveBeenCalledTimes(1);
});

test('recovers concurrent ref creation only when it points at the exact authored commit', async () => {
  client.rest.git.createRef.mockImplementationOnce(async ({ ref, sha }) => {
    refs.set(ref.slice(5), sha);
    throw { status: 422 };
  });
  expect((await call()).number).toBe(42);
});

test('refuses destination drift, unsafe paths and directory collisions before mutations', async () => {
  commits.set('old', { tree: { sha: 'old-tree' }, message: '', parents: [] });
  trees.set('old-tree', []);
  trees
    .get('base-tree')!
    .push({ path: '.fieldnote/profile.md', mode: '100644', type: 'blob', sha: 'human-change' });
  input.proposalBaseSha = 'old';
  await expect(call()).rejects.toMatchObject({ code: 'setup_conflict' });
  input.files = new Map([['../secret', 'no']]);
  await expect(call()).rejects.toMatchObject({ code: 'invalid_installation' });
  input.files = files;
  trees.set('base-tree', [{ path: '.fieldnote', type: 'blob', mode: '120000', sha: 'symlink' }]);
  await expect(call()).rejects.toMatchObject({ code: 'setup_conflict' });
  expect(client.rest.git.createBlob).not.toHaveBeenCalled();
});

test('a truncated tree cannot establish safe destinations', async () => {
  client.rest.git.getTree.mockResolvedValueOnce({ data: { truncated: true, tree: [] } });
  await expect(call()).rejects.toMatchObject({ code: 'setup_conflict' });
  expect(client.rest.git.createBlob).not.toHaveBeenCalled();
});

test('a recovered branch must preserve every unrelated file and the exact installation bytes', async () => {
  await call();
  trees.get('new-tree')!.find((entry) => entry.path === 'README.md')!.sha = 'human-modification';
  await expect(call()).rejects.toMatchObject({ code: 'setup_conflict' });
  expect(client.rest.git.createCommit).toHaveBeenCalledTimes(1);
});

test('a closed PR cannot be duplicated and a wrong PR base cannot be adopted', async () => {
  await call();
  prs[0].state = 'closed';
  await expect(call()).rejects.toMatchObject({ code: 'setup_conflict' });
  prs[0].state = 'open';
  prs[0].base.ref = 'other';
  await expect(call()).rejects.toMatchObject({ code: 'setup_conflict' });
  expect(client.rest.pulls.create).toHaveBeenCalledTimes(1);
});

test('stops on a new default head, a foreign branch, or permission loss and sanitizes provider failures', async () => {
  input.expectedBaseSha = 'stale';
  await expect(call()).rejects.toMatchObject({ code: 'setup_conflict' });
  input.expectedBaseSha = base;
  refs.set('heads/fieldnote/setup-skills-v0.1.0', base);
  await expect(call()).rejects.toMatchObject({ code: 'setup_conflict' });
  refs.delete('heads/fieldnote/setup-skills-v0.1.0');
  input.authorize = async () => {
    throw new SetupWriteError('access_revoked');
  };
  await expect(call()).rejects.toMatchObject({ code: 'access_revoked' });
  expect(client.rest.git.createBlob).not.toHaveBeenCalled();
  input.authorize = async () => {};
  client.rest.git.getRef.mockRejectedValueOnce({ status: 503, message: 'private token' });
  await expect(call()).rejects.toThrow('GitHub is temporarily unavailable.');
});

test('permission is rechecked immediately before each mutation', async () => {
  input.authorize = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValue(new SetupWriteError('access_revoked'));
  await expect(call()).rejects.toMatchObject({ code: 'access_revoked' });
  expect(client.rest.git.createBlob).toHaveBeenCalledTimes(1);
  expect(client.rest.git.createTree).not.toHaveBeenCalled();
});

test.each([
  new Error('private permission lookup timeout'),
  new SetupWriteError('github_unavailable'),
])(
  'temporary per-mutation authorization failure is sanitized and retryable: %s',
  async (failure) => {
    input.authorize = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined);
    await expect(call()).rejects.toMatchObject({
      code: 'github_unavailable',
      message: 'GitHub is temporarily unavailable.',
    });
    expect(client.rest.git.createBlob).toHaveBeenCalledTimes(1);
    expect(client.rest.git.createTree).not.toHaveBeenCalled();
    expect((await call()).number).toBe(42);
    expect(client.rest.git.createCommit).toHaveBeenCalledTimes(1);
  },
);

test('adopts a lost-response PR after unrelated default movement, including renewed proposal generation', async () => {
  const create = client.rest.pulls.create.getMockImplementation()!;
  client.rest.pulls.create.mockImplementationOnce(async (args) => {
    await create(args);
    throw { status: 503, message: 'private response' };
  });
  await expect(call()).rejects.toMatchObject({ code: 'github_unavailable' });
  const moved = 'd'.repeat(40);
  refs.set('heads/main', moved);
  commits.set(moved, {
    tree: { sha: 'moved-tree' },
    message: 'unrelated',
    parents: [{ sha: base }],
  });
  trees.set('moved-tree', [
    ...structuredClone(trees.get('base-tree')!),
    { path: 'src/new.ts', type: 'blob', mode: '100644', sha: 'new-source' },
  ]);
  expect((await call()).headSha).toBe(head);
  const renewed = 'e'.repeat(40);
  refs.set('heads/main', renewed);
  commits.set(renewed, {
    tree: { sha: 'renewed-tree' },
    message: 'updated instructions',
    parents: [{ sha: moved }],
  });
  trees.set('renewed-tree', [
    ...structuredClone(trees.get('moved-tree')!),
    { path: 'AGENTS.md', type: 'blob', mode: '100644', sha: 'new-instructions' },
  ]);
  // The renewed proposal confirms the same desired files against new evidence.
  input.expectedBaseSha = renewed;
  input.proposalBaseSha = renewed;
  expect((await call()).number).toBe(42);
  input.files = new Map([['.fieldnote/profile.md', 'changed desired profile']]);
  await expect(call()).rejects.toMatchObject({ code: 'setup_conflict' });
  expect(client.rest.git.createCommit).toHaveBeenCalledTimes(1);
  expect(client.rest.git.createRef).toHaveBeenCalledTimes(1);
  expect(client.rest.pulls.create).toHaveBeenCalledTimes(1);
});

test('default movement cannot bypass relevant destination conflict or modified-branch checks during recovery', async () => {
  await call();
  const moved = 'd'.repeat(40);
  refs.set('heads/main', moved);
  commits.set(moved, {
    tree: { sha: 'moved-tree' },
    message: 'changed destination',
    parents: [{ sha: base }],
  });
  trees.set('moved-tree', [
    ...structuredClone(trees.get('base-tree')!),
    { path: '.fieldnote/profile.md', type: 'blob', mode: '100644', sha: 'human-change' },
  ]);
  await expect(call()).rejects.toMatchObject({ code: 'setup_conflict' });
  // A renewed proposal must not erase the conflict against the authored parent.
  input.proposalBaseSha = moved;
  input.expectedBaseSha = moved;
  await expect(call()).rejects.toMatchObject({ code: 'setup_conflict' });
  trees.set('moved-tree', structuredClone(trees.get('base-tree')!));
  trees.get('new-tree')!.find((entry) => entry.path === '.fieldnote/profile.md')!.sha =
    'edited-branch';
  await expect(call()).rejects.toMatchObject({ code: 'setup_conflict' });
  expect(client.rest.pulls.create).toHaveBeenCalledTimes(1);
});

test('recovery proves the authored parent is in forward-moving default history using pinned commit comparison', async () => {
  const github = authoredPrClient(base);
  const first = await writeAuthoredPullRequest(input, github.client);
  const moved = 'd'.repeat(40);
  github.moveDefault(moved);
  expect(await writeAuthoredPullRequest(input, github.client)).toEqual(first);
  expect(github.api.repos.compareCommitsWithBasehead).toHaveBeenCalledWith(
    expect.objectContaining({ owner: 'octo', repo: 'repo', basehead: `${base}...${moved}` }),
  );
  expect(github.api.git.createCommit).toHaveBeenCalledTimes(1);
});

test.each(['rewind', 'divergence'])(
  'lost-response recovery rejects default %s that would reintroduce abandoned-history files',
  async (movement) => {
    const github = authoredPrClient(base);
    const root = '0'.repeat(40),
      rewritten = 'd'.repeat(40);
    github.trees.set('root-tree', structuredClone(github.trees.get('initial-tree')!));
    github.commits.set(root, { tree: { sha: 'root-tree' }, message: 'root', parents: [] });
    github.commits.get(base)!.parents = [{ sha: root }];
    github.trees
      .get('initial-tree')!
      .push({ path: 'src/abandoned.ts', mode: '100644', type: 'blob', sha: 'abandoned-source' });
    const create = github.api.pulls.create.getMockImplementation()!;
    github.api.pulls.create.mockImplementationOnce(async (args) => {
      await create(args);
      throw { status: 503 };
    });
    await expect(writeAuthoredPullRequest(input, github.client)).rejects.toMatchObject({
      code: 'github_unavailable',
    });
    github.commits.set(rewritten, {
      tree: { sha: 'root-tree' },
      message: 'new history',
      parents: [{ sha: root }],
    });
    const current = movement === 'rewind' ? root : rewritten;
    github.refs.set('heads/main', current);
    // Even a refreshed proposal cannot authorize adoption of abandoned history.
    input.expectedBaseSha = current;
    input.proposalBaseSha = current;
    await expect(writeAuthoredPullRequest(input, github.client)).rejects.toMatchObject({
      code: 'setup_conflict',
    });
    await expect(
      github.api.repos.compareCommitsWithBasehead.mock.results[0].value,
    ).resolves.toMatchObject({ data: { status: movement === 'rewind' ? 'behind' : 'diverged' } });
    expect(github.api.git.createCommit).toHaveBeenCalledTimes(1);
    expect(github.api.pulls.create).toHaveBeenCalledTimes(1);
  },
);

test.each([
  { status: 503, message: 'private response' },
  { status: 429, message: 'private rate limit' },
  new Error('private timeout'),
])('compare unavailability remains sanitized and retryable: %s', async (failure) => {
  const github = authoredPrClient(base);
  const first = await writeAuthoredPullRequest(input, github.client);
  github.moveDefault('d'.repeat(40));
  github.api.repos.compareCommitsWithBasehead.mockRejectedValueOnce(failure);
  await expect(writeAuthoredPullRequest(input, github.client)).rejects.toMatchObject({
    code: 'github_unavailable',
    message: 'GitHub is temporarily unavailable.',
  });
  expect(await writeAuthoredPullRequest(input, github.client)).toEqual(first);
  expect(github.api.git.createCommit).toHaveBeenCalledTimes(1);
  expect(github.api.pulls.create).toHaveBeenCalledTimes(1);
});
