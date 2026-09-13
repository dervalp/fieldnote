import { afterEach, describe, expect, it, vi } from 'vitest';
import { run } from './bin.ts';
import { ApiError, type GradeComplete } from './api.ts';

const { readGitState, gradeBlocker, requestGradeRun, pollGradeRun, listGraders, readAuth } =
  vi.hoisted(() => ({
    readGitState: vi.fn(),
    gradeBlocker: vi.fn(),
    requestGradeRun: vi.fn(),
    pollGradeRun: vi.fn(),
    listGraders: vi.fn(),
    readAuth: vi.fn(),
  }));
vi.mock('./git.ts', () => ({ readGitState, gradeBlocker }));
vi.mock('./config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./config.ts')>()),
  readAuth,
}));
vi.mock('./api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api.ts')>()),
  requestGradeRun,
  pollGradeRun,
  listGraders,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

const tty = { isTTY: true, columns: 80, write: () => true };

function capture(env: Record<string, string | undefined> = {}) {
  const written: string[] = [];
  const sink = { ...tty, write: (c: string) => written.push(c) };
  return { sink, env, text: () => written.join('') };
}

const AUTH = { token: 't', login: 'pierre', workspace: 'vertuoza' };

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

describe('run', () => {
  it('prints the banner and a next step for a bare invocation', async () => {
    const c = capture();
    expect(await run([], c.sink, c.env)).toBe(0);
    // The disclaimer is wrapped to the measure and painted per line, so it is
    // compared as plain flowed text: escapes stripped, whitespace collapsed.
    const plain = c
      .text()
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/\s+/g, ' ');
    expect(plain).toContain('Nothing on this machine is uploaded');
    expect(c.text()).toContain('fieldnote run');
  });

  it('prints help with every group a developer might be looking for', async () => {
    const c = capture();
    expect(await run(['--help'], c.sink, c.env)).toBe(0);
    for (const group of ['GRADING', 'GRADERS', 'ACCOUNT', 'AGENTS']) {
      expect(c.text()).toContain(group);
    }
  });

  it('prints the version alone for --version, so a script can read it', async () => {
    const c = capture();
    expect(await run(['--version'], c.sink, c.env)).toBe(0);
    expect(c.text().trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('lists mcp as coming soon and exits zero rather than pretending', async () => {
    const c = capture();
    expect(await run(['mcp'], c.sink, c.env)).toBe(0);
    expect(c.text()).toContain('coming soon');
  });

  it('exits 2 on an unknown command and names the one that exists', async () => {
    const c = capture();
    expect(await run(['grade'], c.sink, c.env)).toBe(2);
    expect(c.text()).toContain('fieldnote run');
  });

  it('does not print a banner into a pipe', async () => {
    const written: string[] = [];
    const pipe = { isTTY: false, columns: undefined, write: (c: string) => written.push(c) };
    await run([], pipe, {});
    expect(written.join('')).not.toContain('╭');
  });
});

describe('run (the grading command)', () => {
  it('exits 3 and asks to sign in when there is no credential', async () => {
    readAuth.mockResolvedValue(null);
    const c = capture();
    expect(await run(['run'], c.sink, c.env)).toBe(3);
    expect(c.text()).toContain('fieldnote login');
  });

  it("prints a blocker's lines verbatim and exits 2", async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue({ reason: 'dirty', lines: ['  3 files changed', '  fix it'] });
    const c = capture();
    expect(await run(['run'], c.sink, c.env)).toBe(2);
    expect(c.text()).toBe('  3 files changed\n  fix it\n');
  });

  it('--sha bypasses a dirty blocker', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue({ reason: 'dirty', lines: ['  dirty'] });
    requestGradeRun.mockResolvedValue({ ...REQUESTED, requestedSha: 'deadbeef' });
    pollGradeRun.mockResolvedValue(completeFixture({ gradedSha: 'deadbeef' }));
    const c = capture();
    expect(await run(['run', '--sha', 'deadbeef'], c.sink, c.env)).toBe(0);
    expect(requestGradeRun).toHaveBeenCalledWith(expect.any(String), AUTH.token, {
      repository: CLEAN_STATE.slug,
      sha: 'deadbeef',
      grader: undefined,
    });
  });

  it('--sha bypasses an unpushed blocker', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue({ reason: 'unpushed', lines: ['  unpushed'] });
    requestGradeRun.mockResolvedValue({ ...REQUESTED, requestedSha: 'deadbeef' });
    pollGradeRun.mockResolvedValue(completeFixture({ gradedSha: 'deadbeef' }));
    const c = capture();
    expect(await run(['run', '--sha', 'deadbeef'], c.sink, c.env)).toBe(0);
  });

  it('--sha does not bypass a no-remote blocker', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue({ ...CLEAN_STATE, slug: null });
    gradeBlocker.mockReturnValue({ reason: 'no-remote', lines: ['  no remote named origin'] });
    const c = capture();
    expect(await run(['run', '--sha', 'deadbeef'], c.sink, c.env)).toBe(2);
    expect(c.text()).toContain('no remote named origin');
    expect(requestGradeRun).not.toHaveBeenCalled();
  });

  it('--sha does not bypass a not-a-repo blocker', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue({ ...CLEAN_STATE, sha: null });
    gradeBlocker.mockReturnValue({ reason: 'not-a-repo', lines: ['  not a git repository'] });
    const c = capture();
    expect(await run(['run', '--sha', 'deadbeef'], c.sink, c.env)).toBe(2);
    expect(requestGradeRun).not.toHaveBeenCalled();
  });

  it('exits 0 for a completed grade and renders the card', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue(completeFixture({ score: 92 }));
    const c = capture();
    expect(await run(['run'], c.sink, c.env)).toBe(0);
    expect(c.text()).toContain('92/100');
  });

  it('exits 1 when the score is below --min', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue(completeFixture({ score: 80 }));
    const c = capture();
    expect(await run(['run', '--min', '90'], c.sink, c.env)).toBe(1);
    // --min's own value must never be misread as the grader id positional.
    expect(requestGradeRun).toHaveBeenCalledWith(
      expect.any(String),
      AUTH.token,
      expect.objectContaining({ grader: undefined }),
    );
  });

  it('exits 0 when the score meets --min', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue(completeFixture({ score: 80 }));
    const c = capture();
    expect(await run(['run', '--min', '70'], c.sink, c.env)).toBe(0);
    expect(requestGradeRun).toHaveBeenCalledWith(
      expect.any(String),
      AUTH.token,
      expect.objectContaining({ grader: undefined }),
    );
  });

  it('without --min, a low score is still exit 0 — the threshold is opt-in', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue(completeFixture({ score: 1 }));
    const c = capture();
    expect(await run(['run'], c.sink, c.env)).toBe(0);
  });

  it('--min 0 is honoured rather than treated as absent — zero is a valid threshold', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue(completeFixture({ score: 50 }));
    const c = capture();
    // 50 is never below 0, so this must exit 0 — not error out, and not treat
    // the falsy 0 as if --min had never been given.
    expect(await run(['run', '--min', '0'], c.sink, c.env)).toBe(0);
  });

  it('a null score (incomplete evidence) is never "below" --min', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    // null < 90 is true in JavaScript — the guard must check for null first,
    // not just compare, or an incomplete grade would wrongly fail --min.
    pollGradeRun.mockResolvedValue(
      completeFixture({ score: null, presentation: null, incompleteReason: 'truncated' }),
    );
    const c = capture();
    expect(await run(['run', '--min', '90'], c.sink, c.env)).toBe(0);
  });

  it("exits 2 when --min is the empty string — that is not a quiet '--min 0'", async () => {
    readAuth.mockResolvedValue(AUTH);
    const c = capture();
    expect(await run(['run', '--min', ''], c.sink, c.env)).toBe(2);
    expect(c.text()).toContain('--min');
    expect(readGitState).not.toHaveBeenCalled();
  });

  it('exits 2 and names the errorCode for a failed grade', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue({ state: 'failed', errorCode: 'clone-failed' });
    const c = capture();
    expect(await run(['run'], c.sink, c.env)).toBe(2);
    expect(c.text()).toContain('clone-failed');
  });

  it('exits 2 and says the reason was not recorded when errorCode is null', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue({ state: 'failed', errorCode: null });
    const c = capture();
    expect(await run(['run'], c.sink, c.env)).toBe(2);
    const text = c.text().toLowerCase();
    expect(text).toContain('failed');
    expect(text).not.toContain('null');
    expect(text).not.toContain('undefined');
  });

  it('exits 2 when a complete poll carries no result', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue({ state: 'complete' });
    const c = capture();
    expect(await run(['run'], c.sink, c.env)).toBe(2);
  });

  it('--json writes one parseable JSON object and no banner', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue(completeFixture({ score: 92 }));
    const c = capture();
    expect(await run(['run', '--json'], c.sink, c.env)).toBe(0);
    const nonEmptyLines = c.text().split('\n').filter(Boolean);
    expect(nonEmptyLines).toHaveLength(1);
    const parsed = JSON.parse(nonEmptyLines[0]);
    expect(parsed.score).toBe(92);
    expect(c.text()).not.toContain('╭');
  });

  it('--json prints a single JSON object even for the not-signed-in path', async () => {
    readAuth.mockResolvedValue(null);
    const c = capture();
    expect(await run(['run', '--json'], c.sink, c.env)).toBe(3);
    const nonEmptyLines = c.text().split('\n').filter(Boolean);
    expect(nonEmptyLines).toHaveLength(1);
    expect(() => JSON.parse(nonEmptyLines[0])).not.toThrow();
  });

  it('reads the grader id positional even when it follows a value flag', async () => {
    // Ordering matters: a naive `argv.filter((a) => !a.startsWith('-'))[1]`
    // reads 'agent-brief' correctly when it comes BEFORE --sha (the flag's
    // own value is filtered out along with the flag), so that ordering does
    // not distinguish the fix from the bug. Putting the grader id AFTER
    // --sha's value is what the naive filter gets wrong: it would misread
    // 'deadbeef' (the sha) as the grader, since it has no way to know that
    // token belongs to --sha rather than being its own positional.
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue(completeFixture());
    const c = capture();
    await run(['run', '--sha', 'deadbeef', 'agent-brief'], c.sink, c.env);
    expect(requestGradeRun).toHaveBeenCalledWith(expect.any(String), AUTH.token, {
      repository: CLEAN_STATE.slug,
      sha: 'deadbeef',
      grader: 'agent-brief',
    });
  });

  it('reads the command itself past a leading value flag', async () => {
    // positionals(argv)[0] must skip --sha's own value the same way
    // positionals(argv)[1] skips it for the grader id — otherwise
    // `fieldnote --sha X run` reports "Unknown command: X".
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue(completeFixture());
    const c = capture();
    expect(await run(['--sha', 'deadbeef', 'run'], c.sink, c.env)).toBe(0);
    expect(c.text()).not.toContain('Unknown command');
  });

  it('exits 2 when --sha is given with no value', async () => {
    readAuth.mockResolvedValue(AUTH);
    const c = capture();
    expect(await run(['run', '--sha'], c.sink, c.env)).toBe(2);
    expect(c.text()).toContain('--sha');
    expect(readGitState).not.toHaveBeenCalled();
  });

  it('exits 2 when --min is not a number', async () => {
    readAuth.mockResolvedValue(AUTH);
    const c = capture();
    expect(await run(['run', '--min', 'abc'], c.sink, c.env)).toBe(2);
    expect(c.text()).toContain('--min');
    expect(readGitState).not.toHaveBeenCalled();
  });

  it("reports an ApiError's message and exit code", async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockRejectedValue(new ApiError('fieldnote is not connected to a/b.', 2));
    const c = capture();
    expect(await run(['run'], c.sink, c.env)).toBe(2);
    expect(c.text()).toContain('fieldnote is not connected to a/b.');
  });

  it('shows a progress line per state transition when not --json', async () => {
    vi.useFakeTimers();
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun
      .mockResolvedValueOnce({ state: 'queued' })
      .mockResolvedValueOnce(completeFixture());
    const c = capture();
    const promise = run(['run'], c.sink, c.env);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await promise).toBe(0);
    expect(c.text()).toContain('queued');
  });

  it('gives up after ten minutes of queued/running and exits 2', async () => {
    vi.useFakeTimers();
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue({ state: 'running' });
    const c = capture();
    const promise = run(['run'], c.sink, c.env);
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000);
    expect(await promise).toBe(2);
    expect(c.text()).toContain('did not finish in time');
  });

  it('tolerates a few consecutive transient poll failures and still grades', async () => {
    vi.useFakeTimers();
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun
      .mockRejectedValueOnce(new ApiError('Could not reach fieldnote. Try again.', 2))
      .mockRejectedValueOnce(new ApiError('Could not reach fieldnote. Try again.', 2))
      .mockResolvedValueOnce(completeFixture({ score: 92 }));
    const c = capture();
    const promise = run(['run'], c.sink, c.env);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await promise).toBe(0);
    expect(c.text()).toContain('92/100');
  });

  it('does not tolerate an exitCode 3 poll failure — the token itself was rejected', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockRejectedValue(new ApiError('Not signed in.', 3));
    const c = capture();
    expect(await run(['run'], c.sink, c.env)).toBe(3);
    expect(c.text()).toContain('Not signed in.');
    expect(pollGradeRun).toHaveBeenCalledTimes(1);
  });

  it('gives up once transient poll failures exceed the retry ceiling', async () => {
    vi.useFakeTimers();
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockRejectedValue(new ApiError('Could not reach fieldnote. Try again.', 2));
    const c = capture();
    const promise = run(['run'], c.sink, c.env);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await promise).toBe(2);
    expect(c.text()).toContain('Could not reach fieldnote. Try again.');
  });
});

