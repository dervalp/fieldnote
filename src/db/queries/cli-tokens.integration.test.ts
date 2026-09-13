import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../index';
import { cliAuthCodes, cliTokens, users, workspaces } from '../schema';
import {
  consumeAuthCode,
  createAuthCode,
  issueToken,
  listTokens,
  resolveToken,
  revokeToken,
} from './cli-tokens';
import { tokenHash } from '../../auth/crypto';

const userId = 'u_cli_test';
const workspaceId = 'w_cli_test';

beforeEach(async () => {
  await db().delete(cliTokens);
  await db().delete(cliAuthCodes);
  await db()
    .insert(users)
    .values({ id: userId, login: 'cli-test', credentials: 'x' })
    .onConflictDoNothing();
  await db().insert(workspaces).values({ id: workspaceId, name: 'CLI' }).onConflictDoNothing();
});

describe('cli token lifecycle', () => {
  it('issues a token that resolves to its principal', async () => {
    const token = await issueToken(userId, workspaceId, 'laptop');
    expect(await resolveToken(token)).toEqual({
      userId,
      workspaceId,
      source: 'cli',
    });
  });

  it('never stores the plaintext', async () => {
    const token = await issueToken(userId, workspaceId, 'laptop');
    const [row] = await db().select().from(cliTokens);
    expect(row.id).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it('distinguishes a revoked token from one that never existed', async () => {
    const token = await issueToken(userId, workspaceId, 'laptop');
    const [row] = await db().select().from(cliTokens);
    await revokeToken(row.id, userId);
    expect(await resolveToken(token)).toEqual({ error: 'revoked' });
    expect(await resolveToken('fn_never_issued')).toEqual({ error: 'unknown' });
  });

  it('records last use so the revocation list is worth reading', async () => {
    const token = await issueToken(userId, workspaceId, 'laptop');
    await resolveToken(token);
    const [listed] = await listTokens(userId);
    expect(listed.lastUsedAt).not.toBeNull();
    expect(listed.label).toBe('laptop');
  });

  it('will not let one user revoke another user token', async () => {
    await issueToken(userId, workspaceId, 'laptop');
    const [row] = await db().select().from(cliTokens);
    await revokeToken(row.id, 'u_someone_else');
    const [after] = await db().select().from(cliTokens);
    expect(after.revokedAt).toBeNull();
  });
});

describe('cli auth code lifecycle', () => {
  it('returns a pending sign-in exactly once', async () => {
    const code = await createAuthCode({
      userId,
      workspaceId,
      workspaceName: 'CLI',
      login: 'octocat',
      challenge: 'CHAL',
    });
    expect(await consumeAuthCode(code)).toMatchObject({ userId, challenge: 'CHAL' });
    expect(await consumeAuthCode(code)).toBeNull();
  });

  it('refuses an expired sign-in', async () => {
    const code = await createAuthCode({
      userId,
      workspaceId,
      workspaceName: 'CLI',
      login: 'octocat',
      challenge: 'CHAL',
    });
    await db()
      .update(cliAuthCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(cliAuthCodes.id, tokenHash(code)));
    expect(await consumeAuthCode(code)).toBeNull();
  });

  it('never stores the code itself', async () => {
    const code = await createAuthCode({
      userId,
      workspaceId,
      workspaceName: 'CLI',
      login: 'octocat',
      challenge: 'CHAL',
    });
    const [row] = await db().select().from(cliAuthCodes);
    expect(row.id).not.toBe(code);
  });
});
