import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  ApiError,
  exchangeCliToken,
  hasResult,
  listGraders,
  pollGradeRun,
  requestGradeRun,
  revokeCliToken,
} from './api.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('api errors map to exit codes', () => {
  it('maps 401 to exit code 3, which is recoverable by signing in', async () => {
    vi.stubGlobal('fetch', async () => json(401, { error: 'Not signed in.' }));
    await expect(pollGradeRun('http://x', 't', 'gr_1')).rejects.toMatchObject({ exitCode: 3 });
  });

  it('carries the HTTP status, so a caller can tell a permanent 404 from a transient 503', async () => {
    // Without it every non-401/403 collapses to exit code 2, and grade-run.ts
    // retries all of them — spending fifteen seconds of backoff on a run that
    // is gone and will stay gone.
    vi.stubGlobal('fetch', async () => json(404, { error: 'Grade unavailable.' }));
    await expect(pollGradeRun('http://x', 't', 'gr_1')).rejects.toMatchObject({
      exitCode: 2,
      status: 404,
    });
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

  it('treats a JSON null body on an otherwise-ok response as unexpected, not a valid T', async () => {
    vi.stubGlobal('fetch', async () => json(200, null));
    const error = await pollGradeRun('http://x', 't', 'gr_1').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.exitCode).toBe(2);
  });
});

describe('timeout', () => {
  it('attaches a fresh timeout signal to every request, not a shared module-scope one', async () => {
    // A signal captured once and reused across requests (e.g. a module-scope
    // `const SIGNAL = AbortSignal.timeout(30_000)`) would also satisfy
    // "is an AbortSignal" — the bug worth catching is that it aborts every
    // request after the first window. Calling twice and comparing identity
    // is what actually discriminates that.
    const signals: (AbortSignal | undefined)[] = [];
    vi.stubGlobal('fetch', async (_url: string | URL, init?: RequestInit) => {
      signals.push(init?.signal ?? undefined);
      return json(200, { state: 'running' });
    });
    await pollGradeRun('http://x', 't', 'gr_1');
    await pollGradeRun('http://x', 't', 'gr_1');
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBeInstanceOf(AbortSignal);
    expect(signals[0]).not.toBe(signals[1]);
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

describe('the token goes only in the Authorization header', () => {
  it('never in the request URL, and as exactly `Bearer <token>` in the header', async () => {
    const secret = 'sekrit-token-do-not-leak';
    let capturedUrl: string | URL | undefined;
    let capturedHeaders: HeadersInit | undefined;
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init?.headers;
      return json(200, { state: 'running' });
    });
    await pollGradeRun('http://x', secret, 'gr_1');
    expect(new Headers(capturedHeaders).get('authorization')).toBe(`Bearer ${secret}`);
    expect(String(capturedUrl)).not.toContain(secret);
  });
});

describe('listGraders', () => {
  it('unwraps the envelope and returns the array itself', async () => {
    const graders = [
      {
        id: 'agent-readiness',
        version: '1',
        mode: 'deterministic' as const,
        category: 'c',
        tagline: 't',
      },
    ];
    vi.stubGlobal('fetch', async () => json(200, { graders }));
    expect(await listGraders('http://x', 't')).toEqual(graders);
  });
});

describe('exchangeCliToken', () => {
  it('returns the parsed auth on success', async () => {
    const auth = { token: 'tok', login: 'ada', workspace: 'lovelace' };
    vi.stubGlobal('fetch', async () => json(200, auth));
    expect(await exchangeCliToken('http://x', { code: 'c', verifier: 'v', label: 'l' })).toEqual(
      auth,
    );
  });

  it('maps a failure to exit code 2, same as every other endpoint', async () => {
    vi.stubGlobal('fetch', async () => json(400, { error: 'This sign-in expired.' }));
    await expect(
      exchangeCliToken('http://x', { code: 'c', verifier: 'v', label: 'l' }),
    ).rejects.toMatchObject({ exitCode: 2 });
  });
});

describe('revokeCliToken', () => {
  it('resolves on success', async () => {
    vi.stubGlobal('fetch', async () => json(200, { revoked: true }));
    await expect(revokeCliToken('http://x', 't')).resolves.toBeUndefined();
  });

  it('throws an ApiError on failure, leaving the best-effort decision to the caller', async () => {
    vi.stubGlobal('fetch', async () => json(401, { error: 'Not signed in.' }));
    await expect(revokeCliToken('http://x', 't')).rejects.toBeInstanceOf(ApiError);
  });
});
