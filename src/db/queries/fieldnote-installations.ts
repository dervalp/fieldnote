import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../index';
import {
  authoredPullRequests as prs,
  authoringRuns as runs,
  fieldnoteSetupProposals as proposals,
  fieldnoteSetupFiles as files,
  repositoryFieldnoteInstallations as installations,
} from '../schema';
import type { InstallationObservation } from '../../domain/fieldnote-skills/types';

type Reader = Pick<ReturnType<typeof db>, 'select'>;
async function verificationContext(reader: Reader, id: string) {
  const [context] = await reader
    .select({ pr: prs, run: runs, proposal: proposals })
    .from(prs)
    .innerJoin(runs, and(eq(runs.id, prs.authoringRunId), eq(runs.repositoryId, prs.repositoryId)))
    .innerJoin(proposals, eq(proposals.authoringRunId, runs.planRunId))
    .where(
      and(
        eq(prs.id, id),
        eq(prs.outcome, 'merged'),
        eq(runs.workflow, 'fieldnote-setup'),
        eq(runs.kind, 'execute'),
        eq(proposals.state, 'ready'),
      ),
    );
  if (!context || !context.pr.mergedAt) return null;
  // A delayed event for an earlier setup must never overwrite an update's scan.
  const [latest] = await reader
    .select({ id: prs.id })
    .from(prs)
    .innerJoin(runs, eq(runs.id, prs.authoringRunId))
    .where(
      and(
        eq(prs.repositoryId, context.pr.repositoryId),
        eq(prs.outcome, 'merged'),
        eq(runs.workflow, 'fieldnote-setup'),
      ),
    )
    .orderBy(desc(prs.mergedAt), desc(prs.number))
    .limit(1);
  if (latest?.id !== id) return null;
  const configuration = await reader
    .select({ path: files.path })
    .from(files)
    .where(eq(files.proposalRunId, context.proposal.authoringRunId));
  return { ...context, configurationPaths: configuration.map((file) => file.path) };
}

/** Worker-only metadata. Callers must reauthorize before fetching or recording. */
export async function loadInstallationVerification(id: string) {
  return verificationContext(db(), id);
}

/** Only the fresh default-branch verifier calls this, never PR opening/outcome handlers. */
export async function recordVerifiedInstallation(id: string, observation: InstallationObservation) {
  return db().transaction(async (tx) => {
    const [identity] = await tx
      .select({ repositoryId: prs.repositoryId })
      .from(prs)
      .where(eq(prs.id, id));
    if (!identity) return null;
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${identity.repositoryId + ':installation'}, 0))`,
    );
    const context = await verificationContext(tx, id);
    if (!context) return null;
    const [existing] = await tx
      .select()
      .from(installations)
      .where(eq(installations.repositoryId, identity.repositoryId));
    if (
      existing &&
      existing.verifiedAt >= context.pr.mergedAt! &&
      Object.entries(observation).every(
        ([key, value]) =>
          JSON.stringify(existing[key as keyof typeof existing]) === JSON.stringify(value),
      )
    )
      return existing;
    const value = { repositoryId: identity.repositoryId, ...observation, verifiedAt: new Date() };
    const [stored] = await tx
      .insert(installations)
      .values(value)
      .onConflictDoUpdate({ target: installations.repositoryId, set: value })
      .returning();
    return stored;
  });
}
