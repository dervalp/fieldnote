import { describe, expect, it, vi, afterEach } from 'vitest';
import { ApiError, hasResult, pollGradeRun, requestGradeRun } from './api.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('api errors map to exit codes', () => {
  it('maps 401 to exit code 3, which is recoverable by signing in', async () => {
    vi.stubGlobal('fetch', async () => json(401, { error: 'Not signed in.' }));
    await expect(pollGradeRun('http://x', 't', 'gr_1')).rejects.toMatchObject({ exitCode: 3 });
  });

  it('maps 403 to exit code 3 as well — the token is wrong, not the request', async () => {
    vi.stubGlobal('fetch', async () => json(403, { error: 'This token cannot grade.' }));
    await expect(pollGradeRun('http://x', 't', 'gr_1')).rejects.toMatchObject({ exitCode: 3 });
  });

  it('maps 404 to exit code 2 and surfaces the server message', async () => {
    vi.stubGlobal('fetch', async () => json(404, { error: 'fieldnote is not connected to a/b.' }));
    await expect(
      requestGradeRun('http://x', 't', { repository: 'a/b', sha: 'a'.repeat(40) }),
    ).rejects.toMatchObject({ exitCode: 2, message: 'fieldnote is not connected to a/b.' });
  });

  it('maps a network failure to exit code 2 without leaking the cause', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:443');
    });
    const error = await pollGradeRun('http://x', 't', 'gr_1').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.exitCode).toBe(2);
    expect(error.message).not.toContain('ECONNREFUSED');
  });

  it('returns the parsed body on success', async () => {
    vi.stubGlobal('fetch', async () => json(200, { state: 'running' }));
    expect(await pollGradeRun('http://x', 't', 'gr_1')).toEqual({ state: 'running' });
  });
});

describe('hasResult', () => {
  it('is false for a bare complete poll with no stored result', () => {
    expect(hasResult({ state: 'complete' })).toBe(false);
  });

  it('is false for queued/running/failed', () => {
    expect(hasResult({ state: 'queued' })).toBe(false);
    expect(hasResult({ state: 'running' })).toBe(false);
    expect(hasResult({ state: 'failed', errorCode: null })).toBe(false);
  });

  it('is true for a complete poll carrying a null score — score is present, just null', () => {
    expect(
      hasResult({
        state: 'complete',
        score: null,
        checks: [],
        titles: {},
        graderId: 'g',
        graderVersion: '1',
        rubricVersion: '1',
        evaluatorVersion: '1',
        mode: 'deterministic',
        tagline: '',
        disclaimer: '',
        gradedSha: null,
        presentation: null,
        nextTier: null,
        url: 'http://x',
      }),
    ).toBe(true);
  });
});

describe('non-JSON responses', () => {
  it('does not crash on a non-JSON body and reports the exit code the status implies', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }),
    );
    const error = await pollGradeRun('http://x', 't', 'gr_1').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.exitCode).toBe(2);
    expect(error.message).not.toContain('<html>');
  });

  it('maps a non-JSON 401 body to exit code 3', async () => {
    vi.stubGlobal('fetch', async () => new Response('not json', { status: 401 }));
    const error = await pollGradeRun('http://x', 't', 'gr_1').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.exitCode).toBe(3);
  });
});

describe('timeout', () => {
  it('passes a timeout signal on every request', async () => {
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal('fetch', async (_url: string | URL, init?: RequestInit) => {
      capturedInit = init;
      return json(200, { state: 'running' });
    });
    await pollGradeRun('http://x', 't', 'gr_1');
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps an aborted request to exit code 2 with a message about the timeout', async () => {
    // AbortSignal.timeout() rejects fetch with a DOMException named
    // 'TimeoutError' — this is what actually reaches the catch block once the
    // real timeout fires, so the test reproduces that shape directly rather
    // than waiting out a real clock.
    vi.stubGlobal('fetch', async () => {
      throw new DOMException('This operation was aborted', 'TimeoutError');
    });
    const error = await pollGradeRun('http://x', 't', 'gr_1').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.exitCode).toBe(2);
    expect(error.message.toLowerCase()).toContain('time');
  });
});
