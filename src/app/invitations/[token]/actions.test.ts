import { beforeEach, expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const m = vi.hoisted(() => ({
  current: vi.fn(),
  paginate: vi.fn(),
  accept: vi.fn(),
  active: vi.fn(),
  signed: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
  unstable_rethrow: (e: unknown) => {
    if (e instanceof Error && e.message === 'NEXT_REDIRECT') throw e;
  },
}));
vi.mock('../../../lib/env', () => ({
  integrationEnv: () => ({ TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32) }),
}));
vi.mock('../../../auth/session', () => ({
  currentUser: m.current,
  hasCurrentSession: m.signed,
  userClient: async () => ({
    paginate: m.paginate,
    rest: { users: { listEmailsForAuthenticatedUser: 'emails' } },
  }),
}));
vi.mock('../../../workspaces/invitations', () => ({ acceptInvitation: m.accept }));
vi.mock('../../../workspaces/access', () => ({ setActiveWorkspace: m.active }));
import { acceptInvitationAction } from './actions';
import Page from './page';
import { sealInvitation } from '../../../auth/invitation-continuation';
const token = 'x'.repeat(43);
beforeEach(() => {
  vi.clearAllMocks();
  m.current.mockResolvedValue({ id: 'u' });
  m.accept.mockResolvedValue({ workspaceId: 'w' });
  m.signed.mockResolvedValue(false);
});
test('POST accepts matching nonprimary verified email only and switches workspace', async () => {
  m.paginate.mockResolvedValue([
    { email: 'unverified@example.com', verified: false, primary: true },
    { email: 'verified@example.com', verified: true, primary: false },
  ]);
  await expect(acceptInvitationAction(sealInvitation(token))).rejects.toThrow(
    'redirect:/app/dashboard',
  );
  expect(m.accept).toHaveBeenCalledWith(token, ['verified@example.com']);
  expect(m.active).toHaveBeenCalledWith('w');
});
test('email API failure shows reauthorization guidance without accepting', async () => {
  m.paginate.mockRejectedValue(new Error('provider detail'));
  await expect(acceptInvitationAction(sealInvitation(token))).rejects.toThrow('?error=reauthorize');
  expect(m.accept).not.toHaveBeenCalled();
});
test('authentication redirect propagates', async () => {
  m.current.mockRejectedValue(new Error('NEXT_REDIRECT'));
  await expect(acceptInvitationAction(sealInvitation(token))).rejects.toThrow('NEXT_REDIRECT');
  expect(m.paginate).not.toHaveBeenCalled();
});
test('GET confirmation never consumes invitation or queries private invitation details', async () => {
  const page = await Page({
    params: Promise.resolve({ token }),
    searchParams: Promise.resolve({}),
  });
  expect(m.accept).not.toHaveBeenCalled();
  expect(m.paginate).not.toHaveBeenCalled();
  expect(m.current).not.toHaveBeenCalled();
  expect(JSON.stringify(page)).not.toContain('credentials');
  expect(JSON.stringify(page)).not.toContain(token);
});
