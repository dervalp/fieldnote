import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { closeDb, db } from './index';
import { users, sessions, userInterests } from './schema';
import { tokenHash } from '../auth/crypto';
import { persistHistoryInterest, hasHistoryInterest } from './queries/history-interest';
const { cookie } = vi.hoisted(() => ({ cookie: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: cookie }) }));
import { registerHistoryInterest, historyInterestStatus } from '../app/app/dashboard/history-actions';
const userId = `interest-${randomUUID()}`;
const otherUserId = `${userId}-other`;
const token = `${userId}-synthetic-session`;
beforeAll(async () => {
  vi.stubEnv('DEMO_MODE', 'true');
  await migrate(db(), { migrationsFolder: 'drizzle' });
  await db()
    .insert(users)
    .values(
      [userId, otherUserId].map((id) => ({ id, login: id, credentials: 'synthetic-unused' })),
    );
  await db()
    .insert(sessions)
    .values({ id: tokenHash(token), userId, expiresAt: new Date(Date.now() + 60000) });
});
afterAll(async () => {
  await db()
    .delete(userInterests)
    .where(inArray(userInterests.userId, [userId, otherUserId]));
  await db().delete(sessions).where(eq(sessions.userId, userId));
  await db()
    .delete(users)
    .where(inArray(users.id, [userId, otherUserId]));
  await closeDb();
  vi.unstubAllEnvs();
});
test('duplicate and concurrent registrations persist one feature row for the authenticated user', async () => {
  cookie.mockReturnValue({ value: token });
  expect(await historyInterestStatus()).toEqual({ status: 'unregistered' });
  expect(await Promise.all(Array.from({ length: 4 }, () => registerHistoryInterest()))).toEqual(
    Array.from({ length: 4 }, () => ({ status: 'registered' })),
  );
  expect(await historyInterestStatus()).toEqual({ status: 'registered' });
  const rows = await db().select().from(userInterests).where(eq(userInterests.userId, userId));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ userId, feature: 'expanded-history' });
  expect(await hasHistoryInterest(otherUserId)).toBe(false);
});
test('missing and expired sessions cannot register even in demo mode', async () => {
  cookie.mockReturnValue(undefined);
  await expect(registerHistoryInterest()).rejects.toThrow('Sign in');
  await db()
    .update(sessions)
    .set({ expiresAt: new Date(0) })
    .where(eq(sessions.userId, userId));
  cookie.mockReturnValue({ value: token });
  await expect(registerHistoryInterest()).rejects.toThrow('Sign in');
  expect(await historyInterestStatus()).toEqual({ status: 'signed-out' });
});
test('foreign-key persistence failure is rejected without a saved registration', async () => {
  await expect(persistHistoryInterest(`${userId}-missing`)).rejects.toThrow();
  expect(await hasHistoryInterest(`${userId}-missing`)).toBe(false);
});
