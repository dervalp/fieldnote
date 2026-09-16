import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '..';
import * as s from '../schema';
import { detectExecuted, type ExecutedInput } from '../../domain/ai-involvement/detect-executed';
import { attributePullRequests } from '../../domain/ai-involvement/attribute';
import { DETECTOR_VERSION, type Detection } from '../../domain/ai-involvement/types';

type Transaction = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

/**
 * Reads the four row sets `detectExecuted` needs, scoped to one repository.
 * Every stored pull request is included — this is a repository-level fact,
 * not a pull-request listing, so the latest-100 visibility limit does not apply.
 */
async function readRows(tx: Transaction, repositoryId: string): Promise<ExecutedInput> {
  const prRows = await tx
    .select({
      id: s.pullRequests.id,
      authorLogin: s.pullRequests.authorLogin,
      headRef: s.pullRequests.headRef,
      markers: s.pullRequests.agentMarkers,
      occurredAt: s.pullRequests.openedAt,
    })
    .from(s.pullRequests)
    .where(eq(s.pullRequests.repositoryId, repositoryId));

  const checkRows = await tx
    .select({
      pullRequestId: s.prRuns.pullRequestId,
      appId: s.ciChecks.appId,
      startedAt: s.ciChecks.startedAt,
      completedAt: s.ciChecks.completedAt,
    })
    .from(s.ciChecks)
    .innerJoin(s.prRuns, eq(s.prRuns.ciRunId, s.ciChecks.ciRunId))
    .innerJoin(s.ciRuns, eq(s.ciRuns.id, s.ciChecks.ciRunId))
    .where(eq(s.ciRuns.repositoryId, repositoryId));

  const commitRows = await tx
    .select({
      pullRequestId: s.commits.pullRequestId,
      authorLogin: s.commits.authorLogin,
      occurredAt: s.commits.committedAt,
    })
    .from(s.commits)
    .innerJoin(s.pullRequests, eq(s.pullRequests.id, s.commits.pullRequestId))
    .where(eq(s.pullRequests.repositoryId, repositoryId));

  // Only actual review submissions count as executed evidence: a request or a
  // dismissal names a reviewer without anyone having run anything.
  const reviewRows = await tx
    .select({
      pullRequestId: s.reviewEvents.pullRequestId,
      reviewerId: s.reviewEvents.reviewerId,
      occurredAt: s.reviewEvents.occurredAt,
    })
    .from(s.reviewEvents)
    .innerJoin(s.pullRequests, eq(s.pullRequests.id, s.reviewEvents.pullRequestId))
    .where(and(eq(s.pullRequests.repositoryId, repositoryId), eq(s.reviewEvents.kind, 'review')));

  return {
    pullRequests: prRows.map((row) => ({
      id: row.id,
      authorLogin: row.authorLogin,
      headRef: row.headRef,
      markers: row.markers,
      occurredAt: row.occurredAt.toISOString(),
    })),
    checks: checkRows.map((row) => ({
      pullRequestId: row.pullRequestId,
      appId: row.appId,
      occurredAt: (row.startedAt ?? row.completedAt)?.toISOString() ?? null,
    })),
    commits: commitRows.map((row) => ({
      pullRequestId: row.pullRequestId,
      authorLogin: row.authorLogin,
      occurredAt: row.occurredAt?.toISOString() ?? null,
    })),
    reviews: reviewRows.map((row) => ({
      pullRequestId: row.pullRequestId,
      reviewerId: row.reviewerId,
      occurredAt: row.occurredAt.toISOString(),
    })),
  };
}

/**
 * Recomputes every 'executed' detection for a repository and replaces the
 * stored set atomically. Delete-then-insert (rather than upsert) is what
 * makes an agent whose evidence has disappeared actually vanish. 'configured'
 * and 'declared' rows are untouched here; later slices own them.
 */