describe('run --json error shapes', () => {
  it('not-signed-in', async () => {
    readAuth.mockResolvedValue(null);
    const c = capture();
    expect(await run(['run', '--json'], c.sink, c.env)).toBe(3);
    expect(JSON.parse(c.text())).toEqual({
      error: 'not-signed-in',
      message: 'Not signed in. Run `fieldnote login`.',
    });
  });

  it('usage — --sha given with no value', async () => {
    readAuth.mockResolvedValue(AUTH);
    const c = capture();
    expect(await run(['run', '--sha', '--json'], c.sink, c.env)).toBe(2);
    expect(JSON.parse(c.text())).toEqual({
      error: 'usage',
      message: '--sha requires a value: fieldnote run --sha <sha>',
    });
  });

  it('usage — --min not a number', async () => {
    readAuth.mockResolvedValue(AUTH);
    const c = capture();
    expect(await run(['run', '--min', 'abc', '--json'], c.sink, c.env)).toBe(2);
    expect(JSON.parse(c.text())).toEqual({
      error: 'usage',
      message: '--min requires a numeric value: fieldnote run --min <score>',
    });
  });

  it('blocked — carries the reason and the blocker lines, not just the reason', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue({ reason: 'dirty', lines: ['  3 files changed', '', '  fix it'] });
    const c = capture();
    expect(await run(['run', '--json'], c.sink, c.env)).toBe(2);
    expect(JSON.parse(c.text())).toEqual({
      error: 'blocked',
      message: '3 files changed',
      reason: 'dirty',
      lines: ['  3 files changed', '', '  fix it'],
    });
  });

  it('timeout — includes the same message the human path prints', async () => {
    vi.useFakeTimers();
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue({ state: 'running' });
    const c = capture();
    const promise = run(['run', '--json'], c.sink, c.env);
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000);
    expect(await promise).toBe(2);
    expect(JSON.parse(c.text())).toEqual({
      error: 'timeout',
      message: 'The grade did not finish in time. Try again.',
    });
  });

  it('failed — keeps errorCode alongside a human-readable message', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue({ state: 'failed', errorCode: 'clone-failed' });
    const c = capture();
    expect(await run(['run', '--json'], c.sink, c.env)).toBe(2);
    expect(JSON.parse(c.text())).toEqual({
      error: 'failed',
      message: 'The grade failed: clone-failed',
      errorCode: 'clone-failed',
    });
  });

  it('failed with no errorCode — never invents a reason', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue({ state: 'failed', errorCode: null });
    const c = capture();
    expect(await run(['run', '--json'], c.sink, c.env)).toBe(2);
    expect(JSON.parse(c.text())).toEqual({
      error: 'failed',
      message: 'The grade failed. No reason was recorded.',
      errorCode: null,
    });
  });

  it('no-result', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue({ state: 'complete' });
    const c = capture();
    expect(await run(['run', '--json'], c.sink, c.env)).toBe(2);
    expect(JSON.parse(c.text())).toEqual({
      error: 'no-result',
      message: 'The grade finished but recorded no result.',
    });
  });

  it('api-error — the ApiError message becomes both fields', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockRejectedValue(new ApiError('fieldnote is not connected to a/b.', 2));
    const c = capture();
    expect(await run(['run', '--json'], c.sink, c.env)).toBe(2);
    expect(JSON.parse(c.text())).toEqual({
      error: 'api-error',
      message: 'fieldnote is not connected to a/b.',
    });
  });
});

