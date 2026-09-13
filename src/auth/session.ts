import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq, and, gt, sql } from 'drizzle-orm';
import { Octokit } from 'octokit';
import { db } from '../db';
import { users, sessions } from '../db/schema';
import { integrationEnv } from '../lib/env';
import { decrypt, encrypt, tokenHash } from './crypto';
import { credentialsSchema, exchangeToken } from './oauth';
import { currentPrincipal } from './principal';
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};
export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  await db()
    .insert(sessions)
    .values({ id: tokenHash(token), userId, expiresAt });
  (await cookies()).set('reliability-session', token, { ...cookieOptions, expires: expiresAt });
}
export async function hasCurrentSession(): Promise<boolean> {
  if (currentPrincipal()) return true;
  const token = (await cookies()).get('reliability-session')?.value;
  if (!token) return false;
  const [session] = await db()
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, tokenHash(token)), gt(sessions.expiresAt, new Date())));
  return Boolean(session);
}

async function sessionUser() {
  // A CLI principal short-circuits the cookie entirely. currentUser() and
  // userClient() both funnel through here, so this one branch is the whole
  // seam — a bearer token gets the same GitHub client and the same identity
  // every cookie session gets, and no authorization check knows the difference.
  const principal = currentPrincipal();
  if (principal) {
    const [user] = await db().select().from(users).where(eq(users.id, principal.userId));
    if (!user) redirect('/signed-out');
    return user;
  }
  const token = (await cookies()).get('reliability-session')?.value;
  if (!token) redirect('/signed-out');
  const [row] = await db()
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, tokenHash(token)), gt(sessions.expiresAt, new Date())));
  if (!row) redirect('/signed-out');
  return row.user;
}

// Local identity only: this does not need GitHub credentials or network access.
// Returns null instead of redirecting, for callers that tolerate a signed-out visitor.
export async function currentUserId(): Promise<string | null> {
  const principal = currentPrincipal();
  if (principal) return principal.userId;
  const token = (await cookies()).get('reliability-session')?.value;
  if (!token) return null;
  const [session] = await db()
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.id, tokenHash(token)), gt(sessions.expiresAt, new Date())));
  return session?.userId ?? null;
}

export async function currentUser(): Promise<{
  id: string;
  login: string;
  displayName: string | null;
  avatarUrl: string | null;
}> {
  const user = await sessionUser();
  return {
    id: user.id,
    login: user.login,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };
}

export async function userClient() {
  const identity = await sessionUser();
  const accessToken = await db().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`user:${identity.id}`},0))`,
    );
    const [user] = await tx.select().from(users).where(eq(users.id, identity.id));
    if (!user) throw new Error('User unavailable');
    let credentials = credentialsSchema.parse(
      JSON.parse(decrypt(user.credentials, integrationEnv().TOKEN_ENCRYPTION_KEY)),
    );
    if (credentials.expiresAt && credentials.expiresAt < Date.now() + 60000) {
      if (!credentials.refreshToken) throw new Error('GitHub session expired; sign in again');
      credentials = await exchangeToken({
        grant_type: 'refresh_token',
        refresh_token: credentials.refreshToken,
      });
      await tx
        .update(users)
        .set({
          credentials: encrypt(JSON.stringify(credentials), integrationEnv().TOKEN_ENCRYPTION_KEY),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
    }
    return credentials.accessToken;
  });
  return new Octokit({ auth: accessToken, request: { timeout: 30000 } });
}
