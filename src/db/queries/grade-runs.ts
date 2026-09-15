import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../index';
import {
  gradeRuns as runs,
  gradingRubrics,
  installations,
  repositories,
  workspaceRepositories,
  workspaceMemberships,
} from '../schema';
import {
  accessibleRepositories,
  requireRepository,
  requireWorkspace,
} from '../../workspaces/access';
import { currentUser } from '../../auth/session';
import { getGrader } from '../../domain/grading/registry';
import { manifestHash } from '../../domain/grading/manifest-hash';
import { rubricView } from '../../domain/grading/rubric-view';
import type { GraderManifest } from '../../domain/grading/manifest';
import type { GradeResult } from '../../domain/grading/types';
export type GradeRun = typeof runs.$inferSelect;
export type CompletedGrade = GradeResult & { id: string; sha: string; computedAt: Date };
/** Structurally the same as a CompletedGrade and deliberately not the same
 *  thing: an insufficient run has a null score, is the repository's current
 *  state, and never joins the history list. */
export type UnscoredGrade = GradeResult & { id: string; sha: string; computedAt: Date };
export type GradeSummary = {
  repositoryId: string;
  graderId: string;
  latest: CompletedGrade | null;
  /** The current run when it ended without a score. Null otherwise — including
   *  when an older run was insufficient and a newer one scored. */
  unscored: UnscoredGrade | null;
  status: Pick<GradeRun, 'id' | 'state' | 'errorCode' | 'createdAt'> | null;
};
// A version freezes what a grade means, not how it is captioned. `card` is
// title, tagline and grouping — copy a reader sees, which no score and no
// collection depends on. Everything else is frozen, including each check's
// `args`: rubricView keeps only { id, maxPoints }, so a moved threshold is
// invisible to the definition hash and must be caught here.
function withoutCard(manifest: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- discarded on purpose
  const { card: _card, ...rest } = manifest;
  return rest;
}
export async function registerRubric(manifest: GraderManifest) {
  const definition = rubricView(manifest);
  await db()
    .insert(gradingRubrics)
    .values({
      graderId: manifest.id,
      version: manifest.version,
      evaluatorVersion: manifest.evaluatorVersion,
      definition,
      manifest,
    })
    .onConflictDoNothing();
  const [stored] = await db()
    .select()
    .from(gradingRubrics)
    .where(
      and(eq(gradingRubrics.graderId, manifest.id), eq(gradingRubrics.version, manifest.version)),
    );
  // A canonical hash rather than a deep equality: JSONB hands back plain
  // objects with no key order and no frozen identity, and the question being
  // asked is whether the stored rubric is the same rubric, not the same object.
  if (
    !stored ||
    stored.evaluatorVersion !== manifest.evaluatorVersion ||
    manifestHash(stored.definition) !== manifestHash(definition) ||
    manifestHash(withoutCard(stored.manifest)) !== manifestHash(withoutCard(manifest))
  )
    throw new Error('Rubric version definition mismatch');
  // Copy-only drift refreshes the stored record rather than failing. Without
  // this, adding a card title to a built-in throws on every grade request in
  // every database that already holds the old row.
  if (manifestHash(stored.manifest) !== manifestHash(manifest)) {
    await db()
      .update(gradingRubrics)
      .set({ manifest })
      .where(
        and(eq(gradingRubrics.graderId, manifest.id), eq(gradingRubrics.version, manifest.version)),
      );
    return { ...stored, manifest };
  }
  return stored;
}
/**
 * The half of a grade request that has no session: the advisory lock keyed by
 * grader, the workspace lock, the availability join, the retry lookup and the
 * conflict fallback. Both callers go through it, so a scheduled run cannot be
 * created where a clicked one would have been refused.
 *
 * Trusted primitive. The caller is responsible for having resolved the grader
 * and registered its rubric; the availability join here re-checks repository,
 * installation, workspace link, membership and demo mode regardless.
 */
