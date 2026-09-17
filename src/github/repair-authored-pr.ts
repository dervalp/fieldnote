import { createHash } from 'node:crypto';
import type { installationClient } from './client';
import { SetupWriteError } from './write-authored-pr';
import { assertSafeRelativePath } from '../domain/fieldnote-skills/lock';
import { errorStatus } from './normalize';
type Client = Awaited<ReturnType<typeof installationClient>>;
export interface RepairWriteInput {
  owner: string;
  repo: string;
  branch: string;
  expectedHeadSha: string;
  repairId: string;
  commitDate: string;
  files: ReadonlyMap<string, string>;
  managedPaths: string[];
  authorize: () => Promise<void>;
}
export const repairCommitMessage = (id: string) =>
  `Repair Fieldnote setup\n\nFieldnote repair: ${id}`;
const blobSha = (content: string) =>
  createHash('sha1')
    .update(`blob ${Buffer.byteLength(content)}\0${content}`)
    .digest('hex');
export async function writePrRepair(
  input: RepairWriteInput,
  client: Client,
): Promise<{ headSha: string }> {
  try {
    if (
      !input.files.size ||
      input.files.size !== input.managedPaths.length ||
      !input.branch.startsWith('fieldnote/') ||
      !Number.isFinite(Date.parse(input.commitDate))
    )
      throw new SetupWriteError('invalid_installation');
    for (const [path, content] of input.files) {
      try {
        assertSafeRelativePath(path);
      } catch {
        throw new SetupWriteError('invalid_installation');
      }
      if (
        !input.managedPaths.includes(path) ||
        !['.fieldnote/', '.agents/skills/', '.claude/skills/'].some((root) =>
          path.startsWith(root),
        ) ||
        content.includes('\0')
      )
        throw new SetupWriteError('invalid_installation');
    }
    const identity = { owner: input.owner, repo: input.repo };
    const ref = () =>
      client.rest.git
        .getRef({ ...identity, ref: `heads/${input.branch}` })
        .then(({ data }) => data.object.sha);
    const tree = async (sha: string) => {
      const { data: commit } = await client.rest.git.getCommit({ ...identity, commit_sha: sha });
      if (!commit) throw new SetupWriteError('setup_conflict');
      const { data } = await client.rest.git.getTree({
        ...identity,
        tree_sha: commit.tree.sha,
        recursive: '1',
      });
      if (
        data.truncated ||
        data.tree.some((entry) => !entry.path || !entry.mode || !entry.type || !entry.sha)
      )
        throw new SetupWriteError('setup_conflict');
      return { commit, entries: data.tree };
    };
    const base = await tree(input.expectedHeadSha);
    const current = await ref();
    if (current !== input.expectedHeadSha) {
      const recovered = await tree(current);
      const expected = new Map(
        base.entries
          .filter((entry) => entry.type !== 'tree')
          .map((entry) => [entry.path, `${entry.mode}:${entry.type}:${entry.sha}`]),
      );
      for (const [path, content] of input.files)
        expected.set(path, `100644:blob:${blobSha(content)}`);
      const actual = recovered.entries.filter((entry) => entry.type !== 'tree');
      if (
        recovered.commit.message !== repairCommitMessage(input.repairId) ||
        recovered.commit.parents.length !== 1 ||
        recovered.commit.parents[0].sha !== input.expectedHeadSha ||
        expected.size !== actual.length ||
        actual.some(
          (entry) => expected.get(entry.path) !== `${entry.mode}:${entry.type}:${entry.sha}`,
        )
      )
        throw new SetupWriteError('setup_conflict');
      return { headSha: current };
    }
    const mutate = async <T>(work: () => Promise<T>) => {
      await input.authorize();
      return work();
    };
    const entries: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = [];
    for (const [path, content] of input.files) {
      const existing = base.entries.find((entry) => entry.path === path);
      if (existing && (existing.type !== 'blob' || existing.mode !== '100644'))
        throw new SetupWriteError('setup_conflict');
      const { data } = await mutate(() =>
        client.rest.git.createBlob({ ...identity, content, encoding: 'utf-8' }),
      );
      entries.push({ path, mode: '100644', type: 'blob', sha: data.sha });
    }
    const { data: createdTree } = await mutate(() =>
      client.rest.git.createTree({ ...identity, base_tree: base.commit.tree.sha, tree: entries }),
    );
    const author = {
      name: 'Fieldnote',
      email: 'fieldnote[bot]@users.noreply.github.com',
      date: input.commitDate,
    };
    const { data: commit } = await mutate(() =>
      client.rest.git.createCommit({
        ...identity,
        tree: createdTree.sha,
        parents: [input.expectedHeadSha],
        message: repairCommitMessage(input.repairId),
        author,
        committer: author,
      }),
    );
    await input.authorize();
    if ((await ref()) !== input.expectedHeadSha) throw new SetupWriteError('setup_conflict');
    // The provider's fast-forward check also rejects concurrent divergent pushes.
    await client.rest.git.updateRef({
      ...identity,
      ref: `heads/${input.branch}`,
      sha: commit.sha,
      force: false,
    });
    return { headSha: commit.sha };
  } catch (error) {
    if (error instanceof SetupWriteError) throw error;
    const status = errorStatus(error);
    throw new SetupWriteError(
      status === 401
        ? 'access_revoked'
        : status === 404 || status === 422
          ? 'setup_conflict'
          : 'github_unavailable',
    );
  }
}
