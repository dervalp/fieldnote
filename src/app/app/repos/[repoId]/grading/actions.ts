'use server';
import { requestGrade } from '../../../../../db/queries/grade-runs';
import { dispatchGrade } from '../../../../../inngest/dispatch-grade';
import { requestPlan } from '../../../../../db/queries/authoring-runs';
import { dispatchAuthoringPlan } from '../../../../../inngest/dispatch-authoring';
import { writeGradeSchedule } from '../../../../../db/queries/grade-schedules';
import { writePublicGrade } from '../../../../../db/queries/public-grade-settings';
export async function runGrade(repositoryId: string, graderId: string): Promise<{ runId: string }> {
  // requestGrade resolves the grader through the registry, which throws on an
  // unknown id, and checks workspace membership, repository connection and
  // demo mode.
  const run = await requestGrade(repositoryId, graderId);
  try {
    await dispatchGrade(run.id);
  } catch {
    // Durable queued run is recovered by reconciliation; retain its polling identity.
  }
  return { runId: run.id };
}

// writeGradeSchedule resolves the grader through the registry, which throws on
// an unknown id, and checks workspace membership, repository connection and
// demo mode by the same route requestGrade() does.
export async function setGradeSchedule(
  repositoryId: string,
  graderId: string,
  enabled: boolean,
): Promise<void> {
  await writeGradeSchedule(repositoryId, graderId, enabled);
}

// writePublicGrade resolves the grader through the registry, requires the
// owner role, and refuses the demo workspace and a repository this workspace
// is not connected to.
export async function setPublicGrade(
  repositoryId: string,
  graderId: string,
  shared: boolean,
): Promise<void> {
  await writePublicGrade(repositoryId, graderId, shared);
}

// Returns nothing: unlike runGrade, this action has no client-side caller to
// hand a polling id to. ActEntry is a server component, and the grading page
// re-render after the form submits recovers the new run through latestPlan.
export async function requestPlanRun(repositoryId: string): Promise<void> {
  // requestPlan checks workspace membership, repository connection, demo mode,
  // the Act opt-in and the permissions GitHub actually granted.
  const run = await requestPlan(repositoryId);
  try {
    await dispatchAuthoringPlan(run.id);
  } catch {
    // Durable queued run is recovered by reconciliation.
  }
}
