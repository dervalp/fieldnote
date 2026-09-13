import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { closeDb, db } from './index';
import {
  historyBackfills,
  historyBackfillItems,
  installations,
  repositories,
  repositoryImports,
  githubEvents,
} from './schema';
import {
  ensureHistoryBackfill,
  getHistoryBackfill,
  listHistoryRecovery,
  processHistorySlice,
} from './queries/history-backfill';
import { dispatchHistoryBackfill } from '../inngest/dispatch-history';
const fixture = `backfill-${randomUUID()}`;
const repos: string[] = [];
async function repository() {
  const id = `${fixture}-${repos.length}`;
  repos.push(id);
  await db().insert(repositories).values({
    id,
    installationId: fixture,
    githubRepositoryId: id,
    owner: 'test',
    name: id,
    defaultBranch: 'main',
    isPrivate: true,
    trackingStartedAt: new Date(),
  });
  return id;
}
beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
  await db().insert(installations).values({
    id: fixture,
    githubInstallationId: fixture,
    accountLogin: fixture,
    accountType: 'Organization',
  });
});
afterAll(async () => {
  const runs = await db()
    .select()
    .from(historyBackfills)
    .where(inArray(historyBackfills.repositoryId, repos));
  if (runs.length)
    await db()
      .delete(historyBackfillItems)
      .where(
        inArray(
          historyBackfillItems.backfillId,
          runs.map((r) => r.id),
        ),
      );
  await db().delete(historyBackfills).where(inArray(historyBackfills.repositoryId, repos));
  await db().delete(repositoryImports).where(inArray(repositoryImports.repositoryId, repos));
  await db().delete(githubEvents).where(eq(githubEvents.installationId, fixture));
  await db().delete(repositories).where(inArray(repositories.id, repos));
  await db().delete(installations).where(eq(installations.id, fixture));
  await closeDb();
});
test('stable run fixes one calendar-year cutoff, including leap day', async () => {
  const repo = await repository();
  const ids = await Promise.all([
    ensureHistoryBackfill(repo, new Date('2024-02-29T12:00:00Z')),
    ensureHistoryBackfill(repo, new Date('2024-02-29T12:00:00Z')),
  ]);
  expect(ids[0]).toBe(ids[1]);
  expect((await getHistoryBackfill(ids[0]))?.cutoff).toBe('2023-02-28T12:00:00.000Z');
});
test('checkpoints pages before hydration, resumes, deduplicates, and sweeps for moving PRs', async () => {
  const repo = await repository(),
    id = await ensureHistoryBackfill(repo);
  const discover = vi
    .fn()
    .mockResolvedValueOnce({ numbers: [2, 1], nextPage: 2 })
    .mockResolvedValueOnce({ numbers: [1, 3], nextPage: null })
    .mockResolvedValueOnce({ numbers: [4, 2], nextPage: 2 })
    .mockResolvedValueOnce({ numbers: [1, 3], nextPage: null });
  const hydrate = vi.fn().mockResolvedValue(undefined);
  await processHistorySlice(repo, id, { discover, hydrate });
  expect(await getHistoryBackfill(id)).toMatchObject({
    total: 2,
    completed: 0,
    cursor: { page: 2, sweep: 0 },
  });
  expect(hydrate).not.toHaveBeenCalled();
  for (let n = 0; n < 10; n++) await processHistorySlice(repo, id, { discover, hydrate });
  expect(await getHistoryBackfill(id)).toMatchObject({
    status: 'complete',
    total: 4,
    completed: 4,
  });
  expect(hydrate.mock.calls.map((call) => call[1]).sort()).toEqual([1, 2, 3, 4]);
  expect(discover.mock.calls.map((call) => call[2])).toEqual([1, 2, 1, 2]);
  expect(await ensureHistoryBackfill(repo)).toBe(id);
});
test('persists rate limit retries and recovers pending work without changing initial import success', async () => {
  const repo = await repository(),
    id = await ensureHistoryBackfill(repo);
  await db()
    .insert(repositoryImports)
    .values({
      id: `${repo}-initial`,
      repositoryId: repo,
      state: 'complete',
      total: 0,
      finishedAt: new Date(),
    });
  const discover = vi.fn().mockResolvedValue({ numbers: [1], nextPage: null });
  const hydrate = vi
    .fn()
    .mockRejectedValueOnce({ status: 429, response: { headers: { 'retry-after': '120' } } })
    .mockResolvedValue(undefined);
  const now = new Date('2026-09-08T00:00:00Z');
  await processHistorySlice(repo, id, { discover, hydrate, now: () => now });
  await processHistorySlice(repo, id, { discover, hydrate, now: () => now });
  expect(await getHistoryBackfill(id)).toMatchObject({
    status: 'retrying',
    retryAt: '2026-09-08T00:02:00.000Z',
    completed: 0,
  });
  await processHistorySlice(repo, id, { discover, hydrate, now: () => now });
  expect(hydrate).toHaveBeenCalledTimes(1);
  expect(await listHistoryRecovery(new Date('2026-09-08T00:03:00Z'))).toContain(id);
  await processHistorySlice(repo, id, {
    discover,
    hydrate,
    now: () => new Date('2026-09-08T00:03:00Z'),
  });
  expect((await getHistoryBackfill(id))?.completed).toBe(1);
  const [initial] = await db()
    .select()
    .from(repositoryImports)
    .where(eq(repositoryImports.id, `${repo}-initial`));
  expect(initial.state).toBe('complete');
});
test('suspension prevents discovery and hydration, and mismatched events mutate nothing', async () => {
  const repo = await repository(),
    id = await ensureHistoryBackfill(repo);
  const discover = vi.fn().mockResolvedValue({ numbers: [1], nextPage: null }),
    hydrate = vi.fn();
  await processHistorySlice(repo, id, { discover, hydrate });
  await db().update(repositories).set({ active: false }).where(eq(repositories.id, repo));
  await processHistorySlice(repo, id, { discover, hydrate });
  expect(hydrate).not.toHaveBeenCalled();
  expect((await getHistoryBackfill(id))?.errorCategory).toBe('access');
  await expect(processHistorySlice('other', id, { discover, hydrate })).rejects.toThrow(
    'unavailable',
  );
});
test('active initial imports and fresh webhook work defer background collection', async () => {
  const repo = await repository(),
    id = await ensureHistoryBackfill(repo);
  const discover = vi.fn(),
    hydrate = vi.fn();
  await db()
    .insert(repositoryImports)
    .values({ id: `${repo}-initial`, repositoryId: repo, state: 'queued' });
  await processHistorySlice(repo, id, { discover, hydrate });
  expect(discover).not.toHaveBeenCalled();
  await db()
    .update(repositoryImports)
    .set({ state: 'complete' })
    .where(eq(repositoryImports.id, `${repo}-initial`));
  await db().insert(githubEvents).values({
    id: repo,
    deliveryId: repo,
    eventName: 'pull_request',
    installationId: fixture,
    payload: {},
  });
  await processHistorySlice(repo, id, {
    discover,
    hydrate,
    now: () => new Date(Date.now() + 120000),
  });
  expect(discover).not.toHaveBeenCalled();
  await db().update(githubEvents).set({ processedAt: new Date() }).where(eq(githubEvents.id, repo));
});
test('bounds concurrent background collection across repositories in one installation', async () => {
  const repoA = await repository(),
    repoB = await repository();
  const idA = await ensureHistoryBackfill(repoA),
    idB = await ensureHistoryBackfill(repoB);
  let finish!: (value: { numbers: number[]; nextPage: null }) => void;
  const discoverA = vi.fn(
    () =>
      new Promise<{ numbers: number[]; nextPage: null }>((resolve) => {
        finish = resolve;
      }),
  );
  const running = processHistorySlice(repoA, idA, { discover: discoverA, hydrate: vi.fn() });
  await vi.waitFor(() => expect(discoverA).toHaveBeenCalled());
  const discoverB = vi.fn();
  await processHistorySlice(repoB, idB, { discover: discoverB, hydrate: vi.fn() });
  expect(discoverB).not.toHaveBeenCalled();
  const contended = await getHistoryBackfill(idB);
  finish({ numbers: [], nextPage: null });
  await running;
  expect(contended).toMatchObject({ status: 'retrying', errorCategory: 'contention' });
  expect(Date.parse(contended!.retryAt!) - Date.now()).toBeLessThan(61000);
});
test('dispatch acknowledgement gaps reuse identity, and stale dispatched work is recoverable', async () => {
  const repo = await repository(),
    id = await ensureHistoryBackfill(repo);
  const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  await expect(dispatchHistoryBackfill(id, send)).rejects.toThrow('offline');
  await dispatchHistoryBackfill(id, send);
  expect(send.mock.calls[0][0].id).toBe(send.mock.calls[1][0].id);
  expect(send.mock.calls[0][0].data).toMatchObject({ repositoryId: repo, backfillId: id });
  expect(await listHistoryRecovery(new Date(Date.now() + 20 * 60000))).toContain(id);
});