export async function insertGradeRun(input: {
  repositoryId: string;
  graderId: string;
  manifest: GraderManifest;
  userId: string;
  workspaceId: string;
  trigger: 'manual' | 'schedule';
}): Promise<{ id: string; state: GradeRun['state'] }> {
  const { repositoryId, graderId, manifest, userId, workspaceId, trigger } = input;
  return db().transaction(async (tx) => {
    // The lock key names the grader too: two graders on one repository must
    // not serialise against each other now that the unique index no longer
    // makes them conflict.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${repositoryId}:grade:${graderId}`},0))`,
    );
    // Match workspace mutations' lock and recheck membership/link after initial authorization.
    await tx.execute(sql`select id from workspaces where id = ${workspaceId} for update`);
    const [available] = await tx
      .select({ id: repositories.id })
      .from(repositories)
      .innerJoin(installations, eq(installations.id, repositories.installationId))
      .innerJoin(
        workspaceRepositories,
        and(
          eq(workspaceRepositories.repositoryId, repositories.id),
          eq(workspaceRepositories.workspaceId, workspaceId),
        ),
      )
      .innerJoin(
        workspaceMemberships,
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(workspaceMemberships.userId, userId),
        ),
      )
      .where(
        and(
          eq(repositories.id, repositoryId),
          eq(repositories.active, true),
          eq(repositories.isDemo, false),
          eq(installations.active, true),
        ),
      );
    if (!available) throw new Error('Repository unavailable');
    const [latest] = await tx
      .select()
      .from(runs)
      .where(and(eq(runs.repositoryId, repositoryId), eq(runs.graderId, graderId)))
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(1);
    const [inserted] = await tx
      .insert(runs)
      .values({
        id: randomUUID(),
        repositoryId,
        graderId,
        rubricVersion: manifest.version,
        evaluatorVersion: manifest.evaluatorVersion,
        requestedBy: userId,
        requestedWorkspaceId: workspaceId,
        retryOf: latest?.state === 'failed' ? latest.id : null,
        state: 'queued',
        trigger,
      })
      .onConflictDoNothing()
      .returning();
    const active =
      inserted ??
      (
        await tx
          .select()
          .from(runs)
          .where(
            and(
              eq(runs.repositoryId, repositoryId),
              eq(runs.graderId, graderId),
              inArray(runs.state, ['queued', 'running']),
            ),
          )
      )[0];
    if (!active) throw new Error('Grade request unavailable');
    return { id: active.id, state: active.state };
  });
}

/** The session half: who is asking, and may they. */
export async function requestGrade(
  repositoryId: string,
  graderId: string,
): Promise<{ id: string; state: GradeRun['state'] }> {
  const manifest = getGrader(graderId);
  const repository = await requireRepository(repositoryId);
  const workspace = await requireWorkspace();
  if (workspace.id === 'demo' || repository.isDemo) throw new Error('Demo workspace is read-only');
  const user = await currentUser();
  await registerRubric(manifest);
  return insertGradeRun({
    repositoryId,
    graderId,
    manifest,
    userId: user.id,
    workspaceId: workspace.id,
    trigger: 'manual',
  });
}

/**
 * The scheduler half. It has the repository, grader, enabler and workspace
 * from the schedule row, so it needs no session — but insertGradeRun's
 * availability join still re-checks every condition requestGrade checks.
 */
