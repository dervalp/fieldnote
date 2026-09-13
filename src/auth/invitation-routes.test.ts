import { beforeEach, expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const m = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  exchange: vi.fn(),
  authenticated: vi.fn(),
  session: vi.fn(),
  upsert: vi.fn(),
  workspace: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (m.jar.has(k) ? { value: m.jar.get(k) } : undefined),
    set: (k: string, v: string) => m.jar.set(k, v),
    delete: (k: string) => m.jar.delete(k),
  }),
}));
vi.mock('../lib/env', () => ({
  integrationEnv: () => ({
    TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32),
    APP_URL: 'https://example.com',
    GITHUB_CLIENT_ID: 'fixture',
  }),
}));
vi.mock('./oauth', () => ({ exchangeToken: m.exchange }));
vi.mock('./session', () => ({
  cookieOptions: { httpOnly: true, sameSite: 'lax', path: '/' },
  createSession: m.session,
}));
vi.mock('octokit', () => ({
  Octokit: class {
    rest = { users: { getAuthenticated: m.authenticated } };
  },
}));
vi.mock('../db', () => ({
  db: () => ({ insert: () => ({ values: () => ({ onConflictDoUpdate: m.upsert }) }) }),
}));
vi.mock('../workspaces/store', () => ({ ensureDefaultWorkspace: m.workspace }));
import { GET as login } from '../app/api/auth/login/route';
import { GET as callback } from '../app/api/auth/callback/route';
import { invitationCookie, sealInvitation, readInvitation } from './invitation-continuation';
beforeEach(() => {
  m.jar.clear();
  vi.clearAllMocks();
  m.exchange.mockResolvedValue({ accessToken: 'fixture' });
  m.authenticated.mockResolvedValue({
    data: { id: 1, login: 'test', name: null, avatar_url: null },
  });
});
test('invalid OAuth state never exchanges code and clears continuation', async () => {
  m.jar.set('github-oauth-state', 'expected');
  m.jar.set(invitationCookie, sealInvitation('a'.repeat(43)));
  const result = await callback(
    new Request('https://example.com/api/auth/callback?state=wrong&code=fixture'),
  );
  expect(result.status).toBe(400);
  expect(m.exchange).not.toHaveBeenCalled();
  expect(m.jar.has(invitationCookie)).toBe(false);
});
test('login rejects open redirects and malformed invitation tokens', async () => {
  const response = await login(
    new Request(
      'https://example.com/api/auth/login?invitation=//evil.example&returnTo=https://evil.example',
    ),
  );
  expect(new URL(response.headers.get('location')!).hostname).toBe('github.com');
  expect(m.jar.has(invitationCookie)).toBe(false);
});
test('successful OAuth resumes only valid internal invitation; expired continuation uses dashboard', async () => {
  for (const expired of [false, true]) {
    m.jar.set('github-oauth-state', 'expected');
    m.jar.set(
      invitationCookie,
      sealInvitation('a'.repeat(43), Date.now() - (expired ? 600001 : 0)),
    );
    const result = await callback(
      new Request(
        'https://example.com/api/auth/callback?state=expected&code=fixture&returnTo=https://evil.example',
      ),
    );
    expect(new URL(result.headers.get('location')!).pathname).toBe(
      expired ? '/app/dashboard' : `/invitations/${'a'.repeat(43)}`,
    );
  }
});
test('OAuth provider failure returns safe guidance without reflecting provider secrets', async () => {
  m.jar.set('github-oauth-state', 'expected');
  m.exchange.mockRejectedValue(new Error('sensitive provider detail'));
  const response = await callback(
    new Request('https://example.com/api/auth/callback?state=expected&code=fixture'),
  );
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('sensitive');
});

test('login stores valid encrypted continuation in its HTTP-only cookie', async () => {
  const token = 'a'.repeat(43);
  await login(
    new Request(
      `https://example.com/api/auth/login?invitation=${encodeURIComponent(sealInvitation(token))}`,
    ),
  );
  expect(readInvitation(m.jar.get(invitationCookie))).toBe(token);
});