export async function recomputeExecutedDetections(repositoryId: string): Promise<void> {
  await db().transaction(async (tx) => {
    // Same repository lock persistPr takes, so a concurrent sync cannot interleave.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${repositoryId},0))`);
    const rows = await readRows(tx, repositoryId);
    const detections = detectExecuted(rows);
    const attribution = attributePullRequests(rows);
    await tx
      .delete(s.repoAiDetections)
      .where(
        and(
          eq(s.repoAiDetections.repositoryId, repositoryId),
          eq(s.repoAiDetections.signal, 'executed'),
        ),
      );
    if (detections.length)
      await tx.insert(s.repoAiDetections).values(
        detections.map((detection) => ({
          repositoryId,
          agent: detection.agent,
          signal: detection.signal,
          kind: detection.kind,
          firstSeenAt: detection.firstSeenAt ? new Date(detection.firstSeenAt) : null,
          lastSeenAt: detection.lastSeenAt ? new Date(detection.lastSeenAt) : null,
          occurrences: detection.occurrences,
          evidence: detection.evidence,
          detectorVersion: DETECTOR_VERSION,
          refreshedAt: new Date(),
        })),
      );
    // Group ids by agent so this is one UPDATE per distinct agent, not one per
    // pull request.
    const byAgent = new Map<string, string[]>();
    for (const [prId, agent] of attribution) {
      byAgent.set(agent, [...(byAgent.get(agent) ?? []), prId]);
    }
    for (const [agent, prIds] of byAgent) {
      await tx
        .update(s.pullRequests)
        .set({ agentProvider: agent })
        .where(
          and(eq(s.pullRequests.repositoryId, repositoryId), inArray(s.pullRequests.id, prIds)),
        );
    }

    // configuredRefreshedAt and scannedSha are intentionally omitted: slice two owns them.
    const state = {
      repositoryId,
      detectorVersion: DETECTOR_VERSION,
      executedRefreshedAt: new Date(),
    };
    await tx
      .insert(s.repoDetectionState)
      .values(state)
      .onConflictDoUpdate({ target: s.repoDetectionState.repositoryId, set: state });
  });
}

export interface DetectionState {
  scannedSha: string | null;
  detectorVersion: string;
  executedRefreshedAt: Date | null;
  configuredRefreshedAt: Date | null;
  incompleteReason: string | null;
}

export async function loadDetections(
  repositoryId: string,
): Promise<{ detections: Detection[]; state: DetectionState | null }> {
  const rows = await db()
    .select()
    .from(s.repoAiDetections)
    .where(eq(s.repoAiDetections.repositoryId, repositoryId))
    // Postgres DESC implies NULLS FIRST; 'configured'/'declared' rows carry a
    // null occurrences, and this order feeds the detail route's render order
    // directly, so an explicit NULLS LAST keeps them from sorting above
    // executed rows once those signals start being written.
    .orderBy(sql`${s.repoAiDetections.occurrences} desc nulls last`, asc(s.repoAiDetections.agent));
  const [state] = await db()
    .select()
    .from(s.repoDetectionState)
    .where(eq(s.repoDetectionState.repositoryId, repositoryId));
  return {
    detections: rows.map((row) => ({
      agent: row.agent,
      kind: row.kind,
      signal: row.signal,
      firstSeenAt: row.firstSeenAt?.toISOString() ?? null,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      occurrences: row.occurrences,
      evidence: row.evidence,
    })),
    // Distinguishes "we never looked" (null) from "we looked and found nothing" ([]).
    state: state ?? null,
  };
}

/**
 * Worker-safe detection read: it relies only on the repository id and returns
 * normalized evidence, never browser/session state or the detection scan state.
 */
export async function loadDetectionsForWorker(repositoryId: string): Promise<Detection[]> {
  const rows = await db()
    .select({
      agent: s.repoAiDetections.agent,
      kind: s.repoAiDetections.kind,
      signal: s.repoAiDetections.signal,
      firstSeenAt: s.repoAiDetections.firstSeenAt,
      lastSeenAt: s.repoAiDetections.lastSeenAt,
      occurrences: s.repoAiDetections.occurrences,
      evidence: s.repoAiDetections.evidence,
    })
    .from(s.repoAiDetections)
    .where(eq(s.repoAiDetections.repositoryId, repositoryId))
    .orderBy(sql`${s.repoAiDetections.occurrences} desc nulls last`, asc(s.repoAiDetections.agent));
  return rows.map((row) => ({
    agent: row.agent,
    kind: row.kind,
    signal: row.signal,
    firstSeenAt: row.firstSeenAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    occurrences: row.occurrences,
    evidence: row.evidence.map((evidence) => ({
      source: evidence.source,
      value: evidence.value,
      prCount: evidence.prCount,
    })),
  }));
}
