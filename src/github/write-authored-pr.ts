import type { installationClient } from './client';
import { createHash } from 'node:crypto';
import type { ConfirmedAgent } from '../domain/fieldnote-skills/types';
import { assertSafeRelativePath, sha256 } from '../domain/fieldnote-skills/lock';
import { errorStatus } from './normalize';

export interface AuthoredPullRequestInput {
  owner: string;
  repo: string;
  runId: string;
  commitDate: string;
  proposalBaseSha: string;
  expectedBaseSha: string;
  release: string;
  revision: string;
  files: ReadonlyMap<string, string>;
  agents: ConfirmedAgent[];
  evidenceCount: number;
  authorize: () => Promise<void>;
}
export type SetupWriteErrorCode =
  | 'setup_conflict'
  | 'invalid_installation'
  | 'access_revoked'
  | 'github_unavailable'
  | 'write_failed';
export class SetupWriteError extends Error {
  constructor(public readonly code: SetupWriteErrorCode) {
    super(
      {
        setup_conflict: 'Setup inputs changed. Refresh the setup conversation.',
        invalid_installation: 'Setup installation is invalid.',
        access_revoked: 'Setup write access is unavailable.',
        github_unavailable: 'GitHub is temporarily unavailable.',
        write_failed: 'Setup pull request could not be written.',
      }[code],
    );
    this.name = 'SetupWriteError';
  }
}
type Client = Awaited<ReturnType<typeof installationClient>>;
const blobSha = (content: string) =>
  createHash('sha1')
    .update(`blob ${Buffer.byteLength(content)}\0${content}`)
    .digest('hex');

