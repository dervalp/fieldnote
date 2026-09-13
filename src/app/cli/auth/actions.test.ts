import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../auth/session', () => ({
  currentUser: async () => ({ id: 'u_1', login: 'octocat' }),
}));
const requireWorkspace = vi.fn().mockResolvedValue({ id: 'w_1', name: 'vertuoza', role: 'owner' });
vi.mock('../../../workspaces/access', () => ({
  requireWorkspace: (...args: unknown[]) => requireWorkspace(...args),
}));
const createAuthCode = vi.fn().mockResolvedValue('the-code');
vi.mock('../../../db/queries/cli-tokens', () => ({
  createAuthCode: (input: unknown) => createAuthCode(input),
}));

let mod: typeof import('./actions');
beforeEach(async () => {
  vi.resetModules();
  createAuthCode.mockClear();
  requireWorkspace.mockClear();
  mod = await import('./actions');
});

describe('approveCliAuth', () => {
  it('delegates to createAuthCode with the approver, their workspace and the challenge', async () => {
    const { code } = await mod.approveCliAuth({ challenge: 'CHAL', workspaceId: 'w_1' });
    expect(code).toBe('the-code');
    expect(createAuthCode).toHaveBeenCalledWith({
      userId: 'u_1',
      workspaceId: 'w_1',
      workspaceName: 'vertuoza',
      login: 'octocat',
      challenge: 'CHAL',
    });
  });

  it('re-resolves the workspace from the passed-in id, rather than trusting a rendered value', async () => {
    await mod.approveCliAuth({ challenge: 'CHAL', workspaceId: 'w_1' });
    expect(requireWorkspace).toHaveBeenCalledWith('w_1');
  });
});
