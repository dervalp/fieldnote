import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../auth/session', () => ({
  currentUser: async () => ({ id: 'u_1', login: 'octocat' }),
}));
vi.mock('../../../workspaces/access', () => ({
  requireWorkspace: async () => ({ id: 'w_1', name: 'vertuoza', role: 'owner' }),
}));
const createAuthCode = vi.fn().mockResolvedValue('the-code');
vi.mock('../../../db/queries/cli-tokens', () => ({
  createAuthCode: (input: unknown) => createAuthCode(input),
}));

let mod: typeof import('./actions');
beforeEach(async () => {
  vi.resetModules();
  createAuthCode.mockClear();
  mod = await import('./actions');
});

describe('approveCliAuth', () => {
  it('delegates to createAuthCode with the approver, their workspace and the challenge', async () => {
    const { code } = await mod.approveCliAuth({ challenge: 'CHAL' });
    expect(code).toBe('the-code');
    expect(createAuthCode).toHaveBeenCalledWith({
      userId: 'u_1',
      workspaceId: 'w_1',
      workspaceName: 'vertuoza',
      login: 'octocat',
      challenge: 'CHAL',
    });
  });
});
