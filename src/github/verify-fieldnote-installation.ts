import { repositoryClient } from './repositories';
import { errorStatus } from './normalize';
import {
  assertSafeRelativePath,
  parseInstallationLock,
  sha256,
  type InstallationLock,
} from '../domain/fieldnote-skills/lock';
import { verifyInstallation, type InstallationSnapshot } from '../domain/fieldnote-skills/render';
import { setupAdapters } from '../domain/fieldnote-skills/adapters';
import {
  confirmedAgentSchema,
  type ConfirmedAgent,
  type InstallationObservation,
  type SkillsRelease,
} from '../domain/fieldnote-skills/types';
import { profileValues } from '../authoring/setup-author';
import { requiredFactsForProfile, unresolved } from '../domain/fieldnote-skills/profile-facts';

const lockPath = '.fieldnote/skills.lock.json';
const requiredConfiguration = [
  '.fieldnote/profile.md',
  '.fieldnote/definition-of-done.md',
  '.fieldnote/concerns/shared.md',
];
const limits = { files: 400, fileBytes: 256 * 1024, totalBytes: 4 * 1024 * 1024, entries: 15_000 };
const messages = {
  merge_not_visible: 'Merged installation is not yet visible on the default branch',
  scan_incomplete: 'Installation scan incomplete',
  access_unavailable: 'Installation access unavailable',
  verification_unavailable: 'Installation verification temporarily unavailable',
} as const;
export class InstallationVerificationError extends Error {
  readonly retryable: boolean;
  constructor(public readonly code: keyof typeof messages) {
    super(messages[code]);
    this.name = 'InstallationVerificationError';
    this.retryable = code !== 'access_unavailable';
  }
}
export interface VerificationSnapshot extends InstallationSnapshot {
  complete: boolean;
}
interface ExpectedInstallation {
  setupRunId: string;
  agents: ConfirmedAgent[];
  configurationPaths: string[];
  latest: string;
}
function configurationPath(path: string): boolean {
  return (
    requiredConfiguration.includes(path) || /^\.fieldnote\/concerns\/[a-zA-Z0-9_-]+\.md$/.test(path)
  );
}
function boundedLock(content: string): InstallationLock {
  if (Buffer.byteLength(content) > limits.fileBytes) throw new Error('Invalid lock');
  const lock = parseInstallationLock(content);
  if (lock.files.length > limits.files - 1 || lock.skills.length > limits.files)
    throw new Error('Invalid lock');
  for (const file of lock.files) {
    if (configurationPath(file.path)) continue;
    const valid = lock.agents.some((agent) =>
      lock.skills.some((skill) => file.path.startsWith(`${agent.skillsRoot}/${skill.name}/`)),
    );
    if (!valid) throw new Error('Invalid lock');
  }
  return lock;
}

/** Pure verification against the pinned, validated release, then latest-tag classification. */
export function verifyFieldnoteInstallation(
  snapshot: VerificationSnapshot,
  release: SkillsRelease,
  expected: ExpectedInstallation,
): InstallationObservation {
  if (!snapshot.complete) throw new InstallationVerificationError('scan_incomplete');
  const content = snapshot.files.get(lockPath);
  const base: InstallationObservation = {
    state: 'partial',
    release: release.release,
    revision: release.revision,
    lockHash: content === undefined ? '' : sha256(content),
    agents: confirmedAgentSchema.array().parse(expected.agents),
    commitSha: snapshot.commitSha,
    reasons: [],
  };
  const partial = (reason: string) => ({ ...base, reasons: [reason] });
  if (content === undefined) return partial('Missing installation lock. Repair Fieldnote setup.');
  let lock: InstallationLock;
  try {
    lock = boundedLock(content);
  } catch {
    return partial('Invalid installation lock. Repair Fieldnote setup.');
  }
  if (
    lock.release !== release.release ||
    lock.revision !== release.revision ||
    lock.releaseLockHash !== release.releaseLockHash ||
    lock.setupRunId !== expected.setupRunId
  )
    return partial('Installation identity does not match the approved release and setup.');
  const supported = expected.agents.filter((agent) => agent.supported);
  if (
    !supported.length ||
    new Set(expected.agents.map((agent) => agent.agent)).size !== expected.agents.length ||
    expected.agents.some((agent) => {
      const adapter = setupAdapters[agent.agent as keyof typeof setupAdapters];
      return (
        Boolean(adapter) !== agent.supported ||
        (agent.supported ? agent.skillsRoot !== adapter.skillsRoot : agent.skillsRoot !== null)
      );
    }) ||
    lock.agents.length !== supported.length ||
    supported.some(
      (agent) =>
        !lock.agents.some(
          (target) => target.agent === agent.agent && target.skillsRoot === agent.skillsRoot,
        ),
    )
  )
    return partial('Confirmed agent targets are incomplete or invalid.');
  const configuration = [...new Set([...requiredConfiguration, ...expected.configurationPaths])];
  if (
    configuration.some(
      (path) =>
        !configurationPath(path) ||
        !snapshot.files.has(path) ||
        !lock.files.some((file) => file.path === path),
    )
  )
    return partial('Required Fieldnote configuration is missing.');
  const expectedPaths = new Set([
    ...configuration,
    ...supported.flatMap((agent) =>
      release.skills.flatMap((skill) =>
        skill.files.map((file) => `${agent.skillsRoot}/${skill.name}/${file.path}`),
      ),
    ),
  ]);
  if (lock.files.some((file) => !expectedPaths.has(file.path)))
    return partial('Installation lock declares unexpected files.');
  try {
    const values = profileValues(snapshot.files.get('.fieldnote/profile.md') ?? '');
    if (requiredFactsForProfile(values).some((key) => unresolved(values.get(key))))
      return partial('Profile contains unresolved required facts.');
  } catch {
    return partial('Profile contains invalid required facts.');
  }
  const result = verifyInstallation(snapshot, release);
  // Never persist arbitrary repository strings (including attacker-controlled path names).
  if (result.state === 'partial')
    return partial('Installation is incomplete or its release hashes do not match.');
  if (result.state === 'drifted')
    return {
      ...base,
      state: 'drifted',
      reasons: ['Managed installation files have changed. Repair Fieldnote setup.'],
    };
  return { ...base, state: release.release === expected.latest ? 'current' : 'outdated' };
}

