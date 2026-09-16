import { describe, expect, test } from 'vitest';
import type { InstallationObservation } from './types';
import { classifyInstallation } from './classify';

const validObservation = (release: string): InstallationObservation => ({
  state: 'current',
  release,
  revision: 'deadbeef',
  lockHash: 'sha256:lock',
  agents: [{ agent: 'codex', supported: true, skillsRoot: '.agents/skills' }],
  commitSha: 'commit',
  reasons: [],
});

describe('classifyInstallation', () => {
  test('classifies a verified older release as outdated', () => {
    expect(
      classifyInstallation({
        observation: validObservation('skills-v0.1.0'),
        latest: 'skills-v0.2.0',
        openPr: null,
      }),
    ).toEqual({ kind: 'outdated', installed: 'skills-v0.1.0', latest: 'skills-v0.2.0' });
  });

  test('reports a proposal before an unverified observation', () => {
    expect(
      classifyInstallation({
        observation: null,
        latest: 'skills-v0.2.0',
        openPr: { runId: 'run-1', pullRequestUrl: 'https://example.test/pr/1' },
      }),
    ).toEqual({
      kind: 'proposed',
      runId: 'run-1',
      pullRequestUrl: 'https://example.test/pr/1',
    });
  });

  test('preserves incomplete verification reasons', () => {
    expect(
      classifyInstallation({
        observation: { ...validObservation('skills-v0.2.0'), state: 'drifted', reasons: ['hash mismatch'] },
        latest: 'skills-v0.2.0',
        openPr: null,
      }),
    ).toEqual({ kind: 'drifted', release: 'skills-v0.2.0', reasons: ['hash mismatch'] });
  });
});
