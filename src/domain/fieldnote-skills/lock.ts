import { createHash } from 'node:crypto';

export interface LockedAgent {
  agent: string;
  skillsRoot: string;
}

export interface LockedSkill {
  name: string;
  version: string;
}

export interface LockedFile {
  path: string;
  sourceHash: `sha256:${string}`;
  hash: `sha256:${string}`;
}

export interface InstallationLock {
  version: 1;
  release: string;
  revision: string;
  releaseLockHash: `sha256:${string}`;
  setupRunId: string;
  agents: LockedAgent[];
  skills: LockedSkill[];
  files: LockedFile[];
}

const hashPattern = /^sha256:[a-f0-9]{64}$/;
const revisionPattern = /^[a-f0-9]{40}$/;
const skillNamePattern = /^[a-z0-9][a-z0-9-]*$/;

export function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function assertSafeRelativePath(path: string): void {
  if (
    path.length === 0 ||
    path.includes('\0') ||
    path.startsWith('/') ||
    path.startsWith('\\') ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.includes('\\')
  ) {
    throw new Error('Unsafe repository path.');
  }

  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error('Unsafe repository path.');
  }
}

function assertHash(value: unknown): asserts value is `sha256:${string}` {
  if (typeof value !== 'string' || !hashPattern.test(value)) throw new Error('Invalid installation lock.');
}

function assertString(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid installation lock.');
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid installation lock.');
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid installation lock.');
  return value;
}

function assertNoDuplicates(values: string[]): void {
  if (new Set(values).size !== values.length) throw new Error('Invalid installation lock.');
}

function lexicographically(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareBy<T>(value: (item: T) => string): (left: T, right: T) => number {
  return (left, right) => lexicographically(value(left), value(right));
}

function canonicalize(lock: InstallationLock): InstallationLock {
  if (
    lock.version !== 1 ||
    lock.release.length === 0 ||
    !revisionPattern.test(lock.revision) ||
    lock.setupRunId.length === 0
  ) {
    throw new Error('Invalid installation lock.');
  }
  assertHash(lock.releaseLockHash);

  const agents = lock.agents.map((agent) => {
    assertString(agent.agent);
    assertString(agent.skillsRoot);
    if (agent.agent.length === 0) throw new Error('Invalid installation lock.');
    assertSafeRelativePath(agent.skillsRoot);
    return { agent: agent.agent, skillsRoot: agent.skillsRoot };
  });
  assertNoDuplicates(agents.map((agent) => agent.agent));
  assertNoDuplicates(agents.map((agent) => agent.skillsRoot));

  const skills = lock.skills.map((skill) => {
    assertString(skill.name);
    assertString(skill.version);
    if (!skillNamePattern.test(skill.name) || skill.version.length === 0)
      throw new Error('Invalid installation lock.');
    return { name: skill.name, version: skill.version };
  });
  assertNoDuplicates(skills.map((skill) => skill.name));

  const files = lock.files.map((file) => {
    assertString(file.path);
    assertSafeRelativePath(file.path);
    assertHash(file.sourceHash);
    assertHash(file.hash);
    return { path: file.path, sourceHash: file.sourceHash, hash: file.hash };
  });
  assertNoDuplicates(files.map((file) => file.path));

  return {
    version: 1,
    release: lock.release,
    revision: lock.revision,
    releaseLockHash: lock.releaseLockHash,
    setupRunId: lock.setupRunId,
    agents: agents.sort(compareBy((agent) => agent.agent)),
    skills: skills.sort(compareBy((skill) => skill.name)),
    files: files.sort(compareBy((file) => file.path)),
  };
}

export function renderInstallationLock(lock: InstallationLock): string {
  return `${JSON.stringify(canonicalize(lock), null, 2)}\n`;
}

export function parseInstallationLock(content: string): InstallationLock {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Invalid installation lock.');
  }

  const value = object(parsed);
  if (value.version !== 1) throw new Error('Invalid installation lock.');
  assertString(value.release);
  assertString(value.revision);
  assertHash(value.releaseLockHash);
  assertString(value.setupRunId);

  const agents = array(value.agents).map((entry) => {
    const agent = object(entry);
    assertString(agent.agent);
    assertString(agent.skillsRoot);
    return { agent: agent.agent, skillsRoot: agent.skillsRoot };
  });
  const skills = array(value.skills).map((entry) => {
    const skill = object(entry);
    assertString(skill.name);
    assertString(skill.version);
    return { name: skill.name, version: skill.version };
  });
  const files = array(value.files).map((entry) => {
    const file = object(entry);
    assertString(file.path);
    assertHash(file.sourceHash);
    assertHash(file.hash);
    return { path: file.path, sourceHash: file.sourceHash, hash: file.hash };
  });

  return canonicalize({
    version: 1,
    release: value.release,
    revision: value.revision,
    releaseLockHash: value.releaseLockHash,
    setupRunId: value.setupRunId,
    agents,
    skills,
    files,
  });
}
