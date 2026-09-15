import { describe, expect, it, vi } from 'vitest';

const revoked: [string, string][] = [];
// revalidatePath() asserts a request-scoped store that only exists inside a
// real Next.js request; unit tests run outside that, so it is stubbed the
// same way ../actions.test.ts stubs it for the sibling settings actions.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../../../auth/session', () => ({
  currentUser: async () => ({ id: 'u_1', login: 'octocat' }),
}));
vi.mock('../../../../db/queries/cli-tokens', () => ({
  listTokens: async () => [],
  revokeToken: async (id: string, userId: string) => {
    revoked.push([id, userId]);
  },
}));

describe('revokeTokenAction', () => {
  it('revokes only on behalf of the signed-in user', async () => {
    const { revokeTokenAction } = await import('./actions');
    await revokeTokenAction('tok_1');
    expect(revoked).toEqual([['tok_1', 'u_1']]);
  });
});
