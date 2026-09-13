import { afterEach, describe, expect, it, vi } from 'vitest';
import { gradeRun } from './grade-run.ts';
import { ApiError } from './api.ts';
import { CLEAN_STATE, REQUESTED, completeFixture } from './fixtures.ts';

const { readGitState, gradeBlocker, expandSha, requestGradeRun, pollGradeRun } = vi.hoisted(() => ({
  readGitState: vi.fn(),
  gradeBlocker: vi.fn(),
  expandSha: vi.fn(),
  requestGradeRun: vi.fn(),
  pollGradeRun: vi.fn(),
}));
vi.mock('./git.ts', () => ({ readGitState, gradeBlocker, expandSha }));
vi.mock('./api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api.ts')>()),
  requestGradeRun,
  pollGradeRun,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

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
    expandSha.mockResolvedValue('d'.repeat(40));
    requestGradeRun.mockResolvedValue({ ...REQUESTED, requestedSha: 'd'.repeat(40) });
    pollGradeRun.mockResolvedValue(completeFixture({ gradedSha: 'd'.repeat(40) }));
    const outcome = await gradeRun({ ...baseOptions, sha: 'deadbee' });
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

describe('gradeRun — --sha is expanded before it is sent', () => {
  it('sends the 40-character expansion, not the abbreviation the developer typed', async () => {
    // The POST schema is /^[0-9a-f]{40}$/, and the refusal copy in git.ts
    // offers a seven-character sha — so the CLI's own escape hatch, in the
    // exact form the CLI recommends, 400s unless it is expanded here.
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    expandSha.mockResolvedValue('d'.repeat(40));
    requestGradeRun.mockResolvedValue({ ...REQUESTED, requestedSha: 'd'.repeat(40) });
    pollGradeRun.mockResolvedValue(completeFixture());
    await gradeRun({ ...baseOptions, sha: 'deadbee' });
    expect(expandSha).toHaveBeenCalledWith('/repo', 'deadbee');
    expect(requestGradeRun).toHaveBeenCalledWith(
      'http://x',
      't',
      expect.objectContaining({ sha: 'd'.repeat(40) }),
    );
  });

  it('refuses a --sha this repository does not have, without spending a run', async () => {
    // A local refusal naming the commit beats a server 400, and it is the
    // same answer either way — git is the authority on what this repository
    // contains.
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    expandSha.mockResolvedValue(null);
    const outcome = await gradeRun({ ...baseOptions, sha: 'deadbee' });
    expect(outcome).toEqual({ kind: 'unknown-sha', sha: 'deadbee' });
    expect(requestGradeRun).not.toHaveBeenCalled();
  });

  it('does not shell out to expand a sha nobody abbreviated', async () => {
    // rev-parse HEAD already returns 40 characters; expanding it again is a
    // subprocess spent on a string that cannot change.
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue(completeFixture());
    await gradeRun(baseOptions);
    expect(expandSha).not.toHaveBeenCalled();
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

  it('falls back to the requested sha if the server ever omits the echo', async () => {
    // api.ts's call() casts the parsed response with a bare `as T` and
    // validates no field, so a server that omits requestedSha is not a type
    // error at runtime — it is `undefined` reaching this module. Without the
    // fallback, that flows into GradeView.requestedSha and grade-view.ts's
    // shaMatches throws calling .startsWith() on it, after the developer has
    // already waited out a full grade.
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    expandSha.mockResolvedValue('d'.repeat(40));
    requestGradeRun.mockResolvedValue({
      runId: 'r1',
      graderId: 'agent-brief',
      mode: 'deterministic',
      requestedSha: undefined as unknown as string,
    });
    pollGradeRun.mockResolvedValue(completeFixture());
    const outcome = await gradeRun({ ...baseOptions, sha: 'deadbee' });
    if (outcome.kind !== 'graded') throw new Error('expected graded');
    // The fallback is what was actually sent — the expansion, not the
    // abbreviation the developer typed.
    expect(outcome.view.requestedSha).toBe('d'.repeat(40));
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
    // Exponential backoff: 1s after the 1st failure, 2s after the 2nd.
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await promise).kind).toBe('graded');
  });

  it('retries a 404 on the first poll once — the run may not be visible yet', async () => {
    // The POST has just created the run. A read that races it — replica lag,
    // or accessibleRepositories() transiently empty — 404s, and that is a
    // visibility race rather than a run that is gone. One retry, and only
    // here.
    vi.useFakeTimers();
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun
      .mockRejectedValueOnce(new ApiError('Grade unavailable.', 2, 404))
      .mockResolvedValueOnce(completeFixture());
    const promise = gradeRun(baseOptions);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await promise).kind).toBe('graded');
    expect(pollGradeRun).toHaveBeenCalledTimes(2);
  });

  it('gives up on the second 404 — a run that is gone stays gone', async () => {
    // Not the backoff ladder: one retry, then the answer. The ladder would
    // spend about fifteen seconds arriving at the same sentence.
    vi.useFakeTimers();
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockRejectedValue(new ApiError('Grade unavailable.', 2, 404));
    const settled = expect(gradeRun(baseOptions)).rejects.toMatchObject({ status: 404 });
    await vi.advanceTimersByTimeAsync(1_000);
    await settled;
    expect(pollGradeRun).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 404 that arrives after a poll has already succeeded', async () => {
    // Visibility was proven by the first poll, so this 404 is not a race.
    vi.useFakeTimers();
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun
      .mockResolvedValueOnce({ state: 'queued' })
      .mockRejectedValue(new ApiError('Grade unavailable.', 2, 404));
    const settled = expect(gradeRun(baseOptions)).rejects.toMatchObject({ status: 404 });
    await vi.advanceTimersByTimeAsync(1_000);
    await settled;
    expect(pollGradeRun).toHaveBeenCalledTimes(2);
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
    // 4 tolerated failures back off 1s, 2s, 4s, 8s (15s) before the 5th gives up.
    await vi.advanceTimersByTimeAsync(15_000);
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