// No deletion, force push, or sandbox credentials. Every mutating request is
// independently gated, including Git objects that do not yet belong to a ref.
export async function writeAuthoredPullRequest(
  input: AuthoredPullRequestInput,
  client: Client,
): Promise<{ number: number; branch: string; headSha: string; url: string }> {
  try {
    const version = /^(?:skills-)?v?(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)$/.exec(input.release)?.[1];
    if (!version || !input.files.size || !Number.isFinite(Date.parse(input.commitDate)))
      throw new SetupWriteError('invalid_installation');
    for (const [path, content] of input.files) {
      try {
        assertSafeRelativePath(path);
      } catch {
        throw new SetupWriteError('invalid_installation');
      }
      if (
        !['.fieldnote/', '.agents/skills/', '.claude/skills/'].some((root) =>
          path.startsWith(root),
        ) ||
        content.includes('\0') ||
        Buffer.from(content, 'utf8').toString('utf8') !== content
      )
        throw new SetupWriteError('invalid_installation');
    }
    const identity = { owner: input.owner, repo: input.repo };
    const branch = `fieldnote/setup-skills-v${version}`;
    const title = `Set up Fieldnote Skills v${version}`;
    const { data: repository } = await client.rest.repos.get(identity);
    const ref = async (name: string) => {
      try {
        return (await client.rest.git.getRef({ ...identity, ref: `heads/${name}` })).data.object
          .sha;
      } catch (error) {
        if (errorStatus(error) === 404) return null;
        throw error;
      }
    };
    const baseSha = await ref(repository.default_branch);
    if (!baseSha) throw new SetupWriteError('setup_conflict');
    const tree = async (sha: string) => {
      const { data: commit } = await client.rest.git.getCommit({ ...identity, commit_sha: sha });
      const { data: result } = await client.rest.git.getTree({
        ...identity,
        tree_sha: commit.tree.sha,
        recursive: '1',
      });
      if (
        result.truncated ||
        result.tree.some((entry) => !entry.path || !entry.sha || !entry.mode || !entry.type)
      )
        throw new SetupWriteError('setup_conflict');
      return { commit, entries: new Map(result.tree.map((entry) => [entry.path!, entry])) };
    };
    const current = await tree(baseSha);
    const proposed =
      input.proposalBaseSha === baseSha ? current : await tree(input.proposalBaseSha);
    const checkDestinations = (reference: typeof current) => {
      for (const path of input.files.keys()) {
        const existing = current.entries.get(path),
          original = reference.entries.get(path);
        if (
          existing?.sha !== original?.sha ||
          existing?.mode !== original?.mode ||
          (existing && (existing.type !== 'blob' || existing.mode !== '100644'))
        )
          throw new SetupWriteError('setup_conflict');
        const segments = path.split('/');
        for (let index = 1; index < segments.length; index++) {
          const parent = current.entries.get(segments.slice(0, index).join('/'));
          if (parent && parent.type !== 'tree') throw new SetupWriteError('setup_conflict');
        }
        if ([...input.files.keys()].some((other) => other.startsWith(`${path}/`)))
          throw new SetupWriteError('invalid_installation');
      }
    };
    checkDestinations(proposed);
    const commitMessage = (parentSha: string) => {
      const fingerprint = sha256(
        JSON.stringify([
          input.runId,
          parentSha,
          [...input.files].sort(([a], [b]) => a.localeCompare(b)),
        ]),
      );
      return `${title}\n\nFieldnote setup: ${fingerprint}`;
    };
    const verifyHead = async (sha: string) => {
      const result = await tree(sha);
      if (result.commit.parents.length !== 1) throw new SetupWriteError('setup_conflict');
      const parentSha = result.commit.parents[0].sha;
      if (parentSha !== baseSha) {
        // Comparing immutable SHAs proves that recovering this branch cannot
        // bring abandoned default-branch history into the effective PR diff.
        let comparison;
        try {
          comparison = (
            await client.rest.repos.compareCommitsWithBasehead({
              ...identity,
              basehead: `${parentSha}...${baseSha}`,
              per_page: 1,
            })
          ).data;
        } catch (error) {
          throw new SetupWriteError(
            errorStatus(error) === 401 ? 'access_revoked' : 'github_unavailable',
          );
        }
        if (
          comparison.status !== 'ahead' ||
          comparison.base_commit.sha !== parentSha ||
          comparison.merge_base_commit.sha !== parentSha
        )
          throw new SetupWriteError('setup_conflict');
      }
      const parent = parentSha === baseSha ? current : await tree(parentSha);
      // Recovery validates the original commit against its own parent, even
      // after a renewed proposal. Current destination drift still blocks adoption.
      checkDestinations(parent);
      const expected = new Map(
        [...parent.entries]
          .filter(([, entry]) => entry.type !== 'tree')
          .map(([path, entry]) => [path, `${entry.mode}:${entry.type}:${entry.sha}`]),
      );
      for (const [path, content] of input.files)
        expected.set(path, `100644:blob:${blobSha(content)}`);
      const actual = [...result.entries].filter(([, entry]) => entry.type !== 'tree');
      if (
        result.commit.message !== commitMessage(parentSha) ||
        actual.length !== expected.size ||
        actual.some(
          ([path, entry]) => expected.get(path) !== `${entry.mode}:${entry.type}:${entry.sha}`,
        )
      )
        throw new SetupWriteError('setup_conflict');
    };
    const mutate = async <T>(work: () => Promise<T>): Promise<T> => {
      try {
        await input.authorize();
      } catch (error) {
        if (error instanceof SetupWriteError) throw error;
        throw new SetupWriteError('github_unavailable');
      }
      return work();
    };
    let headSha = await ref(branch);
    if (headSha) await verifyHead(headSha);
    else {
      if (baseSha !== input.expectedBaseSha) throw new SetupWriteError('setup_conflict');
      const entries: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = [];
      for (const [path, content] of input.files) {
        const { data } = await mutate(() =>
          client.rest.git.createBlob({ ...identity, content, encoding: 'utf-8' }),
        );
        entries.push({ path, mode: '100644', type: 'blob', sha: data.sha });
      }
      const { data: newTree } = await mutate(() =>
        client.rest.git.createTree({
          ...identity,
          base_tree: current.commit.tree.sha,
          tree: entries,
        }),
      );
      const author = {
        name: 'Fieldnote',
        email: 'fieldnote[bot]@users.noreply.github.com',
        date: input.commitDate,
      };
      const { data: commit } = await mutate(() =>
        client.rest.git.createCommit({
          ...identity,
          message: commitMessage(baseSha),
          tree: newTree.sha,
          parents: [baseSha],
          author,
          committer: author,
        }),
      );
      // Refresh immediately before publishing the ref. A later default-branch
      // movement is handled by GitHub's normal PR merge-conflict protections.
      if ((await ref(repository.default_branch)) !== baseSha)
        throw new SetupWriteError('setup_conflict');
      headSha = commit.sha;
      try {
        await mutate(() =>
          client.rest.git.createRef({ ...identity, ref: `refs/heads/${branch}`, sha: commit.sha }),
        );
      } catch (error) {
        if (errorStatus(error) !== 422) throw error;
        const recovered = await ref(branch);
        if (!recovered) throw new SetupWriteError('setup_conflict');
        await verifyHead(recovered);
        headSha = recovered;
      }
    }
    const findPr = async () =>
      (
        await client.rest.pulls.list({
          ...identity,
          head: `${input.owner}:${branch}`,
          state: 'all',
          per_page: 100,
        })
      ).data;
    let found = await findPr();
    let pr:
      | {
          number: number;
          html_url: string;
          head: { sha: string; ref: string };
          base: { ref: string };
        }
      | undefined = found.find((item) => item.state === 'open');
    if (!pr && found.length) throw new SetupWriteError('setup_conflict');
    if (!pr) {
      if (baseSha !== input.expectedBaseSha) throw new SetupWriteError('setup_conflict');
      const body = [
        `Installs Fieldnote Skills v${version}.`,
        `Release: ${input.release}\nRevision: ${input.revision}`,
        `Confirmed agents: ${input.agents
          .filter((agent) => agent.supported)
          .map((agent) => agent.agent)
          .join(', ')}`,
        `Unsupported agents (no native adapter installed): ${
          input.agents
            .filter((agent) => !agent.supported)
            .map((agent) => agent.agent)
            .join(', ') || 'none'
        }`,
        `Profile evidence: ${input.evidenceCount} repository evidence files checked; required facts confirmed in the setup conversation.`,
        'Verification: complete pinned release, profile requirements, destination paths, lock file and skill hashes validated. No repository check commands were executed.',
      ].join('\n\n');
      try {
        pr = (
          await mutate(() =>
            client.rest.pulls.create({
              ...identity,
              title,
              body,
              head: branch,
              base: repository.default_branch,
            }),
          )
        ).data;
      } catch (error) {
        if (errorStatus(error) !== 422) throw error;
        found = await findPr();
        pr = found.find((item) => item.state === 'open');
        if (!pr) throw new SetupWriteError('setup_conflict');
      }
    }
    if (
      !pr ||
      pr.head.sha !== headSha ||
      pr.head.ref !== branch ||
      pr.base.ref !== repository.default_branch
    )
      throw new SetupWriteError('setup_conflict');
    return { number: pr.number, branch, headSha, url: pr.html_url };
  } catch (error) {
    if (error instanceof SetupWriteError) throw error;
    const status = errorStatus(error);
    throw new SetupWriteError(
      status === 401
        ? 'access_revoked'
        : status === 403 || status === 429 || (status !== null && status >= 500)
          ? 'github_unavailable'
          : 'write_failed',
    );
  }
}