test('an installation-wide primary rate limit defers other repositories until reset', async () => {
  const repoA = await repository(),
    repoB = await repository();
  const idA = await ensureHistoryBackfill(repoA),
    idB = await ensureHistoryBackfill(repoB);
  const now = new Date('2026-09-09T00:00:00Z');
  const discoverA = vi.fn().mockRejectedValue({
    status: 403,
    response: {
      headers: {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(now.getTime() / 1000 + 600),
      },
    },
  });
  await processHistorySlice(repoA, idA, { discover: discoverA, now: () => now });
  expect(await getHistoryBackfill(idA)).toMatchObject({
    errorCategory: 'rate-limit',
    retryAt: '2026-09-09T00:10:01.000Z',
  });
  const discoverB = vi.fn().mockResolvedValue({ numbers: [], nextPage: null });
  await processHistorySlice(repoB, idB, { discover: discoverB, now: () => now });
  expect(discoverB).not.toHaveBeenCalled();
  expect((await getHistoryBackfill(idB))?.retryAt).toBe('2026-09-09T00:10:01.000Z');
});

test('a missing PR finishes partial while discovery failures preserve the cursor for recovery', async () => {
  const repo = await repository(),
    id = await ensureHistoryBackfill(repo);
  const now = new Date('2026-09-10T00:00:00Z');
  const discover = vi
    .fn()
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValue({ numbers: [1], nextPage: null });
  const hydrate = vi.fn().mockRejectedValue({ status: 404 });
  await processHistorySlice(repo, id, { discover, hydrate, now: () => now });
  expect(await getHistoryBackfill(id)).toMatchObject({
    status: 'retrying',
    cursor: { page: 1, sweep: 0 },
    total: 0,
  });
  for (let n = 0; n < 4; n++)
    await processHistorySlice(repo, id, {
      discover,
      hydrate,
      now: () => new Date(now.getTime() + 360000),
    });
  expect(await getHistoryBackfill(id)).toMatchObject({
    status: 'partial',
    total: 1,
    completed: 0,
    failed: 1,
  });
  expect(hydrate).toHaveBeenCalledTimes(1);
});

