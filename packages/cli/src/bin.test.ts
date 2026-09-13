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
  });

  it('exits 0 when the score meets --min', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue(completeFixture({ score: 80 }));
    const c = capture();
    expect(await run(['run', '--min', '70'], c.sink, c.env)).toBe(0);
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

  it('reads the grader id positional even when a value flag follows it', async () => {
    readAuth.mockResolvedValue(AUTH);
    readGitState.mockResolvedValue(CLEAN_STATE);
    gradeBlocker.mockReturnValue(null);
    requestGradeRun.mockResolvedValue(REQUESTED);
    pollGradeRun.mockResolvedValue(completeFixture());
    const c = capture();
    await run(['run', 'agent-brief', '--sha', 'deadbeef'], c.sink, c.env);
    expect(requestGradeRun).toHaveBeenCalledWith(expect.any(String), AUTH.token, {
      repository: CLEAN_STATE.slug,
      sha: 'deadbeef',
      grader: 'agent-brief',
    });
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
});
