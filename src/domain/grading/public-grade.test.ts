import { expect, test } from 'vitest';
import { agentReadinessManifest } from './graders/agent-readiness';
import { deliveryHealthManifest } from './graders/delivery-health';
import {
  freshAt,
  isStale,
  publicGradedView,
  publicGradeFrom,
  publicGrader,
  STALE_AFTER_DAYS,
} from './public-grade';
import type { GradeResult } from './types';

const DAY = 86_400_000;
const result: GradeResult = {
  score: 80,
  rubricVersion: '0.1.0',
  evaluatorVersion: '1.0.0',
  checks: [
    {
      id: 'root-readme',
      points: 20,
      maxPoints: 20,
      status: 'pass',
      paths: ['README.md'],
      lineRanges: [{ path: 'README.md', blobSha: 'b'.repeat(40), start: 1, end: 1 }],
      explanation: 'Found a root README file. Evidence, not certification.',
    },
  ],
};
const run = { sha: 'a'.repeat(40), completedAt: new Date('2026-09-01T00:00:00.000Z') };

test('a public grader is the manifest identity a visitor may read, plus whether fieldnote read it', () => {
  expect(publicGrader(agentReadinessManifest)).toEqual({
    id: 'fieldnote/agent-readiness',
    title: agentReadinessManifest.card.title,
    tagline: agentReadinessManifest.card.tagline,
    author: 'fieldnote',
    mode: 'deterministic',
    category: 'agent-readiness',
    disclaimer: agentReadinessManifest.disclaimer,
    version: agentReadinessManifest.version,
    evaluatorVersion: agentReadinessManifest.evaluatorVersion,
    checkTitles: Object.fromEntries(
      agentReadinessManifest.checks.map((check) => [check.id, check.title]),
    ),
    verifiedAt: null,
  });
});

// Decision 4: a public grade page never names a grader with no review state.
// verifiedAt is a fact about the grader, not the repository being graded, so
// it crosses the narrow-copy boundary the same way every other field here
// does — never the whole manifest, never `needs`, just this one more fact.
test('publicGrader carries the verification date it is given, not derived from the manifest', () => {
  const verifiedAt = new Date('2026-09-01T00:00:00.000Z');
  expect(publicGrader(agentReadinessManifest, verifiedAt).verifiedAt).toEqual(verifiedAt);
});

// The 'graded' branch of PublicGradeView is where slice 5's narrow-copy
// invariant lives now: no `needs`, no program source, no full manifest —
// just what a visitor may read, plus `outdated`. toEqual on a real call
// through publicGradedView() (not a hand-written literal) is what makes this
// a guard: a future widening — the whole manifest again, say — adds a key
// this list does not name, and fails here rather than only showing up as an
// unused field nobody notices.
test('a graded view carries exactly the fields a visitor may read, plus whether it is outdated', () => {
  const verifiedAt = new Date('2026-09-01T00:00:00.000Z');
  const view = publicGradedView({
    repository: { owner: 'acme', name: 'widgets', isPrivate: false },
    manifest: agentReadinessManifest,
    verifiedAt,
    latestManifest: agentReadinessManifest,
    grade: publicGradeFrom(result, run, false),
    stale: false,
  });
  expect(Object.keys(view).sort()).toEqual([
    'grade',
    'grader',
    'outdated',
    'repository',
    'stale',
    'state',
  ]);
  expect(view.grader.verifiedAt).toEqual(verifiedAt);
});

test('publicGradedView marks a grade outdated once a newer version is published', () => {
  const newer = { ...agentReadinessManifest, version: '9.9.9' };
  const view = publicGradedView({
    repository: { owner: 'acme', name: 'widgets', isPrivate: false },
    manifest: agentReadinessManifest,
    verifiedAt: null,
    latestManifest: newer,
    grade: publicGradeFrom(result, run, false),
    stale: false,
  });
  expect(view.outdated).toBe(true);
});

test('publicGradedView is not outdated when nothing newer has published', () => {
  const view = publicGradedView({
    repository: { owner: 'acme', name: 'widgets', isPrivate: false },
    manifest: agentReadinessManifest,
    verifiedAt: null,
    latestManifest: agentReadinessManifest,
    grade: publicGradeFrom(result, run, false),
    stale: false,
  });
  expect(view.outdated).toBe(false);
});

test('a public repository keeps its evidence paths, and never its line ranges', () => {
  const grade = publicGradeFrom(result, run, false);
  expect(grade.checks[0].paths).toEqual(['README.md']);
  expect(grade.checks[0].lineRanges).toEqual([]);
});

test('a private repository keeps no path at all', () => {
  const grade = publicGradeFrom(result, run, true);
  expect(grade.checks[0].paths).toEqual([]);
  expect(JSON.stringify(grade)).not.toContain('README.md');
});

test('a public grade carries exactly the fields a visitor may read', () => {
  expect(Object.keys(publicGradeFrom(result, run, false)).sort()).toEqual([
    'checks',
    'computedAt',
    'evaluatorVersion',
    'rubricVersion',
    'score',
    'sha',
  ]);
  expect(Object.keys(publicGradeFrom(result, run, false).checks[0]).sort()).toEqual([
    'explanation',
    'id',
    'lineRanges',
    'maxPoints',
    'paths',
    'points',
    'status',
  ]);
});

test('a window grader carries the dates it scored', () => {
  const windowed: GradeResult = {
    ...result,
    rubricVersion: deliveryHealthManifest.version,
    window: { start: '2026-08-01T00:00:00.000Z', endExclusive: '2026-08-31T00:00:00.000Z', days: 30 },
  };
  expect(publicGradeFrom(windowed, run, false).window).toEqual(windowed.window);
});

test('an unscored result is never a public grade', () => {
  expect(() => publicGradeFrom({ ...result, score: null }, run, false)).toThrow();
});

test('freshness is the later of completion and confirmation', () => {
  const completed = new Date('2026-09-01T00:00:00.000Z');
  const confirmed = new Date('2026-09-20T00:00:00.000Z');
  expect(freshAt(completed, null)).toEqual(completed);
  expect(freshAt(completed, confirmed)).toEqual(confirmed);
  expect(freshAt(confirmed, completed)).toEqual(confirmed);
});

test('a grade goes stale strictly after thirty days', () => {
  const fresh = new Date('2026-09-01T00:00:00.000Z');
  expect(STALE_AFTER_DAYS).toBe(30);
  expect(isStale(fresh, new Date(fresh.getTime() + STALE_AFTER_DAYS * DAY))).toBe(false);
  expect(isStale(fresh, new Date(fresh.getTime() + STALE_AFTER_DAYS * DAY + 1))).toBe(true);
});