test('the reconciliation sweep rehydrates changed source timestamps and preserves unchanged successes', async () => {
  const repo = await repository(),
    id = await ensureHistoryBackfill(repo);
  const now = () => new Date('2026-09-11T00:00:00Z');
  const discover = vi
    .fn()
    .mockResolvedValueOnce({
      numbers: [1, 2],
      nextPage: null,
      sourceUpdatedAt: { 1: '2026-09-01T00:00:00Z', 2: '2026-09-01T00:00:00Z' },
    })
    .mockResolvedValueOnce({
      numbers: [1, 2],
      nextPage: null,
      sourceUpdatedAt: { 1: '2026-09-02T00:00:00Z', 2: '2026-09-01T00:00:00Z' },
    });
  const hydrate = vi.fn().mockResolvedValue(undefined);
  for (let n = 0; n < 6; n++) await processHistorySlice(repo, id, { discover, hydrate, now });
  expect(await getHistoryBackfill(id)).toMatchObject({
    status: 'complete',
    total: 2,
    completed: 2,
  });
  expect(hydrate.mock.calls.map((call) => call[1])).toEqual([1, 2, 1]);
});

test('repeated secondary rate limits back off across persisted retries', async () => {
  const repo = await repository(),
    id = await ensureHistoryBackfill(repo);
  const discover = vi.fn().mockRejectedValue({ status: 429 });
  await processHistorySlice(repo, id, { discover, now: () => new Date('2026-09-12T00:00:00Z') });
  await processHistorySlice(repo, id, { discover, now: () => new Date('2026-09-12T00:01:00Z') });
  expect((await getHistoryBackfill(id))?.retryAt).toBe('2026-09-12T00:03:00.000Z');
});

