'use server';
import { requestGrade } from '../../../../db/queries/grade-runs';
import { AGENT_READINESS } from '../../../../domain/grading/graders/agent-readiness';
import { dispatchGrade } from '../../../../inngest/dispatch-grade';
import { requestPlan } from '../../../../db/queries/authoring-runs';
import { dispatchAuthoringPlan } from '../../../../inngest/dispatch-authoring';
export async function runGrade(repositoryId: string): Promise<{ runId: string }> {
  // requestGrade checks current workspace membership, repository connection and demo mode.
  const run = await requestGrade(repositoryId, AGENT_READINESS);
  try {
    await dispatchGrade(run.id);
  } catch {
    // Durable queued run is recovered by reconciliation; retain its polling identity.
  }
  return { runId: run.id };
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
