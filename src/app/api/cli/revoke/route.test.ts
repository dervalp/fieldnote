import { beforeEach, expect, test, vi } from 'vitest';
const { resolveToken, revokeToken } = vi.hoisted(() => ({
  resolveToken: vi.fn(),
  revokeToken: vi.fn(),
}));
vi.mock('../../../../db/queries/cli-tokens', () => ({ resolveToken, revokeToken }));
import { tokenHash } from '../../../../auth/crypto';
import { POST } from './route';

const call = (headers?: HeadersInit) =>
  POST(new Request('http://localhost/api/cli/revoke', { method: 'POST', headers }));

beforeEach(() => {
  vi.resetAllMocks();
});

test('no Authorization header returns 401 "Not signed in."', async () => {
  const response = await call();
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: 'Not signed in. Run `fieldnote login`.' });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(resolveToken).not.toHaveBeenCalled();
});

test('unknown token is indistinguishable from a missing header', async () => {
  resolveToken.mockResolvedValue({ error: 'unknown' });
  const missing = await call();
  const missingBody = await missing.json();
  const unknown = await call({ authorization: 'Bearer fn_whatever' });
  const unknownBody = await unknown.json();
  expect(unknown.status).toBe(missing.status);
  expect(unknownBody).toEqual(missingBody);
  expect(unknown.status).toBe(401);
  expect(unknownBody).toEqual({ error: 'Not signed in. Run `fieldnote login`.' });
  expect(revokeToken).not.toHaveBeenCalled();
});

test('revoked token is indistinguishable from a missing header', async () => {
  resolveToken.mockResolvedValue({ error: 'revoked' });
  const missing = await call();
  const missingBody = await missing.json();
  const revoked = await call({ authorization: 'Bearer fn_whatever' });
  const revokedBody = await revoked.json();
  expect(revoked.status).toBe(missing.status);
  expect(revokedBody).toEqual(missingBody);
  expect(revoked.status).toBe(401);
  expect(revokedBody).toEqual({ error: 'Not signed in. Run `fieldnote login`.' });
  expect(revokeToken).not.toHaveBeenCalled();
});

test('valid token revokes the hash, never the raw token', async () => {
  const token = 'fn_the-raw-secret';
  resolveToken.mockResolvedValue({
    userId: 'u_1',
    workspaceId: 'w_1',
    source: 'cli',
    scope: 'grade',
  });
  const response = await call({ authorization: `Bearer ${token}` });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ revoked: true });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(revokeToken).toHaveBeenCalledWith(tokenHash(token), 'u_1');
  expect(revokeToken).not.toHaveBeenCalledWith(token, 'u_1');
});

test('accepts only what principal.ts accepts as a bearer token', async () => {
  // Both sites used to carry their own copy of the regex, with a comment
  // asking them not to drift. They now share one function, and these are the
  // forms that must stay refused without resolveToken ever seeing them.
  for (const header of ['fn_bare', 'Basic fn_x', 'Bearer', 'Bearer ']) {
    const response = await call({ authorization: header });
    expect(response.status).toBe(401);
  }
  expect(resolveToken).not.toHaveBeenCalled();
});

test('tolerates the padding some clients add, exactly as principal.ts does', async () => {
  resolveToken.mockResolvedValue({
    userId: 'u_1',
    workspaceId: 'w_1',
    source: 'cli',
    scope: 'grade',
  });
  const response = await call({ authorization: 'bearer  fn_padded  ' });
  expect(response.status).toBe(200);
  expect(revokeToken).toHaveBeenCalledWith(tokenHash('fn_padded'), 'u_1');
});
