import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { authoringRuns, fieldnoteSetupProposals } from '../db/schema';
import { inngest } from './client';

export type SendAuthoringEvent = (event: {
  id: string;
  name: 'repository/authoring.plan.requested' | 'repository/fieldnote.setup.plan.requested';
  data: { runId: string };
}) => Promise<unknown>;
export async function dispatchSetupExecute(
  runId: string,
  send: (event: {
    id: string;
    name: 'repository/fieldnote.setup.execute.requested';
    data: { runId: string; proposalUpdatedAt: string };
  }) => Promise<unknown> = (event) => inngest.send(event),
): Promise<void> {
  const [run] = await db()
    .select({ id: authoringRuns.id, updatedAt: fieldnoteSetupProposals.updatedAt })
    .from(authoringRuns)
    .innerJoin(
      fieldnoteSetupProposals,
      eq(fieldnoteSetupProposals.authoringRunId, authoringRuns.planRunId),
    )
    .where(
      and(
        eq(authoringRuns.id, runId),
        eq(authoringRuns.workflow, 'fieldnote-setup'),
        eq(authoringRuns.kind, 'execute'),
        eq(authoringRuns.state, 'queued'),
        isNull(authoringRuns.dispatchedAt),
        eq(fieldnoteSetupProposals.state, 'ready'),
      ),
    );
  if (!run) return;
  const proposalUpdatedAt = run.updatedAt.toISOString();
  await send({
    id: `${runId}:${proposalUpdatedAt}`,
    name: 'repository/fieldnote.setup.execute.requested',
    data: { runId, proposalUpdatedAt },
  });
  // Do not acknowledge a refreshed generation delivered while send was in flight.
  await db()
    .update(authoringRuns)
    .set({ dispatchedAt: new Date() })
    .where(
      and(
        eq(authoringRuns.id, runId),
        eq(authoringRuns.state, 'queued'),
        isNull(authoringRuns.dispatchedAt),
        sql`exists (select 1 from ${fieldnoteSetupProposals} where ${fieldnoteSetupProposals.authoringRunId} = ${authoringRuns.planRunId} and date_trunc('milliseconds', ${fieldnoteSetupProposals.updatedAt}) = ${proposalUpdatedAt}::timestamptz)`,
      ),
    );
}

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
