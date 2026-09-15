import type { GraderManifest } from './manifest';
import type { CheckResult, GradeResult } from './types';

/**
 * A grade is stale when fieldnote has not confirmed it for this long. The
 * slice 1 design said "older than the grader's minInterval"; no manifest has
 * that field, and adding one would change the hashed rubric of every existing
 * grader. One constant until the registry makes a per-grader interval worth a
 * version bump.
 */
export const STALE_AFTER_DAYS = 30;
const DAY_MS = 86_400_000;

export type PublicRepository = { owner: string; name: string; isPrivate: boolean };

/** The manifest identity a visitor may read. No `needs`, no checks' arguments, no program. */
export type PublicGrader = {
  id: string;
  title: string;
  tagline: string;
  author: string;
  mode: GraderManifest['mode'];
  category: GraderManifest['category'];
  disclaimer: string;
  version: string;
  evaluatorVersion: string;
  checkTitles: Record<string, string>;
};

export type PublicGrade = {
  score: number;
  sha: string;
  computedAt: Date;
  rubricVersion: string;
  evaluatorVersion: string;
  window?: { start: string; endExclusive: string; days: number };
  checks: CheckResult[];
};

export type PublicGradeView =
  | { state: 'private' }
  | { state: 'ungraded'; repository: PublicRepository; grader: PublicGrader }
  | {
      state: 'graded';
      repository: PublicRepository;
      grader: PublicGrader;
      grade: PublicGrade;
      stale: boolean;
      // Whether the shown grade was computed against a version older than
      // what is now published. Never carries the newer manifest itself — a
      // visitor is told "an earlier rubric", not shown what changed.
      outdated: boolean;
    };

export function publicGrader(manifest: GraderManifest): PublicGrader {
  return {
    id: manifest.id,
    title: manifest.card.title,
    tagline: manifest.card.tagline,
    // owner/name: the owner is part of a grader's identity, not decoration.
    author: manifest.id.split('/')[0],
    mode: manifest.mode,
    category: manifest.category,
    disclaimer: manifest.disclaimer,
    version: manifest.version,
    evaluatorVersion: manifest.evaluatorVersion,
    checkTitles: Object.fromEntries(manifest.checks.map((check) => [check.id, check.title])),
  };
}

/**
 * Assembles the 'graded' branch of PublicGradeView. Pure and DB-free:
 * public-grades.ts resolves the run's own pinned manifest and the newest
 * published one, and hands both here — this is "where the view is built",
 * so the outdated comparison lives beside the redaction it sits next to,
 * not in the page.
 *
 * `latestManifest` is the newest published version at read time, never the
 * one the grade was computed with — comparing the pinned manifest to itself
 * would make `outdated` vacuously false, which is the bug this replaces.
 */
export function publicGradedView(input: {
  repository: PublicRepository;
  manifest: GraderManifest;
  latestManifest: GraderManifest | null;
  grade: PublicGrade;
  stale: boolean;
}): Extract<PublicGradeView, { state: 'graded' }> {
  const { latestManifest, manifest } = input;
  const outdated = latestManifest
    ? manifest.version !== latestManifest.version ||
      manifest.evaluatorVersion !== latestManifest.evaluatorVersion
    : false;
  return {
    state: 'graded',
    repository: input.repository,
    grader: publicGrader(manifest),
    grade: input.grade,
    stale: input.stale,
    outdated,
  };
}

/** The moment a grade was last known to hold: its completion, or a later confirmation. */
export function freshAt(completedAt: Date, confirmedAt: Date | null): Date {
  return confirmedAt && confirmedAt.getTime() > completedAt.getTime() ? confirmedAt : completedAt;
}

export function isStale(fresh: Date, now: Date): boolean {
  return now.getTime() - fresh.getTime() > STALE_AFTER_DAYS * DAY_MS;
}

/**
 * The stored result, narrowed to what a visitor may read. Built field by field
 * rather than spread, so a field added to GradeResult never reaches a public
 * page by default. Line ranges never cross: an evidence link is a path, and a
 * private repository keeps even that.
 */
export function publicGradeFrom(
  result: GradeResult,
  run: { sha: string; completedAt: Date },
  repositoryIsPrivate: boolean,
): PublicGrade {
  if (result.score === null) throw new Error('A public grade is a scored grade');
  const checks: CheckResult[] = result.checks.map((check) => ({
    id: check.id,
    points: check.points,
    maxPoints: check.maxPoints,
    status: check.status,
    explanation: check.explanation,
    paths: repositoryIsPrivate ? [] : [...check.paths],
    lineRanges: [],
  }));
  return {
    score: result.score,
    sha: run.sha,
    computedAt: run.completedAt,
    rubricVersion: result.rubricVersion,
    evaluatorVersion: result.evaluatorVersion,
    ...(result.window ? { window: { ...result.window } } : {}),
    checks,
  };
}
