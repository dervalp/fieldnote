import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { authoringRuns } from '../db/schema';
import { inngest } from './client';

export type SendAuthoringEvent = (event: {
  id: string;
  name: 'repository/authoring.plan.requested' | 'repository/fieldnote.setup.plan.requested';
  data: { runId: string };
}) => Promise<unknown>;

export async function dispatchAuthoringPlan(
  runId: string,
  send: SendAuthoringEvent = (event) => inngest.send(event),
): Promise<void> {
  const [run] = await db()
    .select({ id: authoringRuns.id, workflow: authoringRuns.workflow })
    .from(authoringRuns)
    .where(
      and(
        eq(authoringRuns.id, runId),
        eq(authoringRuns.kind, 'plan'),
        eq(authoringRuns.state, 'queued'),
        isNull(authoringRuns.dispatchedAt),
      ),
    );
  if (!run) return;
  await send({
    id: runId,
    name:
      run.workflow === 'fieldnote-setup'
        ? 'repository/fieldnote.setup.plan.requested'
        : 'repository/authoring.plan.requested',
    data: { runId },
  });
  await db()
    .update(authoringRuns)
    .set({ dispatchedAt: new Date() })
    .where(
      and(
        eq(authoringRuns.id, runId),
        eq(authoringRuns.kind, 'plan'),
        eq(authoringRuns.state, 'queued'),
        isNull(authoringRuns.dispatchedAt),
      ),
    );
}