export async function scheduleGrade(input: {
  repositoryId: string;
  graderId: string;
  enabledBy: string;
  workspaceId: string;
}): Promise<{ id: string; state: GradeRun['state'] }> {
  const manifest = getGrader(input.graderId);
  await registerRubric(manifest);
  return insertGradeRun({
    repositoryId: input.repositoryId,
    graderId: input.graderId,
    manifest,
    userId: input.enabledBy,
    workspaceId: input.workspaceId,
    trigger: 'schedule',
  });
}
function completed(run: GradeRun): CompletedGrade | null {
  return run.state === 'complete' && run.result && run.sha && run.completedAt
    ? { ...run.result, id: run.id, sha: run.sha, computedAt: run.completedAt }
    : null;
}
function unscored(run: GradeRun): UnscoredGrade | null {
  return run.state === 'insufficient' && run.result && run.sha && run.completedAt
    ? { ...run.result, id: run.id, sha: run.sha, computedAt: run.completedAt }
    : null;
}
export async function latestGrade(
  repositoryId: string,
  graderId: string,
): Promise<CompletedGrade | null> {
  await requireRepository(repositoryId);
  return latestCompletedGrade(repositoryId, graderId);
}
export async function gradeHistory(
  repositoryId: string,
  graderId: string,
): Promise<CompletedGrade[]> {
  await requireRepository(repositoryId);
  return (
    await db()
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.repositoryId, repositoryId),
          eq(runs.graderId, graderId),
          eq(runs.state, 'complete'),
        ),
      )
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(100)
  ).flatMap((run) => {
    const result = completed(run);
    return result ? [result] : [];
  });
}
export async function getGrade(
  repositoryId: string,
  runId: string,
  graderId: string,
): Promise<CompletedGrade | null> {
  await requireRepository(repositoryId);
  const [run] = await db()
    .select()
    .from(runs)
    .where(
      and(eq(runs.repositoryId, repositoryId), eq(runs.id, runId), eq(runs.graderId, graderId)),
    );
  return run ? completed(run) : null;
}
export async function gradeSummaries(
  repositoryIds: string[],
  graderIds: string[],
): Promise<GradeSummary[]> {
  const allowed = new Set((await accessibleRepositories()).map((repo) => repo.id));
  const ids = [...new Set(repositoryIds)].filter((id) => allowed.has(id));
  if (!ids.length || !graderIds.length) return [];
  const records = await db()
    .select()
    .from(runs)
    .where(and(inArray(runs.repositoryId, ids), inArray(runs.graderId, graderIds)))
    .orderBy(desc(runs.createdAt), desc(runs.id));
  // One summary per (repository, grader) pair: a repository with two graders
  // shows both, and a grader that has never run for a repository still gets
  // an entry (latest and status both null) rather than being missing.
  return ids.flatMap((repositoryId) =>
    graderIds.map((graderId) => {
      const history = records.filter(
        (run) => run.repositoryId === repositoryId && run.graderId === graderId,
      );
      const current = history[0];
      const latest = history.find((run) => run.state === 'complete');
      return {
        repositoryId,
        graderId,
        latest: latest ? completed(latest) : null,
        unscored: current ? unscored(current) : null,
        status: current
          ? {
              id: current.id,
              state: current.state,
              errorCode: current.errorCode,
              createdAt: current.createdAt,
            }
          : null,
      };
    }),
  );
}
// Trusted worker primitives; never expose these directly as browser actions.
export async function loadGradeRun(runId: string) {
  return (await db().select().from(runs).where(eq(runs.id, runId)))[0] ?? null;
}
/** Trusted worker primitive: whether a run is already in flight for this pair.
 *  grade_runs_one_active would refuse the insert anyway; asking first avoids
 *  manufacturing an error to swallow. */
export async function activeGradeRun(repositoryId: string, graderId: string): Promise<boolean> {
  const [run] = await db()
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.repositoryId, repositoryId),
        eq(runs.graderId, graderId),
        inArray(runs.state, ['queued', 'running']),
      ),
    );
  return Boolean(run);
}
// Trusted worker primitive: no session and no workspace, because a background
// job has neither. Callers must have authorized by another route first —
// validateGradeRun or validateAuthoringRun.
export async function latestCompletedGrade(
  repositoryId: string,
  graderId: string,
): Promise<CompletedGrade | null> {
  const [run] = await db()
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.repositoryId, repositoryId),
        eq(runs.graderId, graderId),
        eq(runs.state, 'complete'),
      ),
    )
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(1);
  return run ? completed(run) : null;
}
/**
 * The newest run that finished with a result — scored or too little to judge —
 * and the version it was judged at. What the nightly skip compares against: a
 * failed run is never "done", and a new version on the same commit is new work.
 * Trusted worker primitive with no session, like latestCompletedGrade.
 */
export async function latestFinishedGrade(
  repositoryId: string,
  graderId: string,
): Promise<{ id: string; sha: string; rubricVersion: string } | null> {
  const [run] = await db()
    .select({ id: runs.id, sha: runs.sha, rubricVersion: runs.rubricVersion })
    .from(runs)
    .where(
      and(
        eq(runs.repositoryId, repositoryId),
        eq(runs.graderId, graderId),
        inArray(runs.state, ['complete', 'insufficient']),
        isNotNull(runs.sha),
      ),
    )
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(1);
  return run?.sha ? { id: run.id, sha: run.sha, rubricVersion: run.rubricVersion } : null;
}

/**
 * Trusted worker primitive: record that a finished run still describes its
 * repository. The nightly skip is the evidence — same head commit, same grader
 * version — and this is where that evidence is kept, so a badge can say `stale`
 * without a GitHub call. Only a run that finished with a result can be
 * confirmed; nothing about the stored result changes.
 */
