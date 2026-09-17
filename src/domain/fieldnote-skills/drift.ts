import { createHash } from 'node:crypto';
import { parseInstallationLock, sha256 } from './lock';
import type { ReleaseFile, SetupRepositorySnapshot, SkillsRelease } from './types';

const lockPath = '.fieldnote/skills.lock.json';
export const gitBlobHash = (content: string) =>
  createHash('sha1')
    .update(`blob ${Buffer.byteLength(content)}\0${content}`)
    .digest('hex');
export function existingInstallationLock(snapshot: SetupRepositorySnapshot) {
  const content = snapshot.documents.find((file) => file.path === lockPath)?.text;
  if (!snapshot.complete) throw new Error('Existing installation evidence is incomplete.');
  if (content === undefined || Buffer.byteLength(content) > 256 * 1024) return null;
  try {
    const lock = parseInstallationLock(content);
    return lock.files.length <= 400 &&
      lock.files.every((file) => file.path.length <= 240 && !/[\x00-\x1f\x7f]/.test(file.path))
      ? { lock, content }
      : null;
  } catch {
    return null;
  }
}

export interface ManagedDriftQuestion {
  key: 'managed-drift';
  text: string;
  evidence: string[];
}
export type SetupNote = {
  speaker: 'agent' | 'human';
  kind: 'finding' | 'question' | 'answer' | 'remark';
  body: string;
};
export const questionNote = (question: { key: string; text: string; evidence: string[] }) =>
  `[${question.key}] ${question.text}\n\n${question.evidence.join('\n')}`;

/** Only a human answer to this exact host-generated, evidence-bound question approves replacement. */
export function hasManagedDriftApproval(
  notes: SetupNote[],
  question: ManagedDriftQuestion,
): boolean {
  const turns = notes.filter((note) => note.kind === 'question' || note.kind === 'answer');
  let approved = false;
  for (let i = 0; i < turns.length; i++) {
    if (
      turns[i].speaker === 'agent' &&
      turns[i].kind === 'question' &&
      turns[i].body === questionNote(question)
    )
      approved =
        turns[i + 1]?.speaker === 'human' &&
        turns[i + 1].kind === 'answer' &&
        /^replace managed skills[.!]?$/i.test(turns[i + 1].body.trim());
  }
  return approved;
}

/** Git blob identities prove exact bytes without exporting generic source into durable output. */
export function managedDriftQuestion(
  snapshot: SetupRepositorySnapshot,
  installed: SkillsRelease | null,
  target: Pick<SkillsRelease, 'release' | 'revision' | 'releaseLockHash'>,
): ManagedDriftQuestion | null {
  const existing = existingInstallationLock(snapshot);
  if (
    !existing ||
    !installed ||
    installed.release !== existing.lock.release ||
    installed.revision !== existing.lock.revision ||
    installed.releaseLockHash !== existing.lock.releaseLockHash
  )
    return partialDriftQuestion(snapshot, target);
  const { lock, content } = existing;
  const reasons: string[] = [];
  const declared = new Map(lock.files.map((file) => [file.path, file]));
  const expected = new Map<string, ReleaseFile>(
    installed.skills.flatMap((skill) =>
      lock.agents.flatMap((agent) =>
        skill.files.map(
          (file) => [`${agent.skillsRoot}/${skill.name}/${file.path}`, file] as const,
        ),
      ),
    ),
  );
  if (expected.size > 400) throw new Error('Existing installation evidence exceeds bounds.');
  const observed: Array<[string, string, string, string]> = [];
  const observe = (path: string) => {
    if (path.length > 240 || /[\x00-\x1f\x7f]/.test(path))
      throw new Error('Existing installation path exceeds bounds.');
    const document = snapshot.documents.find((item) => item.path === path);
    const actual = snapshot.managedFiles
      ? snapshot.managedFiles.find((item) => item.path === path)
      : document
        ? { blobSha: gitBlobHash(document.text), mode: '100644', type: 'blob' }
        : null;
    observed.push([path, actual?.blobSha ?? 'missing', actual?.mode ?? '', actual?.type ?? '']);
    return actual;
  };
  for (const [path, file] of [...expected].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const actual = observe(path);
    const locked = declared.get(path);
    if (locked?.hash !== file.hash || locked?.sourceHash !== file.hash)
      reasons.push(`Lock does not match the installed release for ${path}.`);
    const expectedBlob = gitBlobHash(file.content);
    if (!actual) reasons.push(`Missing managed file: ${path}.`);
    else if (actual.blobSha !== expectedBlob || actual.mode !== '100644' || actual.type !== 'blob')
      reasons.push(
        `Modified managed file: ${path}. Expected Git blob ${expectedBlob} (100644 blob); observed ${actual.blobSha} (${actual.mode} ${actual.type}).`,
      );
  }
  for (const file of lock.files) {
    if (!file.path.startsWith('.fieldnote/') && !expected.has(file.path)) {
      observe(file.path);
      reasons.push(`Unexpected managed file declared in lock: ${file.path}.`);
    }
  }
  if (
    lock.skills.length !== installed.skills.length ||
    installed.skills.some(
      (skill) =>
        !lock.skills.some((item) => item.name === skill.name && item.version === skill.version),
    )
  )
    reasons.push('Installation lock skill inventory does not match the installed release.');
  if (!reasons.length) return null;
  return approvalQuestion(
    target,
    lockIdentity(snapshot, content),
    observed,
    reasons,
    `Managed skills differ from the installed ${installed.release}.`,
  );
}

