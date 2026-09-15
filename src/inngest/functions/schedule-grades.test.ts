import { beforeEach, expect, test, vi } from 'vitest';

const schedules = vi.hoisted(() => ({ scheduleAvailable: vi.fn(), listGradeSchedules: vi.fn() }));
const runs = vi.hoisted(() => ({
  scheduleGrade: vi.fn(),
  activeGradeRun: vi.fn(),
  latestFinishedGrade: vi.fn(),
  confirmGrade: vi.fn(),
}));
const github = vi.hoisted(() => ({ resolveHeadSha: vi.fn() }));
const graders = vi.hoisted(() => ({ installedGrader: vi.fn() }));
vi.mock('../../db/queries/grade-schedules', () => schedules);
vi.mock('../../db/queries/grade-runs', () => runs);
vi.mock('../../db/queries/graders', () => graders);
vi.mock('../../github/collect-files', () => github);
const sandbox = vi.hoisted(() => ({ selectSandbox: vi.fn() }));
vi.mock('../../grading/sandbox', () => sandbox);

const { scheduleIfDue } = await import('./schedule-grades');
const {
  AGENT_READINESS,
  agentReadinessManifest,
} = await import('../../domain/grading/graders/agent-readiness');
const { DELIVERY_HEALTH, deliveryHealthManifest } = await import(
  '../../domain/grading/graders/delivery-health'
);
const { TEST_DISCIPLINE, testDisciplineManifest } = await import(
  '../../domain/grading/graders/test-discipline'
);
const { SandboxUnavailableError } = await import('../../grading/sandbox/errors');

const readinessRow = {
  repositoryId: 'repo-1',
  graderId: AGENT_READINESS,
  enabledBy: 'user-1',
  workspaceId: 'workspace-1',
};
const deliveryRow = { ...readinessRow, graderId: DELIVERY_HEALTH };
const codeRow = { ...readinessRow, graderId: TEST_DISCIPLINE };

// Wraps a manifest the way installedGrader() would for a workspace that
// installed it — only `manifest` is read by scheduleIfDue.
function installedAs(manifest: { id: string; version: string }) {
  return {
    manifest,
    version: manifest.version,
    consentedNeeds: 'consented',
    verifiedAt: null,
    withdrawnAt: null,
    latestVersion: manifest.version,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  schedules.scheduleAvailable.mockResolvedValue(true);
  runs.activeGradeRun.mockResolvedValue(false);
  runs.latestFinishedGrade.mockResolvedValue(null);
  runs.scheduleGrade.mockResolvedValue({ id: 'run-1', state: 'queued' });
  github.resolveHeadSha.mockResolvedValue('a'.repeat(40));
  sandbox.selectSandbox.mockReturnValue({});
  graders.installedGrader.mockImplementation(async (_workspaceId: string, graderId: string) => {
    if (graderId === AGENT_READINESS) return installedAs(agentReadinessManifest);
    if (graderId === DELIVERY_HEALTH) return installedAs(deliveryHealthManifest);
    if (graderId === TEST_DISCIPLINE) return installedAs(testDisciplineManifest);
    return null;
  });
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
    id: 'run-old',
    sha: 'a'.repeat(40),
    rubricVersion: agentReadinessManifest.version,
  });
  expect(await scheduleIfDue(readinessRow)).toBeNull();
  expect(runs.scheduleGrade).not.toHaveBeenCalled();
});

test('a repository grader runs when the head sha moved', async () => {
  runs.latestFinishedGrade.mockResolvedValue({
    id: 'run-old',
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

test('a grader the workspace no longer has installed is skipped, and its row survives', async () => {
  graders.installedGrader.mockResolvedValue(null);
  expect(await scheduleIfDue(readinessRow)).toBeNull();
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
  runs.latestFinishedGrade.mockResolvedValue({
    id: 'run-old',
    sha: 'a'.repeat(40),
    rubricVersion: '0.0.9',
  });
  expect(await scheduleIfDue(readinessRow)).toBe('run-1');
});

test('the skip is keyed off the evidence labels, not the subject field', async () => {
  // A with-commits grader skips an unchanged commit at the same version...
  runs.latestFinishedGrade.mockResolvedValue({
    id: 'run-old',
    sha: 'a'.repeat(40),
    rubricVersion: agentReadinessManifest.version,
  });
  expect(await scheduleIfDue(readinessRow)).toBeNull();
  // ...and an over-time grader never asks.
  expect(await scheduleIfDue(deliveryRow)).toBe('run-1');
  expect(runs.latestFinishedGrade).toHaveBeenCalledTimes(1);
});

test('a code grader is skipped, and its row kept, when no sandbox can be selected', async () => {
  sandbox.selectSandbox.mockImplementation(() => {
    throw new SandboxUnavailableError(false);
  });
  expect(await scheduleIfDue(codeRow)).toBeNull();
  expect(github.resolveHeadSha).not.toHaveBeenCalled();
  expect(runs.scheduleGrade).not.toHaveBeenCalled();
});

test('a code grader is scheduled when a sandbox can be selected', async () => {
  expect(await scheduleIfDue(codeRow)).toBe('run-1');
  expect(sandbox.selectSandbox).toHaveBeenCalled();
});

test('a declarative grader is scheduled without asking for a sandbox', async () => {
  sandbox.selectSandbox.mockImplementation(() => {
    throw new SandboxUnavailableError(false);
  });
  expect(await scheduleIfDue(readinessRow)).toBe('run-1');
  expect(await scheduleIfDue(deliveryRow)).toBe('run-1');
  expect(sandbox.selectSandbox).not.toHaveBeenCalled();
});

test('a skip confirms the finished run it matched', async () => {
  runs.latestFinishedGrade.mockResolvedValue({
    id: 'run-old',
    sha: 'a'.repeat(40),
    rubricVersion: agentReadinessManifest.version,
  });
  expect(await scheduleIfDue(readinessRow)).toBeNull();
  expect(runs.confirmGrade).toHaveBeenCalledWith('run-old');
});

test('a run that is scheduled is not confirmed', async () => {
  runs.latestFinishedGrade.mockResolvedValue({
    id: 'run-old',
    sha: 'b'.repeat(40),
    rubricVersion: agentReadinessManifest.version,
  });
  expect(await scheduleIfDue(readinessRow)).toBe('run-1');
  expect(runs.confirmGrade).not.toHaveBeenCalled();
});

test('a grader whose evidence changes over time confirms nothing', async () => {
  expect(await scheduleIfDue(deliveryRow)).toBe('run-1');
  expect(runs.confirmGrade).not.toHaveBeenCalled();
});

// latestFinishedGrade() is the latest run that *finished*, scored or not. When
// an insufficient run is the latest and the head has not moved, the skip
// confirms that run — and only that run. The older complete run the public
// page still shows is not confirmed by it and goes on ageing, which is what
// makes a repository whose grader keeps coming back empty eventually read
// `stale` rather than fresh forever.
test('a skip confirms the later insufficient run it matched, not the older scored one', async () => {
  runs.latestFinishedGrade.mockResolvedValue({
    id: 'run-insufficient',
    sha: 'a'.repeat(40),
    rubricVersion: agentReadinessManifest.version,
  });
  expect(await scheduleIfDue(readinessRow)).toBeNull();
  expect(runs.confirmGrade).toHaveBeenCalledTimes(1);
  expect(runs.confirmGrade).toHaveBeenCalledWith('run-insufficient');
  expect(runs.confirmGrade).not.toHaveBeenCalledWith('run-scored');
});
