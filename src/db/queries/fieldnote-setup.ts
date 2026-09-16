import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../index';
import {
  authoringRuns as runs,
  authoringNotes as notes,
  fieldnoteSetupProposals as proposals,
  fieldnoteSetupFiles as files,
  authoredPullRequests as pullRequests,
  repositoryFieldnoteInstallations as installations,
} from '../schema';
import type { InstallationObservation } from '../../domain/fieldnote-skills/types';
import { requireRepository } from '../../workspaces/access';

// Trusted persistence primitives. This is not a browser action module: callers
// running jobs must validate current access and permissions before doing work.
export async function loadSetupPlan(planRunId: string) {
  const [run] = await db()
    .select()
    .from(runs)
    .where(
      and(eq(runs.id, planRunId), eq(runs.kind, 'plan'), eq(runs.workflow, 'fieldnote-setup')),
    );
  if (!run) return null;
  const [proposal] = await db()
    .select()
    .from(proposals)
    .where(eq(proposals.authoringRunId, planRunId));
  const [conversation, generatedFiles] = await Promise.all([
    db()
      .select()
      .from(notes)
      .where(eq(notes.authoringRunId, planRunId))
      .orderBy(asc(notes.createdAt), asc(notes.id)),
    db().select().from(files).where(eq(files.proposalRunId, planRunId)).orderBy(asc(files.path)),
  ]);
  return { run, proposal: proposal ?? null, notes: conversation, files: generatedFiles };
}

export async function readySetupAndQueueExecute(planRunId: string) {
  return db().transaction(async (tx) => {
    const [identity] = await tx
      .select({ repositoryId: runs.repositoryId })
      .from(runs)
      .where(eq(runs.id, planRunId));
    if (!identity) throw new Error('Setup plan not found');
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${identity.repositoryId + ':authoring'}, 0))`,
    );
    const [plan] = await tx.select().from(runs).where(eq(runs.id, planRunId)).for('update');
    if (!plan || plan.workflow !== 'fieldnote-setup' || plan.kind !== 'plan')
      throw new Error('Not a setup plan');
    const [existing] = await tx.select().from(runs).where(eq(runs.planRunId, planRunId));
    if (existing) return existing;
    const [proposal] = await tx
      .select()
      .from(proposals)
      .where(eq(proposals.authoringRunId, planRunId))
      .for('update');
    const generated = await tx
      .select({ path: files.path })
      .from(files)
      .where(eq(files.proposalRunId, planRunId));
    if (
      plan.state !== 'running' ||
      !plan.sha ||
      !proposal ||
      proposal.repositorySha !== plan.sha ||
      !proposal.confirmedAgents?.some((agent) => agent.supported && agent.skillsRoot) ||
      !generated.length
    )
      throw new Error('Setup proposal is not ready');
    const now = new Date();
    await tx
      .update(proposals)
      .set({ state: 'ready', updatedAt: now })
      .where(eq(proposals.authoringRunId, planRunId));
    await tx
      .update(runs)
      .set({ state: 'complete', completedAt: now })
      .where(eq(runs.id, planRunId));
    const [execute] = await tx
      .insert(runs)
      .values({
        id: randomUUID(),
        repositoryId: plan.repositoryId,
        workflow: 'fieldnote-setup',
        kind: 'execute',
        planRunId,
        requestedBy: plan.requestedBy,
        requestedWorkspaceId: plan.requestedWorkspaceId,
        state: 'queued',
        sha: plan.sha,
        authorVersion: plan.authorVersion,
        model: plan.model,
      })
      .returning();
    return execute;
  });
}

export async function recordAuthoredPullRequest(
  input: Omit<typeof pullRequests.$inferInsert, 'id'>,
) {
  const [run] = await db().select().from(runs).where(eq(runs.id, input.authoringRunId));
  if (!run || run.kind !== 'execute' || run.repositoryId !== input.repositoryId) {
    throw new Error('Pull request must belong to its execute run');
  }
  const [inserted] = await db()
    .insert(pullRequests)
    .values({ id: randomUUID(), ...input })
    .onConflictDoNothing({ target: pullRequests.authoringRunId })
    .returning();
  if (inserted) return inserted;
  const [existing] = await db()
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.authoringRunId, input.authoringRunId));
  if (
    !existing ||
    existing.repositoryId !== input.repositoryId ||
    existing.number !== input.number
  ) {
    throw new Error('Execute run already has a different pull request');
  }
  return existing;
}

// Only a verified default-branch scan calls this. PR opening and PR outcome
// persistence deliberately cannot produce an installation observation.
export async function recordInstallationObservation(
  repositoryId: string,
  observation: InstallationObservation,
) {
  const value = { repositoryId, ...observation, verifiedAt: new Date() };
  const [stored] = await db()
    .insert(installations)
    .values(value)
    .onConflictDoUpdate({ target: installations.repositoryId, set: value })
    .returning();
  return stored;
}

// Browser-facing read: authorize before looking up any caller-supplied run ID.
export async function getSetupPlan(repositoryId: string, planRunId: string) {
  await requireRepository(repositoryId);
  const [match] = await db()
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.id, planRunId), eq(runs.repositoryId, repositoryId)));
  return match ? loadSetupPlan(planRunId) : null;
}
