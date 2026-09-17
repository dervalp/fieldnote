import type { AgentId } from '../ai-involvement/types';
import { setupAdapters } from './adapters';
import {
  assertCompleteConfiguration,
  configurationProblems,
  requiredConfiguration,
} from './configuration';
import {
  assertSafeRelativePath,
  type InstallationLock,
  parseInstallationLock,
  renderInstallationLock,
  sha256,
} from './lock';
import type {
  ConfirmedAgent,
  InstallationObservation,
  RenderedInstallation,
  SkillsRelease,
} from './types';

const lockPath = '.fieldnote/skills.lock.json';
const profilePath = '.fieldnote/profile.md';

function lexicographically(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface InstallationConfiguration {
  path: string;
  content: string;
}

export interface RenderInstallationInput {
  release: SkillsRelease;
  setupRunId: string;
  agents: ConfirmedAgent[];
  configuration: InstallationConfiguration[];
}

export interface InstallationSnapshot {
  commitSha: string;
  files: ReadonlyMap<string, string>;
}

function sortedMap(files: Map<string, string>): ReadonlyMap<string, string> {
  return new Map([...files.entries()].sort(([left], [right]) => lexicographically(left, right)));
}

function addFile(files: Map<string, string>, path: string, content: string): void {
  assertSafeRelativePath(path);
  if (files.has(path)) throw new Error(`Duplicate repository path: ${path}`);
  files.set(path, content);
}

function isUnresolvedProfile(content: string): boolean {
  return content.trim().length === 0 || /\bTODO\b/i.test(content);
}

function supportedAgents(agents: ConfirmedAgent[]): Array<{ agent: AgentId; skillsRoot: string }> {
  const supported = agents.flatMap((agent) => {
    if (!agent.supported) return [];
    const adapter = setupAdapters[agent.agent as keyof typeof setupAdapters];
    if (!adapter) return [];
    if (agent.skillsRoot !== null && agent.skillsRoot !== adapter.skillsRoot)
      throw new Error(`Agent ${agent.agent} has a noncanonical skills root.`);
    return [{ agent: agent.agent, skillsRoot: adapter.skillsRoot }];
  });

  if (new Set(supported.map((agent) => agent.agent)).size !== supported.length)
    throw new Error('Duplicate supported agent.');
  if (new Set(supported.map((agent) => agent.skillsRoot)).size !== supported.length)
    throw new Error('Duplicate supported skills root.');

  return supported.sort((left, right) => lexicographically(left.agent, right.agent));
}

function releaseCompletenessReasons(lock: InstallationLock, latest: SkillsRelease): string[] {
  if (lock.release !== latest.release) return [];

  const reasons: string[] = [];
  if (lock.revision !== latest.revision)
    reasons.push('Lock revision does not match the validated release.');
  if (lock.releaseLockHash !== latest.releaseLockHash)
    reasons.push('Lock release hash does not match the validated release.');

  const skills = new Map(lock.skills.map((skill) => [skill.name, skill]));
  const files = new Map(lock.files.map((file) => [file.path, file]));
  const latestSkillNames = new Set(latest.skills.map((skill) => skill.name));
  for (const skill of latest.skills) {
    const lockedSkill = skills.get(skill.name);
    if (!lockedSkill) {
      reasons.push(`Lock does not declare skill ${skill.name}.`);
      continue;
    }
    if (lockedSkill.version !== skill.version)
      reasons.push(`Lock version for ${skill.name} does not match the validated release.`);

    for (const agent of lock.agents) {
      for (const file of skill.files) {
        const path = `${agent.skillsRoot}/${skill.name}/${file.path}`;
        const lockedFile = files.get(path);
        if (!lockedFile) {
          reasons.push(`Lock does not declare ${path}.`);
        } else if (lockedFile.sourceHash !== file.hash || lockedFile.hash !== file.hash) {
          reasons.push(`Lock hashes for ${path} do not match the validated release.`);
        }
      }
    }
  }
  for (const skill of lock.skills) {
    if (!latestSkillNames.has(skill.name))
      reasons.push(`Lock declares unknown skill ${skill.name}.`);
  }
  return reasons;
}

function validateRelease(release: SkillsRelease): void {
  const names = new Set<string>();
  for (const skill of release.skills) {
    if (
      !/^[a-z0-9][a-z0-9-]*$/.test(skill.name) ||
      skill.version.length === 0 ||
      names.has(skill.name)
    )
      throw new Error('Invalid skills release.');
    names.add(skill.name);

    const files = new Set<string>();
    for (const file of skill.files) {
      assertSafeRelativePath(file.path);
      if (files.has(file.path) || sha256(file.content) !== file.hash)
        throw new Error('Invalid skills release.');
      files.add(file.path);
    }
    if (files.size === 0) throw new Error('Invalid skills release.');
  }
}

function validateConfiguration(
  configuration: InstallationConfiguration[],
): InstallationConfiguration[] {
  const files = new Set<string>();
  let profile: string | undefined;
  for (const file of configuration) {
    assertSafeRelativePath(file.path);
    if (!file.path.startsWith('.fieldnote/') || file.path === lockPath || files.has(file.path))
      throw new Error('Invalid Fieldnote configuration path.');
    files.add(file.path);
    if (file.path === profilePath) profile = file.content;
  }
  if (profile === undefined || isUnresolvedProfile(profile))
    throw new Error('Profile contains unresolved required values.');
  assertCompleteConfiguration(new Map(configuration.map((file) => [file.path, file.content])));
  return [...configuration].sort((left, right) => lexicographically(left.path, right.path));
}

export function renderInstallation(input: RenderInstallationInput): RenderedInstallation {
  if (input.setupRunId.length === 0) throw new Error('Setup run ID is required.');
  validateRelease(input.release);
  const agents = supportedAgents(input.agents);
  const configuration = validateConfiguration(input.configuration);
  const files = new Map<string, string>();
  const lockedFiles: InstallationLock['files'] = [];

  for (const file of configuration) {
    addFile(files, file.path, file.content);
    const hash = sha256(file.content);
    lockedFiles.push({ path: file.path, sourceHash: hash, hash });
  }

  for (const agent of agents) {
    for (const skill of [...input.release.skills].sort((left, right) =>
      lexicographically(left.name, right.name),
    )) {
      for (const file of [...skill.files].sort((left, right) =>
        lexicographically(left.path, right.path),
      )) {
        const path = `${agent.skillsRoot}/${skill.name}/${file.path}`;
        addFile(files, path, file.content);
        lockedFiles.push({ path, sourceHash: file.hash, hash: sha256(file.content) });
      }
    }
  }

  const lock: InstallationLock = {
    version: 1,
    release: input.release.release,
    revision: input.release.revision,
    releaseLockHash: input.release.releaseLockHash,
    setupRunId: input.setupRunId,
    agents,
    skills: input.release.skills.map(({ name, version }) => ({ name, version })),
    files: lockedFiles,
  };
  const lockContent = renderInstallationLock(lock);
  addFile(files, lockPath, lockContent);

  return { files: sortedMap(files), lockHash: sha256(lockContent) };
}

function observation(
  snapshot: InstallationSnapshot,
  lock: InstallationLock | null,
  lockHash: string,
  state: InstallationObservation['state'],
  reasons: string[],
): InstallationObservation {
  return {
    state,
    release: lock?.release ?? 'unknown',
    revision: lock?.revision ?? 'unknown',
    lockHash,
    agents:
      lock?.agents.map((agent) => ({
        agent: agent.agent as AgentId,
        supported: true,
        skillsRoot: agent.skillsRoot,
      })) ?? [],
    commitSha: snapshot.commitSha,
    reasons,
  };
}

export function verifyInstallation(
  snapshot: InstallationSnapshot,
  latest: SkillsRelease,
): InstallationObservation {
  const lockContent = snapshot.files.get(lockPath);
  if (lockContent === undefined)
    return observation(snapshot, null, '', 'partial', [`Missing ${lockPath}.`]);

  const lockHash = sha256(lockContent);
  let lock: InstallationLock;
  try {
    lock = parseInstallationLock(lockContent);
  } catch {
    return observation(snapshot, null, lockHash, 'partial', [
      'Invalid .fieldnote/skills.lock.json.',
    ]);
  }

  const missing: string[] = [];
  const drifted: string[] = [];
  const incomplete = releaseCompletenessReasons(lock, latest);
  missing.push(...configurationProblems(snapshot.files));
  for (const path of requiredConfiguration)
    if (!lock.files.some((file) => file.path === path))
      missing.push(`Lock does not declare ${path}.`);
  for (const file of lock.files) {
    const content = snapshot.files.get(file.path);
    if (content === undefined) {
      missing.push(`Missing ${file.path}.`);
    } else if (sha256(content) !== file.hash) {
      drifted.push(`Hash mismatch for ${file.path}.`);
    }
  }

  if (!lock.files.some((file) => file.path === profilePath))
    missing.push(`Lock does not declare ${profilePath}.`);
  const profile = snapshot.files.get(profilePath);
  if (profile === undefined) {
    if (!missing.includes(`Missing ${profilePath}.`)) missing.push(`Missing ${profilePath}.`);
  } else if (isUnresolvedProfile(profile)) {
    missing.push('Profile contains unresolved required values.');
  }

  if (incomplete.length > 0 || missing.length > 0)
    return observation(snapshot, lock, lockHash, 'partial', [
      ...incomplete,
      ...missing,
      ...drifted,
    ]);
  if (drifted.length > 0) return observation(snapshot, lock, lockHash, 'drifted', drifted);
  return observation(
    snapshot,
    lock,
    lockHash,
    lock.release === latest.release ? 'current' : 'outdated',
    [],
  );
}
