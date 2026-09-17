import { beforeEach, expect, test, vi } from 'vitest';
const deps = vi.hoisted(() => ({
  load: vi.fn(),
  authorize: vi.fn(),
  permissions: vi.fn(),
  collect: vi.fn(),
  verify: vi.fn(),
  release: vi.fn(),
  latest: vi.fn(),
  record: vi.fn(),
}));
vi.mock('../client', () => ({
  inngest: { createFunction: (_config: unknown, handler: unknown) => handler },
}));
vi.mock('../../db/queries/fieldnote-installations', () => ({
  loadInstallationVerification: deps.load,
  recordVerifiedInstallation: deps.record,
}));
vi.mock('../../db/queries/authoring-runs', () => ({ validateAuthoringRun: deps.authorize }));
vi.mock('../../github/installation-permissions', () => ({
  fetchGrantedPermissions: deps.permissions,
}));
vi.mock('../../github/verify-fieldnote-installation', async (original) => ({
  ...(await original<typeof import('../../github/verify-fieldnote-installation')>()),
  collectInstallationSnapshot: deps.collect,
  verifyFieldnoteInstallation: deps.verify,
}));
vi.mock('../../fieldnote-skills/github-release', () => ({
  readSkillsRelease: deps.release,
  latestSkillsReleaseTag: deps.latest,
}));
import { verifyFieldnoteInstallationFunction } from './verify-fieldnote-installation';
import { InstallationVerificationError } from '../../github/verify-fieldnote-installation';
const handler = verifyFieldnoteInstallationFunction as unknown as (
  input: unknown,
) => Promise<unknown>;
const durable: unknown[] = [];
const context = {
  event: { data: { authoredPrId: 'pr' } },
  step: {
    run: async (_name: string, work: () => Promise<unknown>) => {
      const result = await work();
      durable.push(result);
      return result;
    },
  },
};
const setup = {
  pr: { id: 'pr', repositoryId: 'repo', number: 42, outcome: 'merged' },
  run: { id: 'run', repositoryId: 'repo' },
  proposal: {
    skillsRelease: 'skills-v0.1.0',
    skillsRevision: 'a'.repeat(40),
    releaseLockHash: 'hash',
    confirmedAgents: [],
  },
  configurationPaths: ['.fieldnote/profile.md'],
};
beforeEach(() => {
  vi.resetAllMocks();
  durable.length = 0;
  deps.load.mockResolvedValue(setup);
  deps.permissions.mockResolvedValue({ contents: 'write', pullRequests: 'write' });
  deps.collect.mockResolvedValue({
    commitSha: 'sha',
    complete: true,
    files: new Map([['private', 'private raw source']]),
  });
  deps.release.mockResolvedValue({
    release: 'skills-v0.1.0',
    revision: 'a'.repeat(40),
    releaseLockHash: 'hash',
  });
  deps.latest.mockResolvedValue('skills-v0.2.0');
  deps.verify.mockReturnValue({ state: 'outdated', commitSha: 'sha' });
});
test('records only a fresh verified default scan and keeps source out of durable results', async () => {
  await handler(context);
  expect(deps.record).toHaveBeenCalledWith('pr', { state: 'outdated', commitSha: 'sha' });
  expect(deps.authorize).toHaveBeenCalledWith(setup.run);
  expect(deps.collect).toHaveBeenCalledWith('repo', 42, setup.configurationPaths);
  expect(JSON.stringify(durable)).not.toContain('private');
});
test.each(['open', 'closed'])('does not verify a %s authored PR', async (outcome) => {
  deps.load.mockResolvedValue({ ...setup, pr: { ...setup.pr, outcome } });
  await handler(context);
  expect(deps.collect).not.toHaveBeenCalled();
  expect(deps.record).not.toHaveBeenCalled();
});
test('missing and superseded authored PRs do no work', async () => {
  deps.load.mockResolvedValue(null);
  await handler(context);
  expect(deps.collect).not.toHaveBeenCalled();
});
test('permission denial prevents scanning and persistence', async () => {
  deps.permissions.mockResolvedValue({ contents: 'read', pullRequests: 'read' });
  await expect(handler(context)).rejects.toThrow('Installation access unavailable');
  expect(deps.collect).not.toHaveBeenCalled();
  expect(deps.record).not.toHaveBeenCalled();
});
test('merge visibility is retryable and records nothing', async () => {
  deps.collect.mockRejectedValue(new InstallationVerificationError('merge_not_visible'));
  await expect(handler(context)).rejects.toMatchObject({ code: 'merge_not_visible' });
  expect(deps.record).not.toHaveBeenCalled();
});
test('all database and release errors are sanitized', async () => {
  deps.record.mockRejectedValue(new Error('private raw query'));
  await expect(handler(context)).rejects.toThrow(
    'Installation verification temporarily unavailable',
  );
});
test('incomplete default scans leave the previous observation untouched', async () => {
  deps.collect.mockRejectedValue(new InstallationVerificationError('scan_incomplete'));
  await expect(handler(context)).rejects.toMatchObject({
    code: 'scan_incomplete',
    retryable: true,
  });
  expect(deps.record).not.toHaveBeenCalled();
});
test('access is rechecked after scanning and before recording', async () => {
  deps.authorize
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('private database details'));
  await expect(handler(context)).rejects.toThrow(
    'Installation verification temporarily unavailable',
  );
  expect(deps.record).not.toHaveBeenCalled();
});