describe('graders', () => {
  it('exits 3 and asks to sign in when there is no credential', async () => {
    readAuth.mockResolvedValue(null);
    const c = capture();
    expect(await run(['graders'], c.sink, c.env)).toBe(3);
    expect(c.text()).toContain('fieldnote login');
  });

  it('lists what listGraders returns', async () => {
    readAuth.mockResolvedValue(AUTH);
    listGraders.mockResolvedValue([
      {
        id: 'agent-brief',
        version: '1',
        mode: 'deterministic',
        category: 'docs',
        tagline: 'reads like a brief',
      },
    ]);
    const c = capture();
    expect(await run(['graders'], c.sink, c.env)).toBe(0);
    expect(c.text()).toContain('agent-brief');
    expect(c.text()).toContain('reads like a brief');
  });

  it('--json writes one parseable JSON object', async () => {
    readAuth.mockResolvedValue(AUTH);
    listGraders.mockResolvedValue([]);
    const c = capture();
    expect(await run(['graders', '--json'], c.sink, c.env)).toBe(0);
    const nonEmptyLines = c.text().split('\n').filter(Boolean);
    expect(nonEmptyLines).toHaveLength(1);
    expect(JSON.parse(nonEmptyLines[0])).toEqual({ graders: [] });
  });

  it("reports an ApiError's message and exit code", async () => {
    readAuth.mockResolvedValue(AUTH);
    listGraders.mockRejectedValue(new ApiError('Could not reach fieldnote. Try again.', 2));
    const c = capture();
    expect(await run(['graders'], c.sink, c.env)).toBe(2);
    expect(c.text()).toContain('Could not reach fieldnote. Try again.');
  });

  it('--json not-signed-in shape matches run’s', async () => {
    readAuth.mockResolvedValue(null);
    const c = capture();
    expect(await run(['graders', '--json'], c.sink, c.env)).toBe(3);
    expect(JSON.parse(c.text())).toEqual({
      error: 'not-signed-in',
      message: 'Not signed in. Run `fieldnote login`.',
    });
  });

  it('--json api-error shape matches run’s', async () => {
    readAuth.mockResolvedValue(AUTH);
    listGraders.mockRejectedValue(new ApiError('Could not reach fieldnote. Try again.', 2));
    const c = capture();
    expect(await run(['graders', '--json'], c.sink, c.env)).toBe(2);
    expect(JSON.parse(c.text())).toEqual({
      error: 'api-error',
      message: 'Could not reach fieldnote. Try again.',
    });
  });
});
