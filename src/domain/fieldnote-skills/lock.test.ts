import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { parseInstallationLock, renderInstallationLock, type InstallationLock } from './lock';

const sha256 = (value: string): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

const lock: InstallationLock = {
  version: 1,
  release: 'skills-v0.1.0',
  revision: 'a'.repeat(40),
  releaseLockHash: sha256('published-lock'),
  setupRunId: 'run-1',
  agents: [{ agent: 'codex', skillsRoot: '.agents/skills' }],
  skills: [{ name: 'fieldnote-testing', version: '0.1.0' }],
  files: [
    {
      path: '.agents/skills/fieldnote-testing/SKILL.md',
      sourceHash: sha256('upstream skill'),
      hash: sha256('upstream skill'),
    },
  ],
};

describe('installation lock', () => {
  test('renders the complete version-one lock deterministically', () => {
    const rendered = renderInstallationLock(lock);

    expect(rendered).toBe(
      `${JSON.stringify(lock, null, 2)}\n`,
    );
    expect(parseInstallationLock(rendered)).toEqual(lock);
  });

  test('rejects an invalid lock schema or malformed destination hash', () => {
    expect(() => parseInstallationLock(JSON.stringify({ ...lock, version: 2 }))).toThrow();
    expect(() =>
      parseInstallationLock(
        JSON.stringify({
          ...lock,
          files: [{ ...lock.files[0], hash: 'sha256:not-a-hash' }],
        }),
      ),
    ).toThrow();
  });

  test('rejects duplicate and unsafe lock paths', () => {
    expect(() =>
      parseInstallationLock(JSON.stringify({ ...lock, files: [lock.files[0], lock.files[0]] })),
    ).toThrow();
    expect(() =>
      parseInstallationLock(
        JSON.stringify({
          ...lock,
          files: [{ ...lock.files[0], path: '.agents/skills/../outside.md' }],
        }),
      ),
    ).toThrow();
  });
});