function partialDriftQuestion(
  snapshot: SetupRepositorySnapshot,
  target: Pick<SkillsRelease, 'release' | 'revision' | 'releaseLockHash'>,
): ManagedDriftQuestion | null {
  const content = snapshot.documents.find((file) => file.path === lockPath)?.text;
  const present =
    content !== undefined ||
    snapshot.paths.includes(lockPath) ||
    Boolean(snapshot.installationLock);
  const managed =
    snapshot.managedFiles ??
    snapshot.documents
      .filter((file) => /^\.(?:agents|claude)\/skills\//.test(file.path))
      .map((file) => ({
        path: file.path,
        blobSha: gitBlobHash(file.text),
        mode: '100644',
        type: 'blob',
      }));
  if (!present && !managed.length) return null;
  if (
    managed.length > 400 ||
    managed.some((file) => file.path.length > 240 || /[\x00-\x1f\x7f]/.test(file.path))
  )
    throw new Error('Existing installation evidence exceeds bounds.');
  const observed = [...managed]
    .sort((a, b) => a.path.localeCompare(b.path, 'en'))
    .map(({ path, blobSha, mode, type }) => [path, blobSha, mode, type]);
  const identity = lockIdentity(snapshot, content);
  return approvalQuestion(
    target,
    identity,
    observed,
    [
      present
        ? `Installation lock is malformed or cannot be verified: ${lockPath}.`
        : `Missing installation lock: ${lockPath}.`,
      `Observed installation lock identity: ${identity}.`,
      ...observed.map(
        ([path, hash, mode, type]) =>
          `Existing managed file: ${path}. Git identity ${hash} (${mode} ${type}).`,
      ),
    ],
    'Existing managed skills have an incomplete or unverifiable installation lock.',
  );
}

function lockIdentity(snapshot: SetupRepositorySnapshot, content: string | undefined): string {
  const metadata = snapshot.installationLock;
  if (metadata) return `Git ${metadata.blobSha} (${metadata.mode} ${metadata.type})`;
  if (content !== undefined) return sha256(content);
  return snapshot.paths.includes(lockPath) ? `unavailable at ${snapshot.sha}` : 'missing';
}

function approvalQuestion(
  target: Pick<SkillsRelease, 'release' | 'revision' | 'releaseLockHash'>,
  identity: string,
  observed: string[][],
  reasons: string[],
  description: string,
): ManagedDriftQuestion {
  const fingerprint = sha256(
    JSON.stringify([[target.release, target.revision, target.releaseLockHash], identity, observed]),
  );
  return {
    key: 'managed-drift',
    text: `${description} Replace these copies with the pinned ${target.release}? Reply exactly "Replace managed skills" to approve, or decline to keep setup paused.`,
    evidence: [
      `Managed-copy approval fingerprint: ${fingerprint}`,
      ...reasons.slice(0, 38),
      ...(reasons.length > 38
        ? [
            `${reasons.length - 38} additional managed differences are included in this approval fingerprint.`,
          ]
        : []),
    ],
  };
}
