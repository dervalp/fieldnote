import { createHash } from 'node:crypto';
import { beforeEach, expect, test, vi } from 'vitest';
import { writeAuthoredPullRequest, type AuthoredPullRequestInput } from './write-authored-pr';

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
      repos: { get: vi.fn(async () => ({ data: { default_branch: 'main' } })) },
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
    throw new Error('private token');
  };
  await expect(call()).rejects.toMatchObject({ code: 'access_revoked' });
  expect(client.rest.git.createBlob).not.toHaveBeenCalled();
  input.authorize = async () => {};
  client.rest.git.getRef.mockRejectedValueOnce({ status: 503, message: 'private token' });
  await expect(call()).rejects.toThrow('GitHub is temporarily unavailable.');
});

test('permission is rechecked immediately before each mutation', async () => {
  input.authorize = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('secret'));
  await expect(call()).rejects.toMatchObject({ code: 'access_revoked' });
  expect(client.rest.git.createBlob).toHaveBeenCalledTimes(1);
  expect(client.rest.git.createTree).not.toHaveBeenCalled();
});
