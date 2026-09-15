import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../index';
import {
  gradeRuns as runs,
  installations,
  publicGrades,
  repositories,
  workspaceRepositories,
} from '../schema';
import { graderVersion, latestPublishedVersion, verifiedAtFor } from './graders';
import {
  freshAt,
  isStale,
  publicGradedView,
  publicGradeFrom,
  publicGrader,
  type PublicGradeView,
} from '../../domain/grading/public-grade';

// Frozen because this one object is handed by reference to every caller: the
// page, the badge and the share image all receive the same value, and a
// caller that mutated it would change what the next request is told.
const PRIVATE: PublicGradeView = Object.freeze({ state: 'private' });

/**
 * The only thing the public page, the badge and the share image read. No
 * session, no workspace, no cookie: a public request has none. It answers
 * `private` unless every condition holds, and never says which one failed —
 * an unknown repository, a never-shared grade and a revoked one are one
 * answer, so guessing addresses cannot enumerate fieldnote's repositories.
 *
 * Never hand the caller a stored row: publicGradeFrom() copies out the fields
 * a visitor may read, and drops paths entirely for a private repository.
 */
export async function publicGrade(
  owner: string,
  repo: string,
  graderId: string,
  now = new Date(),
): Promise<PublicGradeView> {
  // process.env, not env(): env() parses the GitHub integration variables too
  // and throws when they are absent, and a public request has no business
  // needing them. DEMO_MODE is the one value this module reads.
  if (process.env.DEMO_MODE === 'true') return PRIVATE;
  // GitHub names are case-insensitive, and two rows for one name would make
  // "which repository is this" a guess — so anything but exactly one match is
  // private.
  const matches = await db()
    .select({
      id: repositories.id,
      owner: repositories.owner,
      name: repositories.name,
      isPrivate: repositories.isPrivate,
    })
    .from(repositories)
    .innerJoin(installations, eq(installations.id, repositories.installationId))
    .innerJoin(
      workspaceRepositories,
      eq(workspaceRepositories.repositoryId, repositories.id),
    )
    .innerJoin(
      publicGrades,
      and(
        eq(publicGrades.repositoryId, repositories.id),
        eq(publicGrades.graderId, graderId),
        isNull(publicGrades.revokedAt),
      ),
    )
    .where(
      and(
        sql`lower(${repositories.owner}) = lower(${owner})`,
        sql`lower(${repositories.name}) = lower(${repo})`,
        eq(repositories.active, true),
        eq(repositories.isDemo, false),
        eq(installations.active, true),
      ),
    )
    .groupBy(repositories.id)
    .limit(2);
  if (matches.length !== 1) return PRIVATE;
  const [match] = matches;
  const repository = { owner: match.owner, name: match.name, isPrivate: match.isPrivate };
  const [run] = await db()
    .select({
      result: runs.result,
      sha: runs.sha,
      completedAt: runs.completedAt,
      confirmedAt: runs.confirmedAt,
    })
    .from(runs)
    .where(
      and(
        eq(runs.repositoryId, match.id),
        eq(runs.graderId, graderId),
        eq(runs.state, 'complete'),
      ),
    )
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(1);
  if (!run?.result || !run.sha || !run.completedAt) {
    // Nothing scored: fall back to the newest published version for identity.
    const manifest = await latestPublishedVersion(graderId);
    if (!manifest) return PRIVATE;
    const verifiedAt = await verifiedAtFor(graderId, manifest.version);
    return { state: 'ungraded', repository, grader: publicGrader(manifest, verifiedAt) };
  }
  const manifest = await graderVersion(graderId, run.result.rubricVersion);
  if (!manifest) return PRIVATE;
  const verifiedAt = await verifiedAtFor(graderId, manifest.version);
  // Never the same lookup as `manifest`: this asks what is published *now*,
  // to say whether the shown grade is on an earlier rubric — comparing the
  // pinned manifest to itself would make that vacuously false.
  const latestManifest = await latestPublishedVersion(graderId);
  return publicGradedView({
    repository,
    manifest,
    verifiedAt,
    latestManifest,
    grade: publicGradeFrom(
      run.result,
      { sha: run.sha, completedAt: run.completedAt },
      match.isPrivate,
    ),
    stale: isStale(freshAt(run.completedAt, run.confirmedAt), now),
  });
}
