import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import type { writeAuthoredPullRequest } from '../write-authored-pr';

type Entry = { path: string; mode: string; type: string; sha: string };
type Commit = { tree: { sha: string }; message: string; parents: Array<{ sha: string }> };
type PullRequest = {
  number: number;
  state: string;
  html_url: string;
  head: { sha: string; ref: string };
  base: { ref: string };
};
const hash = (value: string) => createHash('sha1').update(value).digest('hex');

/** Model the compare API from commit ancestry, not from tree equality. */
export function compareCommitHistory(
  commits: ReadonlyMap<string, Pick<Commit, 'parents'>>,
  basehead: string,
) {
  const [base, head] = basehead.split('...');
  const ancestors = (sha: string) => {
    const found = new Set<string>();
    const queue = [sha];
    for (const current of queue) {
      if (found.has(current)) continue;
      const commit = commits.get(current);
      if (!commit) throw { status: 404 };
      found.add(current);
      queue.push(...commit.parents.map((parent) => parent.sha));
    }
    return found;
  };
  const fromBase = ancestors(base),
    fromHead = ancestors(head);
  const mergeBase = [...fromBase].find((sha) => fromHead.has(sha));
  if (!mergeBase) throw { status: 404 };
  return {
    data: {
      status:
        base === head
          ? 'identical'
          : fromHead.has(base)
            ? 'ahead'
            : fromBase.has(head)
              ? 'behind'
              : 'diverged',
      base_commit: { sha: base },
      merge_base_commit: { sha: mergeBase },
    },
  };
}

/** Stateful Git data/PR boundary for tests that keep the real writer and workflow. */
export function authoredPrClient(baseSha: string) {
  const refs = new Map([['heads/main', baseSha]]);
  const trees = new Map<string, Entry[]>([
    ['initial-tree', [{ path: 'README.md', mode: '100644', type: 'blob', sha: 'readme' }]],
  ]);
  const commits = new Map<string, Commit>([
    [baseSha, { tree: { sha: 'initial-tree' }, message: 'initial', parents: [] }],
  ]);
  const prs: PullRequest[] = [];
  const api = {
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
        data: { tree: trees.get(tree_sha)!, truncated: false },
      })),
      createBlob: vi.fn(async ({ content }: { content: string }) => ({
        data: { sha: hash(`blob ${Buffer.byteLength(content)}\0${content}`) },
      })),
      createTree: vi.fn(async ({ base_tree, tree }: { base_tree: string; tree: Entry[] }) => {
        const entries = structuredClone([
          ...trees
            .get(base_tree)!
            .filter((entry) => !tree.some((file) => file.path === entry.path)),
          ...tree,
        ]);
        const sha = hash(JSON.stringify(entries));
        trees.set(sha, entries);
        return { data: { sha } };
      }),
      createCommit: vi.fn(
        async (input: {
          message: string;
          tree: string;
          parents: string[];
          author: unknown;
          committer: unknown;
        }) => {
          const sha = hash(JSON.stringify(input));
          commits.set(sha, {
            message: input.message,
            tree: { sha: input.tree },
            parents: input.parents.map((sha) => ({ sha })),
          });
          return { data: { sha } };
        },
      ),
      createRef: vi.fn(async ({ ref, sha }: { ref: string; sha: string }) => {
        if (refs.has(ref.slice(5))) throw { status: 422 };
        refs.set(ref.slice(5), sha);
        return { data: {} };
      }),
    },
    pulls: {
      list: vi.fn(async ({ head }: { head: string }) => ({
        data: prs.filter((pr) => head.endsWith(`:${pr.head.ref}`)),
      })),
      create: vi.fn(async ({ head, base }: { head: string; base: string }) => {
        const pr = {
          number: 42 + prs.length,
          state: 'open',
          html_url: `https://github.test/pr/${42 + prs.length}`,
          head: { ref: head, sha: refs.get(`heads/${head}`)! },
          base: { ref: base },
        };
        prs.push(pr);
        return { data: pr };
      }),
    },
  };
  return {
    client: { rest: api } as unknown as Parameters<typeof writeAuthoredPullRequest>[1],
    api,
    refs,
    trees,
    commits,
    prs,
    moveDefault(sha: string) {
      const tree = `tree-${sha}`;
      trees.set(tree, [
        ...structuredClone(trees.get('initial-tree')!),
        { path: 'src/unrelated.ts', mode: '100644', type: 'blob', sha: 'unrelated' },
      ]);
      commits.set(sha, {
        tree: { sha: tree },
        message: 'unrelated change',
        parents: [{ sha: baseSha }],
      });
      refs.set('heads/main', sha);
    },
  };
}
