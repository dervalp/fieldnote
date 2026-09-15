import { describe, expect, it } from 'vitest';
import { currentPrincipal, withPrincipal } from './principal';

const cli = { userId: 'u_1', workspaceId: 'w_1', source: 'cli' as const };

describe('currentPrincipal', () => {
  it('is undefined outside a scope, which is what keeps the cookie path unchanged', () => {
    expect(currentPrincipal()).toBeUndefined();
  });

  it('is the principal inside a scope', async () => {
    await withPrincipal(cli, async () => {
      expect(currentPrincipal()).toEqual(cli);
    });
  });

  it('does not leak out of the scope', async () => {
    await withPrincipal(cli, async () => {});
    expect(currentPrincipal()).toBeUndefined();
  });

  it('does not leak across concurrent scopes', async () => {
    const other = { userId: 'u_2', workspaceId: 'w_2', source: 'cli' as const };
    const [a, b] = await Promise.all([
      withPrincipal(cli, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return currentPrincipal()?.userId;
      }),
      withPrincipal(other, async () => currentPrincipal()?.userId),
    ]);
    expect(a).toBe('u_1');
    expect(b).toBe('u_2');
  });

  it('survives an await inside the scope', async () => {
    await withPrincipal(cli, async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(currentPrincipal()?.source).toBe('cli');
    });
  });
});