/** Lock-first bounded read. Bytes stay in memory and must never become step output. */
export async function collectInstallationSnapshot(
  repositoryId: string,
  number: number,
  configurationPaths: string[],
): Promise<VerificationSnapshot> {
  const signal = AbortSignal.timeout(30_000);
  try {
    const { repo, client } = await repositoryClient(repositoryId);
    const identity = { owner: repo.owner, repo: repo.name, request: { signal } };
    const { data: remote } = await client.rest.repos.get(identity);
    const { data: ref } = await client.rest.git.getRef({
      ...identity,
      ref: `heads/${remote.default_branch}`,
    });
    const commitSha = ref.object.sha;
    const { data: pr } = await client.rest.pulls.get({ ...identity, pull_number: number });
    if (!pr.merged || !pr.merge_commit_sha)
      throw new InstallationVerificationError('merge_not_visible');
    const { data: comparison } = await client.rest.repos
      .compareCommits({ ...identity, base: pr.merge_commit_sha, head: commitSha })
      .catch((error: unknown) => {
        if (errorStatus(error) === 404)
          throw new InstallationVerificationError('merge_not_visible');
        throw error;
      });
    if (!['ahead', 'identical'].includes(comparison.status))
      throw new InstallationVerificationError('merge_not_visible');
    const { data: commit } = await client.rest.git.getCommit({
      ...identity,
      commit_sha: commitSha,
    });
    type Entry = { path?: string; sha?: string; type?: string; mode?: string; size?: number };
    const trees = new Map<string, Entry[]>();
    let entries = 0;
    let totalBytes = 0;
    let fileCount = 0;
    const incomplete = () => new InstallationVerificationError('scan_incomplete');
    async function read(path: string): Promise<string | undefined> {
      assertSafeRelativePath(path);
      if (++fileCount > limits.files) throw incomplete();
      const parts = path.split('/');
      let treeSha = commit.tree.sha;
      for (let index = 0; index < parts.length; index++) {
        let tree = trees.get(treeSha);
        if (!tree) {
          const { data } = await client.rest.git.getTree({ ...identity, tree_sha: treeSha });
          if (data.truncated || (entries += data.tree.length) > limits.entries) throw incomplete();
          tree = data.tree;
          trees.set(treeSha, tree);
        }
        const entry = tree.find((entry) => entry.path === parts[index]);
        if (!entry) return undefined;
        if (!entry.sha) throw incomplete();
        if (index !== parts.length - 1) {
          if (entry.type !== 'tree' || entry.mode !== '040000') return undefined;
          treeSha = entry.sha;
          continue;
        }
        if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode ?? ''))
          return undefined;
        if (
          !Number.isSafeInteger(entry.size) ||
          entry.size! < 0 ||
          entry.size! > limits.fileBytes ||
          totalBytes + entry.size! > limits.totalBytes
        )
          throw incomplete();
        const { data } = await client.rest.git.getBlob({ ...identity, file_sha: entry.sha });
        if (
          data.encoding !== 'base64' ||
          !Number.isSafeInteger(data.size) ||
          data.size! < 0 ||
          data.size! > limits.fileBytes ||
          data.content.length > Math.ceil(limits.fileBytes / 3) * 4 + limits.fileBytes / 30
        )
          throw incomplete();
        const encoded = data.content.replace(/\s/g, '');
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
          throw incomplete();
        const bytes = Buffer.from(encoded, 'base64');
        if (
          bytes.length !== data.size ||
          bytes.length !== entry.size ||
          bytes.includes(0) ||
          (totalBytes += bytes.length) > limits.totalBytes
        )
          throw incomplete();
        try {
          return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        } catch {
          throw incomplete();
        }
      }
    }
    const files = new Map<string, string>();
    const lockContent = await read(lockPath);
    if (lockContent !== undefined) {
      files.set(lockPath, lockContent);
      let lock: InstallationLock | undefined;
      try {
        lock = boundedLock(lockContent);
      } catch {
        /* Fully observed malformed lock is partial, not a provider failure. */
      }
      if (lock) {
        const paths = new Set([
          ...lock.files.map((file) => file.path),
          ...requiredConfiguration,
          ...configurationPaths,
        ]);
        if (
          paths.size >= limits.files ||
          configurationPaths.some((path) => !configurationPath(path))
        )
          throw incomplete();
        for (const path of paths) {
          const content = await read(path);
          if (content !== undefined) files.set(path, content);
        }
      }
    }
    signal.throwIfAborted();
    return { commitSha, complete: true, files };
  } catch (error) {
    if (error instanceof InstallationVerificationError) throw error;
    if (
      [401, 404, 410].includes(errorStatus(error) ?? 0) ||
      (error instanceof Error && error.message.startsWith('Repository unavailable:'))
    )
      throw new InstallationVerificationError('access_unavailable');
    throw new InstallationVerificationError('verification_unavailable');
  }
}
