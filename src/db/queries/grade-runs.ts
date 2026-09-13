import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
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
export type GradeSummary = {
  repositoryId: string;
  latest: CompletedGrade | null;
  status: Pick<GradeRun, 'id' | 'state' | 'errorCode' | 'createdAt'> | null;
};
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
    manifestHash(stored.manifest) !== manifestHash(manifest)
  )
    throw new Error('Rubric version definition mismatch');
  return stored;
}
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
  return db().transaction(async (tx) => {
    // The lock key names the grader too: two graders on one repository must
    // not serialise against each other now that the unique index no longer
    // makes them conflict.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${repositoryId}:grade:${graderId}`},0))`,
    );
    // Match workspace mutations' lock and recheck membership/link after initial authorization.
    await tx.execute(sql`select id from workspaces where id = ${workspace.id} for update`);
    const [available] = await tx
      .select({ id: repositories.id })
      .from(repositories)
      .innerJoin(installations, eq(installations.id, repositories.installationId))
      .innerJoin(
        workspaceRepositories,
        and(
          eq(workspaceRepositories.repositoryId, repositories.id),
          eq(workspaceRepositories.workspaceId, workspace.id),
        ),
      )
      .innerJoin(
        workspaceMemberships,
        and(
          eq(workspaceMemberships.workspaceId, workspace.id),
          eq(workspaceMemberships.userId, user.id),
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
        requestedBy: user.id,
        requestedWorkspaceId: workspace.id,
        retryOf: latest?.state === 'failed' ? latest.id : null,
        state: 'queued',
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
function completed(run: GradeRun): CompletedGrade | null {
  return run.state === 'complete' && run.result && run.sha && run.completedAt
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
  graderId: string,
): Promise<GradeSummary[]> {
  const allowed = new Set((await accessibleRepositories()).map((repo) => repo.id));
  const ids = [...new Set(repositoryIds)].filter((id) => allowed.has(id));
  if (!ids.length) return [];
  const records = await db()
    .select()
    .from(runs)
    .where(and(inArray(runs.repositoryId, ids), eq(runs.graderId, graderId)))
    .orderBy(desc(runs.createdAt), desc(runs.id));
  return ids.map((repositoryId) => {
    const history = records.filter((run) => run.repositoryId === repositoryId);
    const current = history[0];
    const latest = history.find((run) => run.state === 'complete');
    return {
      repositoryId,
      latest: latest ? completed(latest) : null,
      status: current
        ? {
            id: current.id,
            state: current.state,
            errorCode: current.errorCode,
            createdAt: current.createdAt,
          }
        : null,
    };
  });
}
// Trusted worker primitives; never expose these directly as browser actions.
export async function loadGradeRun(runId: string) {
  return (await db().select().from(runs).where(eq(runs.id, runId)))[0] ?? null;
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
    manifestHash(rubric.manifest) !== manifestHash(manifest) ||
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
export async function failGrade(runId: string, code = 'collection_failed') {
  const safe = [
    'collection_failed',
    'access_revoked',
    'unsupported_version',
    'incomplete_collection',
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
