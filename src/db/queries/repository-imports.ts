// Trusted server persistence primitives. Browser-facing actions must authorize callers first.
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import { db } from '../index';
import {
  installations,
  repositories,
  repositoryImports as runs,
  repositoryImportItems as items,
} from '../schema';
import { isActiveImport, summarizeImport } from '../../domain/import/progress';
import {
  ImportRequestError,
  type ImportExecution,
  type ImportSnapshot,
} from '../../domain/import/types';

const importingMessage = 'Importing PR and CI history. GitHub requests may retry automatically.';

// Shared with the Node sync CLI: checking tracking needs only the database.
export async function assertTrackedRepository(repositoryId: string): Promise<void> {
  const [record] = await db()
    .select({ id: repositories.id })
    .from(repositories)
    .innerJoin(installations, eq(installations.id, repositories.installationId))
    .where(
      and(
        eq(repositories.id, repositoryId),
        eq(repositories.active, true),
        eq(repositories.isDemo, false),
        isNotNull(repositories.trackingStartedAt),
        eq(installations.active, true),
      ),
    );
  if (!record) throw new Error(`Repository is not tracked: ${repositoryId}`);
}

type Run = typeof runs.$inferSelect;
type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];
function snapshot(run: Run): ImportSnapshot {
  return {
    id: run.id,
    repositoryId: run.repositoryId,
    state: run.state,
    total: run.total,
    completed: run.completed,
    failed: run.failed,
    message: run.message,
    createdAt: run.createdAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}
async function execution(tx: Tx, run: Run): Promise<ImportExecution> {
  return {
    snapshot: snapshot(run),
    items: await tx
      .select({ number: items.number, state: items.state })
      .from(items)
      .where(eq(items.runId, run.id))
      .orderBy(asc(items.number)),
  };
}
async function lockRepository(tx: Tx, repositoryId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${repositoryId},0))`);
}
async function withRun<T>(runId: string, operation: (tx: Tx, run: Run) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => {
    const [lookup] = await tx
      .select({ repositoryId: runs.repositoryId })
      .from(runs)
      .where(eq(runs.id, runId));
    if (!lookup) throw new Error('Import not found');
    await lockRepository(tx, lookup.repositoryId);
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).for('update');
    return operation(tx, run);
  });
}
export async function requestRepositoryImport(
  repositoryId: string,
  intent: 'start' | 'refresh' | 'retry',
  previousRunId?: string,
): Promise<ImportSnapshot> {
  return db().transaction(async (tx) => {
    await lockRepository(tx, repositoryId);
    const [available] = await tx
      .select({ repository: repositories })
      .from(repositories)
      .innerJoin(installations, eq(installations.id, repositories.installationId))
      .where(
        and(
          eq(repositories.id, repositoryId),
          eq(repositories.active, true),
          eq(repositories.isDemo, false),
          eq(installations.active, true),
        ),
      );
    if (!available) throw new ImportRequestError('Repository unavailable');
    const [latest] = await tx
      .select()
      .from(runs)
      .where(eq(runs.repositoryId, repositoryId))
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(1);
    let source: Run | undefined;
    if (intent === 'retry') {
      if (!previousRunId) throw new ImportRequestError('Previous import required');
      [source] = await tx
        .select()
        .from(runs)
        .where(and(eq(runs.id, previousRunId), eq(runs.repositoryId, repositoryId)));
      if (!source || !['failed', 'partial'].includes(source.state))
        throw new ImportRequestError('Import cannot be retried');
      const [existing] = await tx.select().from(runs).where(eq(runs.retryOf, source.id));
      if (existing) return snapshot(existing);
      if (latest?.id !== source.id)
        throw new ImportRequestError('Only the latest import can be retried');
    }
    if (intent === 'refresh' && !available.repository.trackingStartedAt)
      throw new ImportRequestError('Repository is not tracked');
    const [active] = await tx
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.repositoryId, repositoryId),
          inArray(runs.state, ['queued', 'discovering', 'importing']),
        ),
      );
    if (active) return snapshot(active);
    if (intent === 'start' && latest) return snapshot(latest);
    const runId = randomUUID();
    const successful = source
      ? (await execution(tx, source)).items.filter((item) => item.state === 'complete').length
      : 0;
    const [run] = await tx
      .insert(runs)
      .values({
        id: runId,
        repositoryId,
        retryOf: source?.id,
        state: 'queued',
        total: source?.total ?? null,
        completed: successful,
      })
      .returning();
    if (source && source.total !== null) {
      const previous = (await execution(tx, source)).items;
      if (previous.length)
        await tx.insert(items).values(
          previous.map((item) => ({
            runId,
            number: item.number,
            state: item.state === 'complete' ? ('complete' as const) : ('pending' as const),
          })),
        );
    }
    await tx
      .update(repositories)
      .set({ trackingStartedAt: available.repository.trackingStartedAt ?? new Date() })
      .where(eq(repositories.id, repositoryId));
    return snapshot(run);
  });
}
export async function getImport(runId: string): Promise<ImportExecution | null> {
  // Hold the same lock as mutations so counts and item states form one snapshot.
  return db().transaction(async (tx) => {
    const [lookup] = await tx.select().from(runs).where(eq(runs.id, runId));
    if (!lookup) return null;
    await lockRepository(tx, lookup.repositoryId);
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId));
    return execution(tx, run);
  });
}
export async function latestImport(repositoryId: string): Promise<ImportSnapshot | null> {
  const [run] = await db()
    .select()
    .from(runs)
    .where(eq(runs.repositoryId, repositoryId))
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(1);
  return run ? snapshot(run) : null;
}
export async function beginImport(runId: string): Promise<ImportExecution> {
  return withRun(runId, async (tx, run) => {
    if (run.state === 'queued') {
      [run] = await tx
        .update(runs)
        .set({
          state: run.total === null ? 'discovering' : 'importing',
          startedAt: new Date(),
          message: run.total === null ? null : importingMessage,
        })
        .where(eq(runs.id, runId))
        .returning();
    }
    return execution(tx, run);
  });
}
export async function saveImportBatch(runId: string, numbers: number[]): Promise<ImportExecution> {
  return withRun(runId, async (tx, run) => {
    if (!isActiveImport(run.state) || run.total !== null) return execution(tx, run);
    const distinct = [...new Set(numbers)];
    if (
      distinct.length > 100 ||
      distinct.some((number) => !Number.isSafeInteger(number) || number <= 0 || number > 2147483647)
    )
      throw new Error('Invalid import batch');
    if (distinct.length)
      await tx.insert(items).values(distinct.map((number) => ({ runId, number })));
    [run] = await tx
      .update(runs)
      .set({ total: distinct.length, state: 'importing', message: importingMessage })
      .where(eq(runs.id, runId))
      .returning();
    return execution(tx, run);
  });
}
export async function recordImportItem(
  runId: string,
  number: number,
  outcome: 'complete' | 'failed',
): Promise<void> {
  await withRun(runId, async (tx, run) => {
    if (!isActiveImport(run.state)) return;
    await tx
      .update(items)
      .set({ state: outcome })
      .where(and(eq(items.runId, runId), eq(items.number, number), eq(items.state, 'pending')));
    const summary = summarizeImport((await execution(tx, run)).items);
    await tx
      .update(runs)
      .set({ completed: summary.completed, failed: summary.failed })
      .where(eq(runs.id, runId));
  });
}
export async function finishImport(runId: string): Promise<ImportSnapshot> {
  return withRun(runId, async (tx, run) => {
    if (!isActiveImport(run.state)) return snapshot(run);
    const summary = summarizeImport((await execution(tx, run)).items);
    if (run.total === null || summary.state === 'importing')
      throw new Error('Import still has pending work');
    const [finished] = await tx
      .update(runs)
      .set({
        ...summary,
        message: summary.failed ? 'Some PRs could not be imported. Please retry.' : null,
        finishedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning();
    return snapshot(finished);
  });
}
export async function failImport(runId: string, message: string): Promise<void> {
  await withRun(runId, async (tx, run) => {
    if (!isActiveImport(run.state)) return;
    await tx
      .update(runs)
      .set({ state: 'failed', message, finishedAt: new Date() })
      .where(eq(runs.id, runId));
  });
}

export async function listUndispatchedImports(): Promise<string[]> {
  return (
    await db()
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.state, 'queued'), isNull(runs.dispatchedAt)))
      .orderBy(asc(runs.createdAt), asc(runs.id))
      .limit(100)
  ).map((run) => run.id);
}
export async function markImportDispatched(runId: string): Promise<void> {
  await db()
    .update(runs)
    .set({ dispatchedAt: new Date() })
    .where(and(eq(runs.id, runId), isNull(runs.dispatchedAt)));
}
