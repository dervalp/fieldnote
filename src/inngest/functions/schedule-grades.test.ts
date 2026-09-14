import { beforeEach, expect, test, vi } from 'vitest';

const schedules = vi.hoisted(() => ({ scheduleAvailable: vi.fn(), listGradeSchedules: vi.fn() }));
const runs = vi.hoisted(() => ({
  scheduleGrade: vi.fn(),
  activeGradeRun: vi.fn(),
  latestFinishedGrade: vi.fn(),
}));
const github = vi.hoisted(() => ({ resolveHeadSha: vi.fn() }));
vi.mock('../../db/queries/grade-schedules', () => schedules);
vi.mock('../../db/queries/grade-runs', () => runs);
vi.mock('../../github/collect-files', () => github);

const { scheduleIfDue } = await import('./schedule-grades');
const {
  AGENT_READINESS,
  agentReadinessManifest,
} = await import('../../domain/grading/graders/agent-readiness');
const { DELIVERY_HEALTH } = await import('../../domain/grading/graders/delivery-health');

const readinessRow = {
  repositoryId: 'repo-1',
  graderId: AGENT_READINESS,
  enabledBy: 'user-1',
  workspaceId: 'workspace-1',
};
const deliveryRow = { ...readinessRow, graderId: DELIVERY_HEALTH };

beforeEach(() => {
  vi.resetAllMocks();
  schedules.scheduleAvailable.mockResolvedValue(true);
  runs.activeGradeRun.mockResolvedValue(false);
  runs.latestFinishedGrade.mockResolvedValue(null);
  runs.scheduleGrade.mockResolvedValue({ id: 'run-1', state: 'queued' });
  github.resolveHeadSha.mockResolvedValue('a'.repeat(40));
});

test('an unavailable repository or a paused schedule creates nothing', async () => {
  schedules.scheduleAvailable.mockResolvedValue(false);
  expect(await scheduleIfDue(readinessRow)).toBeNull();
  expect(runs.scheduleGrade).not.toHaveBeenCalled();
  expect(github.resolveHeadSha).not.toHaveBeenCalled();
});

test('an active run creates nothing', async () => {
  runs.activeGradeRun.mockResolvedValue(true);
  expect(await scheduleIfDue(readinessRow)).toBeNull();
  expect(runs.scheduleGrade).not.toHaveBeenCalled();
});

test('a repository grader skips an unchanged head sha', async () => {
  runs.latestFinishedGrade.mockResolvedValue({
    sha: 'a'.repeat(40),
    rubricVersion: agentReadinessManifest.version,
  });
  expect(await scheduleIfDue(readinessRow)).toBeNull();
  expect(runs.scheduleGrade).not.toHaveBeenCalled();
});

test('a repository grader runs when the head sha moved', async () => {
  runs.latestFinishedGrade.mockResolvedValue({
    sha: 'b'.repeat(40),
    rubricVersion: agentReadinessManifest.version,
  });
  expect(await scheduleIfDue(readinessRow)).toBe('run-1');
  expect(runs.scheduleGrade).toHaveBeenCalledWith(readinessRow);
});

test('a repository grader runs when nothing has ever scored', async () => {
  expect(await scheduleIfDue(readinessRow)).toBe('run-1');
});

test('a window grader always runs and never looks up a sha', async () => {
  expect(await scheduleIfDue(deliveryRow)).toBe('run-1');
  expect(github.resolveHeadSha).not.toHaveBeenCalled();
  expect(runs.scheduleGrade).toHaveBeenCalledWith(deliveryRow);
});

test('an unknown grader is skipped rather than thrown', async () => {
  expect(await scheduleIfDue({ ...readinessRow, graderId: 'nobody/nothing' })).toBeNull();
  expect(runs.scheduleGrade).not.toHaveBeenCalled();
});

test('nothing is scheduled under DEMO_MODE', async () => {
  const previous = process.env.DEMO_MODE;
  process.env.DEMO_MODE = 'true';
  try {
    // scheduleAvailable() is the guard, and it is the first thing consulted.
    schedules.scheduleAvailable.mockImplementation(
      async () => process.env.DEMO_MODE !== 'true',
    );
    expect(await scheduleIfDue(readinessRow)).toBeNull();
    expect(runs.scheduleGrade).not.toHaveBeenCalled();
  } finally {
    process.env.DEMO_MODE = previous;
  }
});

test('a sha lookup failure skips this schedule and not the whole pass', async () => {
  github.resolveHeadSha.mockRejectedValue(new Error('GitHub is unavailable'));
  expect(await scheduleIfDue(readinessRow)).toBeNull();
  expect(runs.scheduleGrade).not.toHaveBeenCalled();
});

test('a repository grader runs on an unchanged commit when its version moved', async () => {
  runs.latestFinishedGrade.mockResolvedValue({ sha: 'a'.repeat(40), rubricVersion: '0.0.9' });
  expect(await scheduleIfDue(readinessRow)).toBe('run-1');
});

test('the skip is keyed off the evidence labels, not the subject field', async () => {
  // A with-commits grader skips an unchanged commit at the same version...
  runs.latestFinishedGrade.mockResolvedValue({
    sha: 'a'.repeat(40),
    rubricVersion: agentReadinessManifest.version,
  });
  expect(await scheduleIfDue(readinessRow)).toBeNull();
  // ...and an over-time grader never asks.
  expect(await scheduleIfDue(deliveryRow)).toBe('run-1');
  expect(runs.latestFinishedGrade).toHaveBeenCalledTimes(1);
});
