import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../index';
import {
  authoringRemedies,
  authoringRuns as runs,
  installations,
  repositories,
  workspaceRepositories,
  workspaceMemberships,
} from '../schema';
import { requireRepository, requireWorkspace } from '../../workspaces/access';
import { currentUser } from '../../auth/session';
import { actAvailability, nothingGranted } from '../../domain/act/availability';
import { floorAuthorVersion, type ProposedRemedy } from '../../domain/act/remedies';
import { actEnabled } from './act-settings';
import { fetchGrantedPermissions } from '../../github/installation-permissions';
import { latestGrade } from './grade-runs';
import { AGENT_READINESS } from '../../domain/grading/graders/agent-readiness';

export type AuthoringRun = typeof runs.$inferSelect;
export type Remedy = typeof authoringRemedies.$inferSelect;

export async function requestPlan(
  repositoryId: string,
): Promise<{ id: string; state: AuthoringRun['state'] }> {
  const repository = await requireRepository(repositoryId);
  const workspace = await requireWorkspace();
  if (workspace.id === 'demo' || repository.isDemo) throw new Error('Demo workspace is read-only');
  const user = await currentUser();

  // Availability is decided before the transaction: fetchGrantedPermissions is
  // a network round-trip and must not be held inside one. It throws rather
  // than returning a safe default, and we let it — a permission check that
  // cannot complete must not quietly read as "unavailable".
  const [enabled, grade] = await Promise.all([
    actEnabled(repositoryId),
    latestGrade(repositoryId, AGENT_READINESS),
  ]);
  const permissions = enabled ? await fetchGrantedPermissions(repositoryId) : nothingGranted;
  const availability = actAvailability({
    enabled,
    permissions,
    failingCheckCount: grade?.checks.filter((check) => check.status === 'fail').length ?? 0,
  });
  if (!availability.available) throw new Error('Act unavailable');

  return db().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${repositoryId + ':authoring'},0))`,
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
          eq(repositories.actEnabled, true),
          eq(installations.active, true),
        ),
      );
    if (!available) throw new Error('Repository unavailable');
    const [latest] = await tx
      .select()
      .from(runs)
      .where(and(eq(runs.repositoryId, repositoryId), eq(runs.kind, 'plan')))
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(1);
    const [inserted] = await tx
      .insert(runs)
      .values({
        id: randomUUID(),
        repositoryId,
        kind: 'plan',
        requestedBy: user.id,
        requestedWorkspaceId: workspace.id,
        retryOf: latest?.state === 'failed' ? latest.id : null,
        state: 'queued',
        authorVersion: floorAuthorVersion,
      })
      .onConflictDoNothing()
      .returning();
    // Deliberately not filtered by kind: authoring_runs_one_active, the partial
    // unique index this recovers from, spans both plan and execute runs, and
    // filtering by kind here would find no row and throw 'Plan request
    // unavailable' spuriously. Once execute runs exist, an in-flight execute
    // run must be detected here and refused with its own message, not
    // returned to the caller as "the plan already in flight".
    const active =
      inserted ??
      (
        await tx
          .select()
          .from(runs)
          .where(
            and(eq(runs.repositoryId, repositoryId), inArray(runs.state, ['queued', 'running'])),
          )
      )[0];
    if (!active) throw new Error('Plan request unavailable');
    return { id: active.id, state: active.state };
  });
}

// Trusted worker primitives; never expose these directly as browser actions.

export async function loadAuthoringRun(runId: string): Promise<AuthoringRun | null> {
  return (await db().select().from(runs).where(eq(runs.id, runId)))[0] ?? null;
}

// A plan run writes nothing to GitHub, so this deliberately does not re-fetch
// granted permissions: write access is the execute run's gate, and a GitHub
// outage must not fail a plan run that retries three times. Opt-in is checked,
// because a repository switched off mid-run should stop.
//
// This also does not check that the run's recorded authorVersion still
// matches floorAuthorVersion, unlike validateGradeRun's rubric/evaluator
// version check. That is deliberate and, today, harmless: there is one
// constant, and a deploy would have to land inside the seconds between
// queueing and explore. It stops being harmless once authorVersion records
// the agent and prompt version — a stale value then is a provenance record
// that lies about which agent wrote a plan.
export async function validateAuthoringRun(run: AuthoringRun): Promise<void> {
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
        eq(repositories.actEnabled, true),
        eq(installations.active, true),
      ),
    );
  if (!available || process.env.DEMO_MODE === 'true') throw new Error('Plan access revoked');
}

export async function beginAuthoring(runId: string): Promise<AuthoringRun | null> {
  const run = await loadAuthoringRun(runId);
  if (!run || !['queued', 'running'].includes(run.state)) return run;
  await validateAuthoringRun(run);
  await db()
    .update(runs)
    .set({ state: 'running', startedAt: new Date() })
    .where(and(eq(runs.id, runId), eq(runs.state, 'queued')));
  return loadAuthoringRun(runId);
}

export async function pinAuthoringSha(runId: string, sha: string): Promise<string | null> {
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error('Invalid commit SHA');
  await db()
    .update(runs)
    .set({ sha })
    .where(and(eq(runs.id, runId), eq(runs.state, 'running'), isNull(runs.sha)));
  return (await loadAuthoringRun(runId))?.sha ?? null;
}

// The database cannot express "a complete plan has at least one remedy" —
// the result is child rows, not a column — so it is enforced here, and the
// run stays running rather than completing empty.
export async function completeAuthoringRun(
  runId: string,
  remedies: ProposedRemedy[],
): Promise<void> {
  if (!remedies.length) throw new Error('Plan proposed nothing');
  const run = await loadAuthoringRun(runId);
  if (!run || run.state !== 'running') return;
  await db().transaction(async (tx) => {
    await tx
      .insert(authoringRemedies)
      .values(remedies.map((remedy) => ({ id: randomUUID(), authoringRunId: runId, ...remedy })))
      .onConflictDoNothing();
    await tx
      .update(runs)
      .set({ state: 'complete', completedAt: new Date() })
      .where(and(eq(runs.id, runId), eq(runs.state, 'running')));
  });
}

export async function failAuthoringRun(runId: string, code = 'plan_failed'): Promise<void> {
  // An unrecognised code is rewritten, so a provider or driver message can
  // never reach a column a view renders.
  const safe = ['plan_failed', 'access_revoked', 'grade_missing', 'nothing_to_fix'].includes(code)
    ? code
    : 'plan_failed';
  await db()
    .update(runs)
    .set({ state: 'failed', errorCode: safe, completedAt: new Date() })
    .where(and(eq(runs.id, runId), inArray(runs.state, ['queued', 'running'])));
}

export async function listUndispatchedPlans(): Promise<string[]> {
  return (
    await db()
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.state, 'queued'), eq(runs.kind, 'plan'), isNull(runs.dispatchedAt)))
      .orderBy(asc(runs.createdAt))
      .limit(100)
  ).map((run) => run.id);
}

// Browser-facing reads. Both authorize first.

export async function latestPlan(repositoryId: string): Promise<AuthoringRun | null> {
  await requireRepository(repositoryId);
  const [run] = await db()
    .select()
    .from(runs)
    .where(and(eq(runs.repositoryId, repositoryId), eq(runs.kind, 'plan')))
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(1);
  return run ?? null;
}

export async function getPlan(
  repositoryId: string,
  runId: string,
): Promise<{ run: AuthoringRun; remedies: Remedy[] } | null> {
  await requireRepository(repositoryId);
  const [run] = await db()
    .select()
    .from(runs)
    .where(and(eq(runs.repositoryId, repositoryId), eq(runs.id, runId), eq(runs.kind, 'plan')));
  if (!run) return null;
  const remedies = await db()
    .select()
    .from(authoringRemedies)
    .where(eq(authoringRemedies.authoringRunId, runId))
    .orderBy(asc(authoringRemedies.ordinal));
  return { run, remedies };
}