export async function confirmGrade(runId: string, at = new Date()): Promise<void> {
  await db()
    .update(runs)
    .set({ confirmedAt: at })
    .where(and(eq(runs.id, runId), inArray(runs.state, ['complete', 'insufficient'])));
}
export async function validateGradeRun(run: GradeRun) {
  const [available] = await db()
    .select({ id: repositories.id })
    .from(repositories)
    .innerJoin(installations, eq(installations.id, repositories.installationId))
    .innerJoin(
      workspaceRepositories,
      and(
        eq(workspaceRepositories.repositoryId, repositories.id),
        eq(workspaceRepositories.workspaceId, run.requestedWorkspaceId),
      ),
    )
    .innerJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.workspaceId, run.requestedWorkspaceId),
        eq(workspaceMemberships.userId, run.requestedBy),
      ),
    )
    .where(
      and(
        eq(repositories.id, run.repositoryId),
        eq(repositories.active, true),
        eq(repositories.isDemo, false),
        eq(installations.active, true),
      ),
    );
  if (!available || process.env.DEMO_MODE === 'true') throw new Error('Grade access revoked');
  let manifest: GraderManifest;
  try {
    manifest = getGrader(run.graderId);
  } catch {
    throw new Error('Unsupported rubric version');
  }
  const [rubric] = await db()
    .select()
    .from(gradingRubrics)
    .where(
      and(eq(gradingRubrics.graderId, run.graderId), eq(gradingRubrics.version, run.rubricVersion)),
    );
  if (
    !rubric ||
    run.rubricVersion !== manifest.version ||
    run.evaluatorVersion !== manifest.evaluatorVersion ||
    rubric.evaluatorVersion !== run.evaluatorVersion ||
    // A grade must not complete against a manifest that changed after the run
    // was queued.
    manifestHash(withoutCard(rubric.manifest)) !== manifestHash(withoutCard(manifest)) ||
    manifestHash(rubric.definition) !== manifestHash(rubricView(manifest))
  )
    throw new Error('Unsupported rubric version');
}
export async function beginGrade(runId: string) {
  const run = await loadGradeRun(runId);
  if (!run || !['queued', 'running'].includes(run.state)) return run;
  await validateGradeRun(run);
  await db()
    .update(runs)
    .set({ state: 'running', startedAt: new Date() })
    .where(and(eq(runs.id, runId), eq(runs.state, 'queued')));
  return loadGradeRun(runId);
}
export async function pinGradeSha(runId: string, sha: string) {
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error('Invalid commit SHA');
  await db()
    .update(runs)
    .set({ sha })
    .where(and(eq(runs.id, runId), eq(runs.state, 'running'), isNull(runs.sha)));
  return (await loadGradeRun(runId))?.sha ?? null;
}
export async function completeGrade(runId: string, result: GradeResult) {
  const run = await loadGradeRun(runId);
  if (!run || run.state !== 'running') return;
  if (
    result.score === null ||
    result.rubricVersion !== run.rubricVersion ||
    result.evaluatorVersion !== run.evaluatorVersion
  )
    throw new Error('Invalid grade result');
  await db()
    .update(runs)
    .set({ state: 'complete', result, completedAt: new Date() })
    .where(and(eq(runs.id, runId), eq(runs.state, 'running')));
}
// The mirror image of completeGrade: same guards, opposite assertion about
// the score. A floor miss is not a failure — runDeclarative already built the
// full result, and this is where it lands.
export async function insufficientGrade(runId: string, result: GradeResult) {
  const run = await loadGradeRun(runId);
  if (!run || run.state !== 'running') return;
  if (
    result.score !== null ||
    result.rubricVersion !== run.rubricVersion ||
    result.evaluatorVersion !== run.evaluatorVersion
  )
    throw new Error('Invalid grade result');
  await db()
    .update(runs)
    .set({ state: 'insufficient', result, completedAt: new Date() })
    .where(and(eq(runs.id, runId), eq(runs.state, 'running')));
}
export async function failGrade(runId: string, code = 'collection_failed') {
  const safe = [
    'collection_failed',
    'access_revoked',
    'unsupported_version',
    'incomplete_collection',
    // insufficient_evidence is unreachable from the declarative path after the
    // insufficient state, and a code grader's own floor is stored as insufficient
    // too. Kept as the backstop for a floor the broker enforces on a code grader.
    'insufficient_evidence',
    'grader_failed',
    'sandbox_unavailable',
  ].includes(code)
    ? code
    : 'collection_failed';
  await db()
    .update(runs)
    .set({ state: 'failed', errorCode: safe, completedAt: new Date() })
    .where(and(eq(runs.id, runId), inArray(runs.state, ['queued', 'running'])));
}
export async function listUndispatchedGrades() {
  return (
    await db()
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.state, 'queued'), isNull(runs.dispatchedAt)))
      .orderBy(asc(runs.createdAt))
      .limit(100)
  ).map((run) => run.id);
}
