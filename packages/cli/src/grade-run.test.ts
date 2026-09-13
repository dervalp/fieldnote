import { afterEach, describe, expect, it, vi } from 'vitest';
import { gradeRun } from './grade-run.ts';
import { ApiError, type GradeComplete } from './api.ts';

const { readGitState, gradeBlocker, requestGradeRun, pollGradeRun } = vi.hoisted(() => ({
  readGitState: vi.fn(),
  gradeBlocker: vi.fn(),
  requestGradeRun: vi.fn(),
  pollGradeRun: vi.fn(),
}));
vi.mock('./git.ts', () => ({ readGitState, gradeBlocker }));
vi.mock('./api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api.ts')>()),
  requestGradeRun,
  pollGradeRun,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

const CLEAN_STATE = {
  slug: 'dervalp/fieldnote',
  sha: 'a'.repeat(40),
  dirtyCount: 0,
  unpushedCount: 0,
  hasUpstream: true,
};

const REQUESTED = {
  runId: 'r1',
  graderId: 'agent-brief',
  mode: 'deterministic' as const,
  requestedSha: CLEAN_STATE.sha,
};

function completeFixture(overrides: Partial<GradeComplete> = {}): GradeComplete {
  return {
    state: 'complete',
    score: 92,
    checks: [],
    titles: {},
    graderId: 'agent-brief',
    graderVersion: '1',
    rubricVersion: '1',
    evaluatorVersion: '1',
    mode: 'deterministic',
    tagline: 'reads like a brief',
    disclaimer: 'This grader uses a language model.',
    gradedSha: CLEAN_STATE.sha,
    presentation: { label: 'Solid', finish: 'green' },
    nextTier: null,
    url: 'https://fieldnote.dev/g/1',
    ...overrides,
  };
}

const baseOptions = { base: 'http://x', token: 't', cwd: '/repo' };

describe('gradeRun — the work-in-progress guard', () => {
  it('reports a blocker verbatim when not bypassed', async () => {
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue({ reason: 'dirty', lines: ['  3 files changed'] });
    const outcome = await gradeRun(baseOptions);
    expect(outcome).toEqual({ kind: 'blocked', reason: 'dirty', lines: ['  3 files changed'] });
    expect(requestGradeRun).not.toHaveBeenCalled();
  });

  it('--sha bypasses a dirty or unpushed blocker', async () => {
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue({ reason: 'unpushed', lines: ['  unpushed'] });
    requestGradeRun.mockResolvedValue({ ...REQUESTED, requestedSha: 'deadbeef' });
    pollGradeRun.mockResolvedValue(completeFixture({ gradedSha: 'deadbeef' }));
    const outcome = await gradeRun({ ...baseOptions, sha: 'deadbeef' });
    expect(outcome.kind).toBe('graded');
  });

  it('--sha never bypasses no-remote or not-a-repo — there is no slug to bypass into', async () => {
    readGitState.mockResolvedValue({ ...CLEAN_STATE, slug: null });
    gradeBlocker.mockReturnValue({ reason: 'no-remote', lines: ['  no remote'] });
    const outcome = await gradeRun({ ...baseOptions, sha: 'deadbeef' });
    expect(outcome).toEqual({ kind: 'blocked', reason: 'no-remote', lines: ['  no remote'] });
    expect(requestGradeRun).not.toHaveBeenCalled();
  });
});

describe('gradeRun — requestedSha', () => {
  it('comes from the POST echo, not a local recomputation of --sha', async () => {
    // git.ts's own blocker copy suggests an abbreviated --sha. If the view
    // were built from a locally recomputed sha rather than the echo, this
    // test could not tell the difference — the echo is deliberately a
    // different string here so only reading the real echo passes it.
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue({ ...REQUESTED, requestedSha: 'deadbeef' });
    pollGradeRun.mockResolvedValue(completeFixture());
    const outcome = await gradeRun(baseOptions);
    if (outcome.kind !== 'graded') throw new Error('expected graded');
    expect(outcome.view.requestedSha).toBe('deadbeef');
  });

  it('slug comes from git state, not from the server', async () => {
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue(completeFixture());
    const outcome = await gradeRun(baseOptions);
    if (outcome.kind !== 'graded') throw new Error('expected graded');
    expect(outcome.view.slug).toBe(CLEAN_STATE.slug);
  });
});

describe('gradeRun — poll outcomes', () => {
  it('classifies a failed poll, keeping the errorCode', async () => {
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue({ state: 'failed', errorCode: 'clone-failed' });
    expect(await gradeRun(baseOptions)).toEqual({ kind: 'failed', errorCode: 'clone-failed' });
  });

  it('classifies a complete poll with no stored result as no-result', async () => {
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue({ state: 'complete' });
    expect(await gradeRun(baseOptions)).toEqual({ kind: 'no-result' });
  });

  it('reports each state transition through onProgress', async () => {
    vi.useFakeTimers();
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun
      .mockResolvedValueOnce({ state: 'queued' })
      .mockResolvedValueOnce(completeFixture());
    const seen: string[] = [];
    const promise = gradeRun({ ...baseOptions, onProgress: (s) => seen.push(s) });
    await vi.advanceTimersByTimeAsync(1_000);
    await promise;
    expect(seen).toEqual(['queued', 'complete']);
  });
});

describe('gradeRun — the poll loop terminates', () => {
  it('gives up after ten minutes of queued/running', async () => {
    vi.useFakeTimers();
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue({ state: 'running' });
    const promise = gradeRun(baseOptions);
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000);
    expect(await promise).toEqual({ kind: 'timeout' });
  });

  it('tolerates a few consecutive transient (exitCode 2) poll failures', async () => {
    vi.useFakeTimers();
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun
      .mockRejectedValueOnce(new ApiError('Could not reach fieldnote. Try again.', 2))
      .mockRejectedValueOnce(new ApiError('Could not reach fieldnote. Try again.', 2))
      .mockResolvedValueOnce(completeFixture());
    const promise = gradeRun(baseOptions);
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await promise).kind).toBe('graded');
  });

  it('does not retry an exitCode 3 poll failure — the token itself was rejected', async () => {
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockRejectedValue(new ApiError('Not signed in.', 3));
    await expect(gradeRun(baseOptions)).rejects.toMatchObject({ exitCode: 3 });
    expect(pollGradeRun).toHaveBeenCalledTimes(1);
  });

  it('propagates once transient failures exceed the retry ceiling', async () => {
    vi.useFakeTimers();
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockRejectedValue(new ApiError('Could not reach fieldnote. Try again.', 2));
    const promise = gradeRun(baseOptions).catch((error) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await promise).toBeInstanceOf(ApiError);
  });

  it('propagates an ApiError thrown by requestGradeRun without retrying', async () => {
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockRejectedValue(new ApiError('fieldnote is not connected to a/b.', 2));
    await expect(gradeRun(baseOptions)).rejects.toMatchObject({
      message: 'fieldnote is not connected to a/b.',
    });
    expect(pollGradeRun).not.toHaveBeenCalled();
  });
});
