import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../index';
import {
  authoringRuns as runs,
  authoringNotes as notes,
  fieldnoteSetupProposals as proposals,
  fieldnoteSetupFiles as files,
  authoredPullRequests as pullRequests,
  repositoryFieldnoteInstallations as installations,
} from '../schema';
import type {
  ConfirmedAgent,
  InstallationObservation,
  SetupRepositorySnapshot,
  SkillsRelease,
} from '../../domain/fieldnote-skills/types';
import { requireRepository } from '../../workspaces/access';
import { requestPlan } from './authoring-runs';
import type { SetupAuthorResult } from '../../authoring/setup-author';

export type SetupReleaseIdentity = Pick<SkillsRelease, 'release' | 'revision' | 'releaseLockHash'>;
type Transaction = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

export async function requestSetupPlan(repositoryId: string) {
  return requestPlan(repositoryId, 'fieldnote-setup');
}

export async function listUndispatchedSetupPlans(): Promise<string[]> {
  return (
    await db()
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(
          eq(runs.workflow, 'fieldnote-setup'),
          eq(runs.kind, 'plan'),
          eq(runs.state, 'queued'),
          isNull(runs.dispatchedAt),
        ),
      )
      .orderBy(asc(runs.createdAt))
      .limit(100)
  ).map((run) => run.id);
}

async function lockPlan(tx: Transaction, runId: string) {
  const [identity] = await tx
    .select({ repositoryId: runs.repositoryId })
    .from(runs)
    .where(eq(runs.id, runId));
  if (!identity) throw new Error('Setup plan not found');
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${identity.repositoryId + ':authoring'}, 0))`,
  );
  const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).for('update');
  if (!run || run.kind !== 'plan' || run.workflow !== 'fieldnote-setup')
    throw new Error('Not a setup plan');
  return run;
}

export async function saveSetupSnapshot(
  runId: string,
  release: SetupReleaseIdentity,
  snapshot: SetupRepositorySnapshot,
) {
  await db().transaction(async (tx) => {
    const run = await lockPlan(tx, runId);
    if (run.state !== 'running' || run.sha !== snapshot.sha)
      throw new Error('Setup snapshot is stale');
    await tx
      .insert(proposals)
      .values({
        authoringRunId: runId,
        repositorySha: snapshot.sha,
        skillsRelease: release.release,
        skillsRevision: release.revision,
        releaseLockHash: release.releaseLockHash,
        detectedAgents: snapshot.candidates,
        state: 'exploring',
      })
      .onConflictDoNothing();
  });
}

// Question IDs bind a submission to one turn. Repeating the same in-progress
// submission resumes authoring after a provider failure without appending twice.
export async function appendSetupAnswer(
  repositoryId: string,
  runId: string,
  questionId: string,
  answer: string,
  confirmedAgents: ConfirmedAgent[],
): Promise<string> {
  return db().transaction(async (tx) => {
    const run = await lockPlan(tx, runId);
    if (run.repositoryId !== repositoryId || run.state !== 'running')
      throw new Error('Setup is not awaiting input');
    const [proposal] = await tx.select().from(proposals).where(eq(proposals.authoringRunId, runId));
    const conversation = await tx
      .select()
      .from(notes)
      .where(eq(notes.authoringRunId, runId))
      .orderBy(asc(notes.createdAt), asc(notes.id));
    const turns = conversation.filter((note) => note.kind === 'question' || note.kind === 'answer');
    const last = turns.at(-1);
    if (
      proposal?.state === 'exploring' &&
      last?.kind === 'answer' &&
      last.body === answer &&
      turns.at(-2)?.id === questionId
    )
      return last.id;
    if (proposal?.state !== 'awaiting-input' || last?.kind !== 'question' || last.id !== questionId)
      throw new Error('Setup is not awaiting this question');
    const id = randomUUID();
    await tx.insert(notes).values({
      id,
      authoringRunId: runId,
      speaker: 'human',
      kind: 'answer',
      body: answer,
      createdAt: new Date(Math.max(Date.now(), last.createdAt.getTime() + 1)),
    });
    await tx
      .update(proposals)
      .set({ state: 'exploring', confirmedAgents, updatedAt: new Date() })
      .where(eq(proposals.authoringRunId, runId));
    return id;
  });
}

export async function saveSetupResult(
  runId: string,
  result: SetupAuthorResult,
  answerId: string | null,
): Promise<void> {
  await db().transaction(async (tx) => {
    const run = await lockPlan(tx, runId);
    if (run.state !== 'running') return;
    const [proposal] = await tx.select().from(proposals).where(eq(proposals.authoringRunId, runId));
    if (proposal?.state !== 'exploring') return;
    const conversation = await tx
      .select()
      .from(notes)
      .where(eq(notes.authoringRunId, runId))
      .orderBy(asc(notes.createdAt), asc(notes.id));
    const latestTurn = conversation
      .filter((note) => note.kind === 'answer' || note.kind === 'question')
      .at(-1);
    if (
      answerId
        ? latestTurn?.id !== answerId || latestTurn.kind !== 'answer'
        : latestTurn !== undefined
    )
      return;
    if (result.state === 'awaiting-input' && (!result.nextQuestion || result.files.length))
      throw new Error('Setup requires one question');
    if (result.state === 'ready' && result.nextQuestion)
      throw new Error('Ready setup cannot have a question');
    let timestamp = Math.max(Date.now(), (conversation.at(-1)?.createdAt.getTime() ?? 0) + 1);
    const additions: Array<typeof notes.$inferInsert> = result.findings.map((body) => ({
      id: randomUUID(),
      authoringRunId: runId,
      speaker: 'agent',
      kind: 'finding',
      body,
      createdAt: new Date(timestamp++),
    }));
    if (result.nextQuestion)
      additions.push({
        id: randomUUID(),
        authoringRunId: runId,
        speaker: 'agent',
        kind: 'question',
        body: `[${result.nextQuestion.key}] ${result.nextQuestion.text}\n\n${result.nextQuestion.evidence.join('\n')}`,
        createdAt: new Date(timestamp++),
      });
    if (additions.length) await tx.insert(notes).values(additions);
    for (const file of result.files)
      await tx
        .insert(files)
        .values({
          id: randomUUID(),
          proposalRunId: runId,
          path: file.path,
          kind: file.kind,
          body: file.content,
          hash: file.hash,
        })
        .onConflictDoUpdate({
          target: [files.proposalRunId, files.path],
          set: { body: file.content, hash: file.hash, kind: file.kind },
        });
    await tx
      .update(runs)
      .set({ model: result.model, sandboxId: result.sandboxId })
      .where(eq(runs.id, runId));
    await tx
      .update(proposals)
      .set({
        confirmedAgents: result.confirmedAgents,
        state: result.state === 'ready' ? 'exploring' : 'awaiting-input',
        updatedAt: new Date(),
      })
      .where(eq(proposals.authoringRunId, runId));
    if (result.state === 'ready') await readySetupInTransaction(tx, runId);
  });
}

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
  return db().transaction((tx) => readySetupInTransaction(tx, planRunId));
}

async function readySetupInTransaction(tx: Transaction, planRunId: string) {
  const plan = await lockPlan(tx, planRunId);
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
  await tx.update(runs).set({ state: 'complete', completedAt: now }).where(eq(runs.id, planRunId));
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
