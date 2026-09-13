import { randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../index';
import { cliAuthCodes, cliTokens } from '../schema';
import { tokenHash } from '../../auth/crypto';
import type { Principal } from '../../auth/principal';

// Written at most once a minute rather than per request: a poll loop calling
// resolveToken every second must not turn the revocation list into a write
// storm.
const TOUCH_INTERVAL = 60_000;

export async function issueToken(
  userId: string,
  workspaceId: string,
  label: string,
): Promise<string> {
  const token = `fn_${randomBytes(32).toString('base64url')}`;
  await db()
    .insert(cliTokens)
    .values({ id: tokenHash(token), userId, workspaceId, label });
  return token;
}

// The only scope a token can carry today — issueToken() never sets one, so
// every row gets the column's default. A literal type rather than `string`
// so a future scope value that drifts from what withCliPrincipal() compares
// against is a typecheck error, not a runtime surprise.
export type CliScope = 'grade';

export async function resolveToken(
  token: string,
): Promise<(Principal & { scope: CliScope }) | { error: 'revoked' | 'unknown' }> {
  const [row] = await db()
    .select()
    .from(cliTokens)
    .where(eq(cliTokens.id, tokenHash(token)));
  // A revoked token must be distinguishable from one that never existed, so
  // the error can tell the user which of the two happened.
  if (!row) return { error: 'unknown' };
  if (row.revokedAt) return { error: 'revoked' };
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > TOUCH_INTERVAL) {
    await db().update(cliTokens).set({ lastUsedAt: new Date() }).where(eq(cliTokens.id, row.id));
  }
  // The column is unconstrained text; row.scope is only ever 'grade' in
  // practice (see above), so this narrows what the database can't.
  return {
    userId: row.userId,
    workspaceId: row.workspaceId,
    source: 'cli',
    scope: row.scope as CliScope,
  };
}

export async function revokeToken(id: string, userId: string): Promise<void> {
  await db()
    .update(cliTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(cliTokens.id, id), eq(cliTokens.userId, userId), isNull(cliTokens.revokedAt)));
}

export async function listTokens(userId: string) {
  return db()
    .select({
      id: cliTokens.id,
      label: cliTokens.label,
      createdAt: cliTokens.createdAt,
      lastUsedAt: cliTokens.lastUsedAt,
      revokedAt: cliTokens.revokedAt,
    })
    .from(cliTokens)
    .where(eq(cliTokens.userId, userId))
    .orderBy(desc(cliTokens.createdAt));
}

const CODE_TTL = 5 * 60_000;

export async function createAuthCode(input: {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  login: string;
  challenge: string;
}): Promise<string> {
  const code = randomBytes(24).toString('base64url');
  await db()
    .insert(cliAuthCodes)
    .values({ ...input, id: tokenHash(code), expiresAt: new Date(Date.now() + CODE_TTL) });
  return code;
}

// Single use, enforced by the database: the delete returns the row exactly once,
// so two simultaneous exchanges cannot both succeed.
export async function consumeAuthCode(code: string) {
  const [row] = await db()
    .delete(cliAuthCodes)
    .where(eq(cliAuthCodes.id, tokenHash(code)))
    .returning();
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return row;
}
