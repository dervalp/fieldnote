import { inngest } from '../client';
import { listMonitoredPrs } from '../../db/queries/authored-pr-monitor';
import { dispatchAuthoringPlan, dispatchSetupExecute } from '../dispatch-authoring';
import { listUndispatchedPlans } from '../../db/queries/authoring-runs';
import {
  listUndispatchedSetupPlans,
  listUndispatchedSetupExecutes,
} from '../../db/queries/fieldnote-setup';

export const reconcileAuthoring = inngest.createFunction(
  { id: 'reconcile-authoring', triggers: [{ cron: '* * * * *' }] },
  async ({ step }) => {
    if (process.env.DEMO_MODE === 'true') return { demo: true };
    const ids = await step.run('find-undispatched-plans', async () => [
      ...(await listUndispatchedPlans()),
      ...(await listUndispatchedSetupPlans()),
    ]);
    for (const runId of ids)
      await step.run(`dispatch-${runId}`, async () => {
        try {
          await dispatchAuthoringPlan(runId);
        } catch {
          /* Retry unacknowledged events on the next tick. */
        }
      });
    const executions = await step.run(
      'find-undispatched-setup-executes',
      listUndispatchedSetupExecutes,
    );
    for (const runId of executions)
      await step.run(`dispatch-execute-${runId}`, async () => {
        try {
          await dispatchSetupExecute(runId);
        } catch {
          /* Retry unacknowledged events on the next tick. */
        }
      });
    const monitored = await step.run('find-authored-prs', listMonitoredPrs);
    for (const pr of monitored)
      await step.run(`monitor-${pr.id}`, async () => {
        try {
          await inngest.send({
            name: 'repository/authored-pr.monitor.requested',
            data: { authoredPrId: pr.id },
          });
        } catch {
          /* Retry on next tick. */
        }
      });
    return { count: ids.length + executions.length + monitored.length };
  },
);
