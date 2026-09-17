import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { parseInstallationLock } from './lock';
import type { SkillsRelease } from './types';
import { renderInstallation, verifyInstallation } from './render';
import { supportingConfigurationDefaults } from './configuration';

const sha256 = (value: string): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

const upstreamTesting = '# Testing\n\nRun the focused tests.\n';
const upstreamReview = '# Review\n\nInspect the diff.\n';
const completeProfile = '# Repository profile\n\n- Test command: `pnpm test`\n';

const release: SkillsRelease = {
  release: 'skills-v0.1.0',
  revision: 'a'.repeat(40),
  releaseLockHash: sha256('published-lock'),
  skills: [
    {
      name: 'fieldnote-testing',
      version: '0.1.0',
      files: [{ path: 'SKILL.md', content: upstreamTesting, hash: sha256(upstreamTesting) }],
    },
    {
      name: 'fieldnote-review',
      version: '0.1.0',
      files: [{ path: 'SKILL.md', content: upstreamReview, hash: sha256(upstreamReview) }],
    },
  ],
};

const render = (overrides: Partial<Parameters<typeof renderInstallation>[0]> = {}) =>
  renderInstallation({
    release,
    setupRunId: 'run-1',
    agents: [
      { agent: 'codex', supported: true, skillsRoot: '.agents/skills' },
      { agent: 'claude-code', supported: true, skillsRoot: '.claude/skills' },
    ],
    configuration: [
      { path: '.fieldnote/profile.md', content: completeProfile },
      ...supportingConfigurationDefaults,
    ],
    ...overrides,
  });

