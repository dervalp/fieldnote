import { beforeEach, expect, test, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  load: vi.fn(),
  validate: vi.fn(),
  fail: vi.fn(),
  pin: vi.fn(),
  complete: vi.fn(),
  grade: vi.fn(),
  sha: vi.fn(),
}));

vi.mock('../../db/queries/authoring-runs', () => ({
  loadAuthoringRun: deps.load,
  validateAuthoringRun: deps.validate,
  failAuthoringRun: deps.fail,
  beginAuthoring: vi.fn(),
  pinAuthoringSha: deps.pin,
  completeAuthoringRun: deps.complete,
}));
vi.mock('../../db/queries/grade-runs', () => ({ latestCompletedGrade: deps.grade }));
vi.mock('../../github/collect-files', () => ({ resolveHeadSha: deps.sha }));

import { explorePlan, resolvePlanCommit } from './plan-repository';

const running = { id: 'run', repositoryId: 'repo', state: 'running', sha: 'c'.repeat(40) };

const failingGrade = {
  checks: [
    {
      id: 'root-agent-instructions',
      status: 'fail',
      explanation: 'No nonempty root AGENTS.md or CLAUDE.md was found.',
      points: 0,
      maxPoints: 20,
      paths: [],
      lineRanges: [],
    },
    {
      id: 'root-readme',
      status: 'pass',
      explanation: 'Found a root README.md.',
      points: 20,
      maxPoints: 20,
      paths: [],
      lineRanges: [],
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  deps.load.mockResolvedValue(running);
  deps.validate.mockResolvedValue(undefined);
  deps.grade.mockResolvedValue(failingGrade);
});

test('writes one remedy per failing check and completes the run', async () => {
  await explorePlan('run');
  expect(deps.complete).toHaveBeenCalledWith('run', [
    {
      checkId: 'root-agent-instructions',
      path: 'AGENTS.md',
      rationale: 'No nonempty root AGENTS.md or CLAUDE.md was found.',
      ordinal: 0,
    },
  ]);
});

test('fails the run when authorization was revoked, and does not complete it', async () => {
  deps.validate.mockRejectedValue(new Error('Plan access revoked'));
  await expect(explorePlan('run')).rejects.toThrow();
  expect(deps.fail).toHaveBeenCalledWith('run', 'access_revoked');
  expect(deps.complete).not.toHaveBeenCalled();
});

test('fails the run when the grade it was queued against has gone', async () => {
  deps.grade.mockResolvedValue(null);
  await explorePlan('run');
  expect(deps.fail).toHaveBeenCalledWith('run', 'grade_missing');
  expect(deps.complete).not.toHaveBeenCalled();
});

test('fails the run rather than completing empty when nothing is left to fix', async () => {
  deps.grade.mockResolvedValue({ checks: [failingGrade.checks[1]] });
  await explorePlan('run');
  expect(deps.fail).toHaveBeenCalledWith('run', 'nothing_to_fix');
  expect(deps.complete).not.toHaveBeenCalled();
});

test('does nothing for a run that already finished', async () => {
  deps.load.mockResolvedValue({ ...running, state: 'complete' });
  await explorePlan('run');
  expect(deps.complete).not.toHaveBeenCalled();
  expect(deps.fail).not.toHaveBeenCalled();
});

test('resolves and pins the commit, and reuses one already pinned', async () => {
  deps.load.mockResolvedValue({ ...running, sha: null });
  deps.sha.mockResolvedValue('d'.repeat(40));
  deps.pin.mockResolvedValue('d'.repeat(40));
  expect(await resolvePlanCommit('run')).toBe('d'.repeat(40));
  deps.load.mockResolvedValue(running);
  expect(await resolvePlanCommit('run')).toBe('c'.repeat(40));
  expect(deps.sha).toHaveBeenCalledTimes(1);
});