test('Retry-After starts when a long hydration returns and recognizes secondary 403 responses', async () => {
  const repo = await repository(),
    id = await ensureHistoryBackfill(repo);
  let now = new Date('2026-09-13T00:00:00Z');
  const discover = vi.fn().mockResolvedValue({ numbers: [1], nextPage: null });
  await processHistorySlice(repo, id, { discover, now: () => now });
  const hydrate = vi.fn().mockImplementation(async () => {
    now = new Date('2026-09-13T00:05:00Z');
    throw { status: 403, message: 'You have exceeded a secondary rate limit.' };
  });
  await processHistorySlice(repo, id, { hydrate, now: () => now });
  expect(await getHistoryBackfill(id)).toMatchObject({
    errorCategory: 'rate-limit',
    retryAt: '2026-09-13T00:06:00.000Z',
  });
});

test('installation contention preserves a future rate-limit deadline and its installation pause', async () => {
  const repoA = await repository(),
    repoB = await repository();
  const idA = await ensureHistoryBackfill(repoA),
    idB = await ensureHistoryBackfill(repoB);
  const now = new Date('2030-01-01T00:00:00Z');
  const retryAt = new Date('2030-01-01T01:00:00Z');
  await db()
    .update(historyBackfills)
    .set({ status: 'retrying', retryAt, errorCategory: 'rate-limit' })
    .where(eq(historyBackfills.id, idA));
  const before = await getHistoryBackfill(idA);
  let release!: () => void,
    locked = false;
  const holding = db().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`history-installation:${fixture}`},0))`,
    );
    locked = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  const discover = vi.fn().mockResolvedValue({ numbers: [], nextPage: null });
  let after;
  try {
    await vi.waitFor(() => expect(locked).toBe(true));
    await processHistorySlice(repoA, idA, { discover, now: () => now });
    after = await getHistoryBackfill(idA);
  } finally {
    release();
    await holding;
  }
  expect(after).toMatchObject({
    status: 'retrying',
    errorCategory: 'rate-limit',
    retryAt: '2030-01-01T01:00:00.000Z',
    cursor: before!.cursor,
  });
  await processHistorySlice(repoB, idB, { discover, now: () => new Date('2030-01-01T00:02:00Z') });
  expect(discover).not.toHaveBeenCalled();
  expect(await getHistoryBackfill(idB)).toMatchObject({
    errorCategory: 'rate-limit',
    retryAt: '2030-01-01T01:00:00.000Z',
  });
});

test('a concurrent future pause wins over a contending worker that read the older cursor', async () => {
  const repo = await repository(),
    id = await ensureHistoryBackfill(repo);
  const now = new Date('2031-01-01T00:00:00Z');
  let release!: () => void,
    locked = false;
  const holding = db().transaction(async (tx) => {
    await tx.select().from(historyBackfills).where(eq(historyBackfills.id, id)).for('update');
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`history-installation:${fixture}`},0))`,
    );
    locked = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    // Preserve the cursor: the retry predicate must guard independently of cursor equality.
    await tx
      .update(historyBackfills)
      .set({
        status: 'retrying',
        retryAt: new Date('2031-01-01T01:00:00Z'),
        errorCategory: 'rate-limit',
      })
      .where(eq(historyBackfills.id, id));
  });
  let pending: Promise<void> | undefined;
  let observer: ReturnType<typeof postgres> | undefined;
  try {
    await vi.waitFor(() => expect(locked).toBe(true));
    pending = processHistorySlice(repo, id, { now: () => now, discover: vi.fn() });
    // The lock-wait check is diagnostic, not part of the behaviour under test, so
    // it gets its own connection rather than competing for `db()`'s pool. By this
    // point that pool (max: 2) is fully committed — one connection held open by
    // `holding`, one taken by `processHistorySlice` — so asking it for a third
    // here waits for a slot that only `release()` below can free, and `release()`
    // is only reached once this poll succeeds. That is a deadlock, not a flake.
    observer = postgres(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!, { max: 1 });
    await vi.waitFor(async () => {
      const [waiting] = await observer!<{ count: number }[]>`
        select count(*)::int as count from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'
          and query like 'update "history_backfills"%'`;
      expect(waiting.count).toBeGreaterThan(0);
    });
  } finally {
    release();
    await holding;
    await pending;
    await observer?.end();
  }
  expect(await getHistoryBackfill(id)).toMatchObject({
    status: 'retrying',
    errorCategory: 'rate-limit',
    retryAt: '2031-01-01T01:00:00.000Z',
    cursor: { revision: 0 },
  });
});
