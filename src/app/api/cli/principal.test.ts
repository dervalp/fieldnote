import { describe, expect, it, vi, beforeEach } from 'vitest';

const { resolveToken } = vi.hoisted(() => ({ resolveToken: vi.fn() }));
vi.mock('../../../db/queries/cli-tokens', () => ({ resolveToken }));

import { withCliPrincipal } from './principal';

const ok = async () => Response.json({ ok: true });
const req = (auth?: string) =>
  new Request('http://localhost/api/cli/x', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  });

beforeEach(() => resolveToken.mockReset());

describe('withCliPrincipal', () => {
  it('401s with no header', async () => {
    const response = await withCliPrincipal(req(), 'grade', ok);
    expect(response.status).toBe(401);
  });

  it('401s identically for an unknown and a revoked token', async () => {
    resolveToken.mockResolvedValueOnce({ error: 'unknown' });
    const a = await withCliPrincipal(req('Bearer fn_a'), 'grade', ok);
    resolveToken.mockResolvedValueOnce({ error: 'revoked' });
    const b = await withCliPrincipal(req('Bearer fn_b'), 'grade', ok);
    expect(a.status).toBe(b.status);
    expect(await a.json()).toEqual(await b.json());
  });

  it('403s when the token lacks the scope', async () => {
    resolveToken.mockResolvedValue({
      userId: 'u_1',
      workspaceId: 'w_1',
      source: 'cli',
      scope: 'read',
    });
    const response = await withCliPrincipal(req('Bearer fn_x'), 'grade', ok);
    expect(response.status).toBe(403);
  });

  it('runs the handler inside the principal scope', async () => {
    resolveToken.mockResolvedValue({
      userId: 'u_1',
      workspaceId: 'w_1',
      source: 'cli',
      scope: 'grade',
    });
    const { currentPrincipal } = await import('../../../auth/principal');
    const response = await withCliPrincipal(req('Bearer fn_x'), 'grade', async () =>
      Response.json({ seen: currentPrincipal()?.userId }),
    );
    expect(await response.json()).toEqual({ seen: 'u_1' });
  });

  it('converts a redirect throw into 401, not a 307 into HTML', async () => {
    resolveToken.mockResolvedValue({
      userId: 'u_1',
      workspaceId: 'w_1',
      source: 'cli',
      scope: 'grade',
    });
    const { redirect } = await import('next/navigation');
    const response = await withCliPrincipal(
      req('Bearer fn_x'),
      'grade',
      async (): Promise<Response> => {
        return redirect('/signed-out');
      },
    );
    expect(response.status).toBe(401);
  });

  it('converts a notFound throw into a JSON 404, not an HTML 404 page', async () => {
    resolveToken.mockResolvedValue({
      userId: 'u_1',
      workspaceId: 'w_1',
      source: 'cli',
      scope: 'grade',
    });
    const { notFound } = await import('next/navigation');
    const response = await withCliPrincipal(
      req('Bearer fn_x'),
      'grade',
      async (): Promise<Response> => {
        return notFound();
      },
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    const body = await response.json();
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });
});
