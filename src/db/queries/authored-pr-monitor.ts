import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../index';
import {
  authoredPullRequests as prs,
  authoredPullRequestRepairs as repairs,
  authoringNotes as notes,
} from '../schema';
import type { Feedback, HumanReason } from '../../domain/act/pr-monitor';

export async function findAuthoredPr(repositoryId: string, number: number) {
  return (
    (
      await db()
        .select()
        .from(prs)
        .where(and(eq(prs.repositoryId, repositoryId), eq(prs.number, number)))
    )[0] ?? null
  );
}
export async function listMonitoredPrs() {
  // Merged rows remain eligible until Task 12 observes the default branch;
  // repeated verify requests are intentionally safe and recover send failures.
  return db()
    .select({ id: prs.id })
    .from(prs)
    .where(inArray(prs.outcome, ['open', 'merged']));
}
export async function loadAuthoredPrMonitor(id: string) {
  return db().transaction((tx) => lockedMonitorContext(tx, id));
}
type Transaction = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];
async function lockedMonitorContext(tx: Transaction, id: string) {
  // Finalization/reservation use this same lock first. The head and attempts
  // must describe one committed generation, even under READ COMMITTED.
  const [pr] = await tx.select().from(prs).where(eq(prs.id, id)).for('update');
  if (!pr) return null;
  const attempts = await tx
    .select()
    .from(repairs)
    .where(eq(repairs.authoredPullRequestId, id))
    .orderBy(asc(repairs.ordinal));
  const [stopped] = await tx
    .select({ id: notes.id })
    .from(notes)
    .where(eq(notes.id, `monitor:${id}:human`));
  return { pr, repairs: attempts, humanRequired: Boolean(stopped) };
}
export async function reservePrRepair(id: string, headSha: string, trigger: Feedback) {
  return db().transaction(async (tx) => {
    const [pr] = await tx.select().from(prs).where(eq(prs.id, id)).for('update');
    if (
      !pr ||
      pr.outcome !== 'open' ||
      pr.headSha !== headSha ||
      trigger.disposition !== 'actionable'
    )
      return null;
    const previous = await tx
      .select()
      .from(repairs)
      .where(eq(repairs.authoredPullRequestId, id))
      .orderBy(asc(repairs.ordinal));
    const active = previous.find((row) => ['queued', 'running'].includes(row.state));
    if (active) return active;
    const reference = JSON.stringify(trigger);
    if (
      previous.length >= 3 ||
      previous.some(
        (row) =>
          row.state === 'complete' &&
          row.baseHeadSha === headSha &&
          row.triggerReference === reference,
      )
    )
      return null;
    return (
      await tx
        .insert(repairs)
        .values({
          id: randomUUID(),
          authoredPullRequestId: id,
          ordinal: previous.length + 1,
          triggerKind: trigger.kind,
          triggerReference: reference,
          state: 'queued',
          baseHeadSha: headSha,
        })
        .returning()
    )[0];
  });
}
export async function publishPrRepair(
  prId: string,
  repairId: string,
  publish: (
    context: NonNullable<Awaited<ReturnType<typeof loadAuthoredPrMonitor>>>,
  ) => Promise<{ headSha: string }>,
) {
  const result = await settlePrRepair(prId, repairId, publish);
  return result && 'headSha' in result ? result : null;
}
export async function reconcilePrRepairFailure(
  prId: string,
  repairId: string,
  probe: (
    context: NonNullable<Awaited<ReturnType<typeof loadAuthoredPrMonitor>>>,
  ) => Promise<{ headSha: string } | { unpublished: true }>,
) {
  return settlePrRepair(prId, repairId, probe);
}
async function settlePrRepair(
  prId: string,
  repairId: string,
  probe: (
    context: NonNullable<Awaited<ReturnType<typeof loadAuthoredPrMonitor>>>,
  ) => Promise<{ headSha: string } | { unpublished: true }>,
) {
  return db().transaction(async (tx) => {
    const context = await lockedMonitorContext(tx, prId);
    const attempt = context?.repairs.find((repair) => repair.id === repairId);
    if (
      !context ||
      !attempt ||
      context.humanRequired ||
      context.pr.outcome !== 'open' ||
      context.pr.headSha !== attempt.baseHeadSha ||
      !['queued', 'running'].includes(attempt.state)
    )
      return null;
    // Hold the PR lock through the ref mutation and durable completion. A
    // separate onFailure invocation must wait, then observe complete; if it
    // finalized first, the guard above forbids publishing anything.
    // Failure recovery probes under this same lock: a base-head observation
    // cannot race publication (including a publication whose DB commit fails).
    const result = await probe(context);
    const published = 'headSha' in result;
    await tx
      .update(repairs)
      .set({
        state: published ? 'complete' : 'failed',
        resultHeadSha: published ? result.headSha : null,
        errorCode: published ? null : 'repair_failed',
        completedAt: new Date(),
      })
      .where(eq(repairs.id, repairId));
    if (published) await tx.update(prs).set({ headSha: result.headSha }).where(eq(prs.id, prId));
    return result;
  });
}
export async function finishPrRepair(
  id: string,
  result: { headSha: string } | { errorCode: HumanReason },
) {
  await db().transaction(async (tx) => {
    const [repair] = await tx.select().from(repairs).where(eq(repairs.id, id));
    if (!repair) return;
    // Use the PR lock everywhere before touching attempts, including finalization.
    await tx.select().from(prs).where(eq(prs.id, repair.authoredPullRequestId)).for('update');
    const [updated] = await tx
      .update(repairs)
      .set({
        state: 'headSha' in result ? 'complete' : 'failed',
        resultHeadSha: 'headSha' in result ? result.headSha : null,
        errorCode: 'errorCode' in result ? result.errorCode : null,
        completedAt: new Date(),
      })
      .where(and(eq(repairs.id, id), inArray(repairs.state, ['queued', 'running'])))
      .returning();
    if (updated && 'headSha' in result)
      await tx
        .update(prs)
        .set({ headSha: result.headSha })
        .where(
          and(
            eq(prs.id, repair.authoredPullRequestId),
            eq(prs.headSha, repair.baseHeadSha),
            eq(prs.outcome, 'open'),
          ),
        );
  });
}
export async function recordPrOutcome(
  id: string,
  snapshot: { outcome: 'open' | 'merged' | 'closed'; headSha: string },
) {
  // Open snapshots never adopt an unknown head: repair's compare-and-set owns it.
  if (snapshot.outcome === 'open') return;
  await db()
    .update(prs)
    .set({
      outcome: snapshot.outcome,
      closedAt: new Date(),
      ...(snapshot.outcome === 'merged' ? { mergedAt: new Date() } : {}),
    })
    .where(eq(prs.id, id));
}
export async function recordMonitorHumanRequired(id: string, reason: HumanReason) {
  await db().transaction(async (tx) => {
    const [pr] = await tx.select().from(prs).where(eq(prs.id, id)).for('update');
    if (!pr) return;
    await tx
      .insert(notes)
      .values({
        id: `monitor:${id}:human`,
        authoringRunId: pr.authoringRunId,
        speaker: 'agent',
        kind: 'remark',
        body: `Setup pull request needs human action: ${reason}.`,
      })
      .onConflictDoNothing();
  });
}
