import { and, eq } from 'drizzle-orm';
import { db } from '../index';
import {
  gradeSchedules as schedules,
  installations,
  repositories,
  workspaceMemberships,
  workspaceRepositories,
} from '../schema';
import { requireRepository, requireWorkspace } from '../../workspaces/access';
import { currentUser } from '../../auth/session';
// The same deliberate side-effect import grade-runs.ts documents: importing a
// grader module registers it, and a serverless entry point has no boot step to
// do that for us. writeGradeSchedule resolves a grader through getGrader(), so
// this module is one of the doors that has to have them registered.
import '../../domain/grading/graders';
import { getGrader } from '../../domain/grading/registry';

/**
 * What the page needs to draw one toggle. Absent means off.
 *
 * A schedule belongs to the repository, not to a workspace: `grade_schedules`
 * is keyed `(repository_id, grader_id)`, so a second workspace sharing that
 * repository sees the same row and can take it over — switching it off and on
 * writes their own `enabled_by`. That is why `enabledBy` is a foreign
 * workspace's user id as often as it is the viewer's own, and must not be
 * sent to a client component that has no reason to read it.
 */
export type GradeScheduleView = { enabledBy: string; paused: boolean };
/** What the scheduler needs to create one run. */
export type GradeScheduleRow = {
  repositoryId: string;
  graderId: string;
  enabledBy: string;
  workspaceId: string;
};

/**
 * Every schedule on one repository, keyed by grader id.
 *
 * `paused` is evaluated here rather than inferred in a component, so a card can
 * say "paused" without knowing what a membership is. It checks the same
 * membership and workspace→repository link scheduleAvailable() checks for the
 * scheduler, but not all four of the other conditions scheduleAvailable()
 * additionally requires — `repositories.active`, `installations.active`,
 * `repositories.isDemo` and `DEMO_MODE` — because none of them can diverge
 * from true here: `requireRepository` above already 404s this page when the
 * repository or its installation is inactive, and a demo repository can never
 * hold a schedule row (writeGradeSchedule refuses to write one), so `isDemo`
 * and `DEMO_MODE` have nothing to bite on. The omission is precision, not a
 * gap.
 */
export async function gradeSchedules(
  repositoryId: string,
): Promise<Record<string, GradeScheduleView>> {
  await requireRepository(repositoryId);
  const rows = await db()
    .select({
      graderId: schedules.graderId,
      enabledBy: schedules.enabledBy,
      member: workspaceMemberships.userId,
      linked: workspaceRepositories.repositoryId,
    })
    .from(schedules)
    .leftJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.workspaceId, schedules.workspaceId),
        eq(workspaceMemberships.userId, schedules.enabledBy),
      ),
    )
    .leftJoin(
      workspaceRepositories,
      and(
        eq(workspaceRepositories.workspaceId, schedules.workspaceId),
        eq(workspaceRepositories.repositoryId, schedules.repositoryId),
      ),
    )
    .where(eq(schedules.repositoryId, repositoryId));
  return Object.fromEntries(
    rows.map((row) => [
      row.graderId,
      { enabledBy: row.enabledBy, paused: row.member === null || row.linked === null },
    ]),
  );
}

/**
 * Turn a schedule on or off. Session-bound, and authorized by the same route
 * requestGrade() uses: an unknown grader throws, the demo workspace is
 * read-only, and enabling requires an active repository on an active
 * installation, connected to the caller's workspace, of which they are a
 * member.
 *
 * Presence means on, so turning it off deletes the row. Enabling twice is a
 * no-op — taking over someone else's schedule is switching it off and on,
 * which writes your own enabled_by.
 */
export async function writeGradeSchedule(
  repositoryId: string,
  graderId: string,
  enabled: boolean,
): Promise<void> {
  getGrader(graderId);
  const repository = await requireRepository(repositoryId);
  const workspace = await requireWorkspace();
  if (workspace.id === 'demo' || repository.isDemo) throw new Error('Demo workspace is read-only');
  const user = await currentUser();
  if (!enabled) {
    await db()
      .delete(schedules)
      .where(and(eq(schedules.repositoryId, repositoryId), eq(schedules.graderId, graderId)));
    return;
  }
  const [available] = await db()
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
  await db()
    .insert(schedules)
    .values({ repositoryId, graderId, enabledBy: user.id, workspaceId: workspace.id })
    .onConflictDoNothing();
}

// Trusted worker primitives; never expose these directly as browser actions.
/**
 * Every schedule, for the nightly pass — across every workspace, with no
 * scoping and no authorization performed here. The caller is responsible for
 * calling scheduleAvailable() on each row before acting on it; this function
 * alone does not say a row is safe to run.
 */
export async function listGradeSchedules(): Promise<GradeScheduleRow[]> {
  return db()
    .select({
      repositoryId: schedules.repositoryId,
      graderId: schedules.graderId,
      enabledBy: schedules.enabledBy,
      workspaceId: schedules.workspaceId,
    })
    .from(schedules);
}

/**
 * Trusted worker primitive: steps 1 and 2 of the nightly pass in one query —
 * an available repository, and a schedule that is not paused. A paused
 * schedule is skipped and its row survives, so it resumes by itself if the
 * enabler's access comes back.
 *
 * No session and no workspace, because a background job has neither. This
 * is the authorization for that job: it evaluates the same conditions the
 * session path (writeGradeSchedule's own availability join) checks —
 * repository active, installation active, workspace-has-repository,
 * enabler-is-member, not demo — so listGradeSchedules() callers must run it
 * per row before doing anything with that row.
 */
export async function scheduleAvailable(row: GradeScheduleRow): Promise<boolean> {
  if (process.env.DEMO_MODE === 'true') return false;
  const [available] = await db()
    .select({ id: repositories.id })
    .from(repositories)
    .innerJoin(installations, eq(installations.id, repositories.installationId))
    .innerJoin(
      workspaceRepositories,
      and(
        eq(workspaceRepositories.repositoryId, repositories.id),
        eq(workspaceRepositories.workspaceId, row.workspaceId),
      ),
    )
    .innerJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.workspaceId, row.workspaceId),
        eq(workspaceMemberships.userId, row.enabledBy),
      ),
    )
    .where(
      and(
        eq(repositories.id, row.repositoryId),
        eq(repositories.active, true),
        eq(repositories.isDemo, false),
        eq(installations.active, true),
      ),
    );
  return Boolean(available);
}