describe('renderInstallation', () => {
  test('rejects a profile-only installation before it can be published', () => {
    expect(() =>
      render({ configuration: [{ path: '.fieldnote/profile.md', content: completeProfile }] }),
    ).toThrow('Required Fieldnote configuration');
  });
  test('copies every generic release file byte-for-byte to every supported target', () => {
    const rendered = render();

    expect(rendered.files.get('.agents/skills/fieldnote-testing/SKILL.md')).toBe(upstreamTesting);
    expect(rendered.files.get('.claude/skills/fieldnote-testing/SKILL.md')).toBe(upstreamTesting);
    expect(rendered.files.get('.agents/skills/fieldnote-review/SKILL.md')).toBe(upstreamReview);
    expect(rendered.files.get('.claude/skills/fieldnote-review/SKILL.md')).toBe(upstreamReview);
    expect(JSON.parse(rendered.files.get('.fieldnote/skills.lock.json')!)).toMatchObject({
      version: 1,
      release: 'skills-v0.1.0',
      revision: release.revision,
      releaseLockHash: release.releaseLockHash,
      setupRunId: 'run-1',
      agents: [
        { agent: 'claude-code', skillsRoot: '.claude/skills' },
        { agent: 'codex', skillsRoot: '.agents/skills' },
      ],
      skills: [
        { name: 'fieldnote-review', version: '0.1.0' },
        { name: 'fieldnote-testing', version: '0.1.0' },
      ],
    });
  });

  test('sorts rendered paths and lock records independent of input order', () => {
    const first = render();
    const second = render({
      release: { ...release, skills: [...release.skills].reverse() },
      agents: [
        { agent: 'claude-code', supported: true, skillsRoot: '.claude/skills' },
        { agent: 'codex', supported: true, skillsRoot: '.agents/skills' },
      ],
    });

    expect([...first.files.keys()]).toEqual([...first.files.keys()].sort());
    expect([...second.files.entries()]).toEqual([...first.files.entries()]);
    expect(second.lockHash).toBe(first.lockHash);
  });

  test('does not render files for unsupported agents', () => {
    const rendered = render({
      agents: [
        { agent: 'codex', supported: false, skillsRoot: '.custom/skills' },
        { agent: 'claude-code', supported: true, skillsRoot: '.claude/skills' },
        { agent: 'cursor', supported: true, skillsRoot: '.cursor/skills' },
      ],
    });

    expect([...rendered.files.keys()].some((path) => path.startsWith('.agents/'))).toBe(false);
    expect([...rendered.files.keys()].some((path) => path.startsWith('.cursor/'))).toBe(false);
    expect(rendered.files.get('.claude/skills/fieldnote-testing/SKILL.md')).toBe(upstreamTesting);
    expect(JSON.parse(rendered.files.get('.fieldnote/skills.lock.json')!).agents).toEqual([
      { agent: 'claude-code', skillsRoot: '.claude/skills' },
    ]);
  });

  test('rejects a canonical target pointed at a noncanonical skills root', () => {
    expect(() =>
      render({
        agents: [{ agent: 'codex', supported: true, skillsRoot: '.custom/skills' }],
      }),
    ).toThrow();
  });

  test.each([
    ['absolute configuration path', '/.fieldnote/profile.md'],
    ['path traversal in configuration', '.fieldnote/../profile.md'],
    ['NUL in configuration path', '.fieldnote/pro\0file.md'],
  ])('rejects %s', (_name, path) => {
    expect(() => render({ configuration: [{ path, content: completeProfile }] })).toThrow();
  });

  test('rejects configuration outside Fieldnote and duplicate destination paths', () => {
    expect(() =>
      render({ configuration: [{ path: 'profile.md', content: completeProfile }] }),
    ).toThrow();
    expect(() =>
      render({
        configuration: [
          { path: '.fieldnote/profile.md', content: completeProfile },
          { path: '.fieldnote/profile.md', content: completeProfile },
        ],
      }),
    ).toThrow();
  });

  test('rejects unsafe release files and duplicate agent destinations', () => {
    expect(() =>
      render({
        release: {
          ...release,
          skills: [
            {
              ...release.skills[0],
              files: [{ ...release.skills[0].files[0], path: '../SKILL.md' }],
            },
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      render({
        agents: [
          { agent: 'codex', supported: true, skillsRoot: '.agents/skills' },
          { agent: 'claude-code', supported: true, skillsRoot: '.agents/skills' },
        ],
      }),
    ).toThrow();
  });

  test('does not render a profile with unresolved required values', () => {
    expect(() =>
      render({
        configuration: [
          { path: '.fieldnote/profile.md', content: '# Profile\n\nTODO: test command' },
        ],
      }),
    ).toThrow();
  });
});

describe('verifyInstallation', () => {
  test('reports current when every lock-declared copy and profile match', () => {
    const rendered = render();

    expect(
      verifyInstallation({ commitSha: 'commit-1', files: rendered.files }, release),
    ).toMatchObject({
      state: 'current',
      release: 'skills-v0.1.0',
      revision: release.revision,
      lockHash: rendered.lockHash,
      commitSha: 'commit-1',
      reasons: [],
    });
  });

  test('reports a valid older lock as outdated', () => {
    const rendered = render();

    expect(
      verifyInstallation(
        { commitSha: 'commit-1', files: rendered.files },
        { ...release, release: 'skills-v0.2.0' },
      ),
    ).toMatchObject({ state: 'outdated', release: 'skills-v0.1.0', reasons: [] });
  });

  test('reports a modified committed byte as drift', () => {
    const rendered = render();
    const files = new Map(rendered.files);
    files.set('.agents/skills/fieldnote-testing/SKILL.md', '# Modified\n');

    expect(verifyInstallation({ commitSha: 'commit-1', files }, release)).toMatchObject({
      state: 'drifted',
      reasons: expect.arrayContaining([
        'Hash mismatch for .agents/skills/fieldnote-testing/SKILL.md.',
      ]),
    });
  });

  test('reports missing lock-declared files and incomplete profiles as partial', () => {
    const rendered = render();
    const files = new Map(rendered.files);
    files.delete('.agents/skills/fieldnote-testing/SKILL.md');
    files.set('.fieldnote/profile.md', '# Profile\n\nTODO: test command');

    expect(verifyInstallation({ commitSha: 'commit-1', files }, release)).toMatchObject({
      state: 'partial',
      reasons: expect.arrayContaining([
        'Missing .agents/skills/fieldnote-testing/SKILL.md.',
        'Profile contains unresolved required values.',
      ]),
    });
  });

  test('reports a syntactically valid subset lock as partial against the release catalogue', () => {
    const rendered = render();
    const files = new Map(rendered.files);
    const lock = parseInstallationLock(files.get('.fieldnote/skills.lock.json')!);
    const subset = {
      ...lock,
      skills: lock.skills.filter((skill) => skill.name === 'fieldnote-testing'),
      files: lock.files.filter(
        (file) =>
          file.path === '.fieldnote/profile.md' || file.path.includes('/fieldnote-testing/'),
      ),
    };
    files.set('.fieldnote/skills.lock.json', JSON.stringify(subset));

    expect(verifyInstallation({ commitSha: 'commit-1', files }, release)).toMatchObject({
      state: 'partial',
      reasons: expect.arrayContaining(['Lock does not declare skill fieldnote-review.']),
    });
  });
});
