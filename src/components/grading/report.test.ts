import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import type { CompletedGrade } from '../../db/queries/grade-runs';
import type { CheckResult } from '../../domain/grading/types';
vi.stubGlobal('React', React);
vi.mock('../../app/app/repos/[repoId]/grading/actions', () => ({
  runGrade: vi.fn(),
  setGradeSchedule: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { GradeCard } from '@fieldnote/design-system';
import { gradeCardProps } from './grade-presentation';
import { GradeControls } from './report';
import { GradeReport } from './report-view';
import { ScheduleToggle } from './schedule-toggle';
import {
  AGENT_READINESS,
  agentReadinessManifest,
} from '../../domain/grading/graders/agent-readiness';
import { deliveryHealthManifest } from '../../domain/grading/graders/delivery-health';
const titles = Object.fromEntries(
  agentReadinessManifest.checks.map((check) => [check.id, check.title]),
);
const sha = 'a'.repeat(40);
const grade: CompletedGrade = {
  id: 'run',
  score: 60,
  sha,
  computedAt: new Date('2026-09-08T00:00:00Z'),
  rubricVersion: '0.1.0',
  evaluatorVersion: '1.0.0',
  checks: [
    {
      id: 'root-readme',
      points: 20,
      maxPoints: 20,
      status: 'pass',
      paths: ['docs/<script>alert(1)</script>.md'],
      lineRanges: [
        { path: 'docs/<script>alert(1)</script>.md', blobSha: 'b'.repeat(40), start: 2, end: 4 },
      ],
      explanation: '<img src=x onerror=alert(1)>',
    },
  ],
};
test('untrusted explanation and path are escaped, links are pinned and encoded', () => {
  const html = renderToStaticMarkup(
    createElement(GradeReport, {
      grade,
      owner: 'owner',
      name: 'repo',
      outdated: false,
      checkTitles: titles,
      graderTitle: agentReadinessManifest.card.title,
      disclaimer: agentReadinessManifest.disclaimer,
    }),
  );
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img');
  expect(html).toContain(
    `https://github.com/owner/repo/blob/${sha}/docs/%3Cscript%3Ealert(1)%3C/script%3E.md#L2-L4`,
  );
  expect(html).toContain('Evaluator 1.0.0');
  expect(html).toContain('2026-09-08');
});
test('historical report displays its stored version and outdated notice', () => {
  const html = renderToStaticMarkup(
    createElement(GradeReport, {
      grade: { ...grade, rubricVersion: '0.0.1' },
      owner: 'owner',
      name: 'repo',
      outdated: true,
      checkTitles: titles,
      graderTitle: agentReadinessManifest.card.title,
      disclaimer: agentReadinessManifest.disclaimer,
    }),
  );
  expect(html).toContain('Historical rubric');
  expect(html).toContain('Readiness v0.0.1');
});
test.each([0, 49, 50, 69, 70, 79, 80, 89, 90, 99, 100])(
  'card %s uses accessible SVG markers and real-position thresholds',
  (score) => {
    const html = renderToStaticMarkup(
      createElement(
        GradeCard,
        gradeCardProps({
          score,
          repositoryName: '<script>repo</script>',
          sha,
          rubricVersion: '0.1.0',
          checks: grade.checks,
          grader: agentReadinessManifest,
        }),
      ),
    );
    expect(html).toContain(`${score} out of 100`);
    expect(html).not.toContain('<script>');
    expect(html).toContain('left:50%');
    expect(html).toContain('left:70%');
    expect(html).toContain('left:80%');
    expect(html).toContain('left:90%');
    expect(html).not.toContain('type="range"');
    expect(html).toContain(score < 70 ? '<circle' : 'm12 1');
    expect(html.includes('Prismatic · Perfect score')).toBe(score === 100);
  },
);

// The identity strip beneath the heading is hidden from assistive tech (its
// `·` separators are CSS-generated, which is not reliably exposed), so the
// facts it carries — author, version, mode, category — have to reach a
// screen reader through the section's own accessible name instead. This
// pins that they do, using a second grader so a hardcoded "Agent Readiness"
// slipping back in would be caught even though it also happens to satisfy
// the identity-strip test above.
test('the accessible name carries author, version, mode and category, not just the score', () => {
  const html = renderToStaticMarkup(
    createElement(
      GradeCard,
      gradeCardProps({
        score: 70,
        repositoryName: 'acme/checkout',
        sha,
        rubricVersion: deliveryHealthManifest.version,
        checks: [],
        grader: deliveryHealthManifest,
      }),
    ),
  );
  expect(html).toContain(
    'aria-label="Delivery Health by fieldnote, version 0.2.0, Deterministic, Delivery health. 70 out of 100, Good"',
  );
});

// The rubric is five 20-point checks, so only 0/20/40/60/80/100 occur today —
// Bronze (70-79) and Gold (90-99) are unreachable. The spec requires the card
// to render correctly for all six finishes regardless, because the
// unreachable ones become reachable the moment the rubric grows, and a finish
// first exercised the day it appears in production is a finish nobody has
// looked at.
const passingCheck: CheckResult = {
  id: 'root-agent-instructions',
  points: 20,
  maxPoints: 20,
  status: 'pass',
  paths: [],
  lineRanges: [],
  explanation: '',
};
const failingCheck: CheckResult = {
  id: 'documented-tests',
  points: 0,
  maxPoints: 20,
  status: 'fail',
  paths: [],
  lineRanges: [],
  explanation: '',
};
test.each([
  [0, 'common'],
  [50, 'shimmer'],
  [70, 'bronze'],
  [80, 'silver'],
  [90, 'gold'],
  [100, 'prismatic'],
] as const)('score %s renders the %s finish with the grader tagline', (score, finish) => {
  const html = renderToStaticMarkup(
    createElement(
      GradeCard,
      gradeCardProps({
        score,
        repositoryName: 'demo/repo',
        sha,
        rubricVersion: '0.1.0',
        checks: score === 100 ? [passingCheck] : [passingCheck, failingCheck],
        grader: agentReadinessManifest,
      }),
    ),
  );
  expect(html).toContain(`data-finish="${finish}"`);
  // One tagline per grader, at every finish. The six per-finish flavour lines
  // are a deliberate loss: under the contract a grader supplies one sentence,
  // and a special case for the built-in would make the contract a fiction.
  // The landing page's ladder keeps a line per band, as marketing copy of its
  // own — see src/components/marketing/ladder-copy.ts.
  expect(html).toContain('Can an agent work in this repository at all?');
  if (score === 100) {
    expect(html).toContain('No higher tier.');
    expect(html).not.toContain('Next tier');
  }
});

test('actual grader checks have readable report headings', async () => {
  const { runDeclarative } = await import('../../domain/grading/declarative');
  const evaluated = runDeclarative(agentReadinessManifest, { sha, complete: true, documents: [] });
  const html = renderToStaticMarkup(
    createElement(GradeReport, {
      grade: { ...grade, ...evaluated },
      owner: 'owner',
      name: 'repo',
      outdated: false,
      checkTitles: titles,
      graderTitle: agentReadinessManifest.card.title,
      disclaimer: agentReadinessManifest.disclaimer,
    }),
  );
  for (const label of [
    'Agent instructions',
    'Project documentation',
    'Documentation',
    'Setup instructions',
    'Validation commands',
  ])
    expect(html).toContain(label);
  for (const check of evaluated.checks) expect(html).not.toContain(check.id);
});

test('the report wears its grader name and its grader disclaimer', () => {
  const html = renderToStaticMarkup(
    createElement(GradeReport, {
      grade,
      owner: 'acme',
      name: 'checkout',
      outdated: false,
      checkTitles: { 'merges-land-clean': 'Merges land clean' },
      graderTitle: deliveryHealthManifest.card.title,
      disclaimer: deliveryHealthManifest.disclaimer,
    }),
  );
  expect(html).toContain('Delivery Health v0.1.0');
  expect(html).toContain(deliveryHealthManifest.disclaimer);
  expect(html).not.toContain('Readiness v');
  expect(html).not.toContain('does not execute repository code');
});

test('a grade with a window names the dates it scored', () => {
  const html = renderToStaticMarkup(
    createElement(GradeReport, {
      grade: {
        ...grade,
        window: {
          start: '2026-08-15T00:00:00.000Z',
          endExclusive: '2026-09-14T00:00:00.000Z',
          days: 30,
        },
      },
      owner: 'acme',
      name: 'checkout',
      outdated: false,
      checkTitles: { 'merges-land-clean': 'Merges land clean' },
      graderTitle: deliveryHealthManifest.card.title,
      disclaimer: deliveryHealthManifest.disclaimer,
    }),
  );
  expect(html).toContain('2026-08-15');
  expect(html).toContain('2026-09-13');
  expect(html).toContain('30 days');
});

test('a grade with no window renders no window line', () => {
  const html = renderToStaticMarkup(
    createElement(GradeReport, {
      grade,
      owner: 'owner',
      name: 'repo',
      outdated: false,
      checkTitles: titles,
      graderTitle: agentReadinessManifest.card.title,
      disclaimer: agentReadinessManifest.disclaimer,
    }),
  );
  expect(html).not.toContain('days');
});

test('a metric check renders its measurement and no empty evidence block', () => {
  const metricGrade = {
    ...grade,
    checks: [
      {
        id: 'merges-land-clean',
        points: 40,
        maxPoints: 40,
        status: 'pass',
        paths: [],
        lineRanges: [],
        explanation: 'Most merged pull requests passed review and CI on the first attempt.',
      } satisfies CheckResult,
    ],
  };
  const html = renderToStaticMarkup(
    createElement(GradeReport, {
      grade: metricGrade,
      owner: 'acme',
      name: 'checkout',
      outdated: false,
      checkTitles: { 'merges-land-clean': 'Merges land clean' },
      graderTitle: deliveryHealthManifest.card.title,
      disclaimer: deliveryHealthManifest.disclaimer,
    }),
  );
  expect(html).toContain('Most merged pull requests passed review');
  expect(html).not.toContain('Show pinned evidence');
});

// The ternary in GradeControls is the whole point of the errorCode work: it
// decides whether a team reads a failure as theirs ("not enough record") or
// fieldnote's ("the grader could not finish"). These pin both branches by
// their specific copy, not merely that something rendered, so swapped
// branches, a misspelled literal, or a deleted errorCode check would fail.
const NOT_ENOUGH_RECORD =
  'There is not enough record in this window to score. Try again once more work has merged.';
const COULD_NOT_FINISH =
  'The grader could not finish. Your last completed report is unchanged. Try again.';
test('a run that failed for insufficient evidence tells the team it is their record, not fieldnote', () => {
  const html = renderToStaticMarkup(
    createElement(GradeControls, {
      repositoryId: 'repo',
      graderId: AGENT_READINESS,
      initial: { id: 'run', state: 'failed', errorCode: 'insufficient_evidence' },
      canRun: true,
    }),
  );
  expect(html).toContain(NOT_ENOUGH_RECORD);
  expect(html).not.toContain(COULD_NOT_FINISH);
});
test('a run that failed to collect evidence tells the team fieldnote could not finish, not that their record is thin', () => {
  const html = renderToStaticMarkup(
    createElement(GradeControls, {
      repositoryId: 'repo',
      graderId: AGENT_READINESS,
      initial: { id: 'run', state: 'failed', errorCode: 'incomplete_collection' },
      canRun: true,
    }),
  );
  expect(html).toContain(COULD_NOT_FINISH);
  expect(html).not.toContain(NOT_ENOUGH_RECORD);
});
test('a failed run with no error code, as an older row would look, reads as the generic failure', () => {
  const html = renderToStaticMarkup(
    createElement(GradeControls, {
      repositoryId: 'repo',
      graderId: AGENT_READINESS,
      initial: { id: 'run', state: 'failed', errorCode: null },
      canRun: true,
    }),
  );
  expect(html).toContain(COULD_NOT_FINISH);
  expect(html).not.toContain(NOT_ENOUGH_RECORD);
});
const SANDBOX_UNAVAILABLE = 'Grading is temporarily unavailable. Try again later.';
test('a run that failed for want of a sandbox says so, not that the grader broke', () => {
  const html = renderToStaticMarkup(
    createElement(GradeControls, {
      repositoryId: 'repo',
      graderId: AGENT_READINESS,
      initial: { id: 'run', state: 'failed', errorCode: 'sandbox_unavailable' },
      canRun: true,
    }),
  );
  expect(html).toContain(SANDBOX_UNAVAILABLE);
  expect(html).not.toContain(COULD_NOT_FINISH);
});
test('a run whose program failed reads as the grader not finishing', () => {
  const html = renderToStaticMarkup(
    createElement(GradeControls, {
      repositoryId: 'repo',
      graderId: AGENT_READINESS,
      initial: { id: 'run', state: 'failed', errorCode: 'grader_failed' },
      canRun: true,
    }),
  );
  expect(html).toContain(COULD_NOT_FINISH);
});

test('an unscored report prints measurements and no points', () => {
  const html = renderToStaticMarkup(
    createElement(GradeReport, {
      grade: {
        sha,
        computedAt: new Date('2026-09-14T03:00:00Z'),
        score: null,
        rubricVersion: '0.2.0',
        evaluatorVersion: '1.0.0',
        incompleteReason: 'Fewer than ten pull requests merged in this window.',
        checks: [
          {
            id: 'merges-land-clean',
            points: 0,
            maxPoints: 40,
            status: 'fail',
            paths: [],
            lineRanges: [],
            explanation: 'Too few merged pull requests passed on the first attempt.',
          },
        ],
      },
      owner: 'owner',
      name: 'repo',
      outdated: false,
      checkTitles: { 'merges-land-clean': 'Merges land clean' },
      graderTitle: 'Delivery Health',
      disclaimer: 'A disclaimer.',
    }),
  );
  expect(html).toContain('Fewer than ten pull requests merged in this window.');
  expect(html).toContain('Merges land clean');
  expect(html).not.toContain('0 / 40');
});

test('a paused schedule says why and offers to be taken over', () => {
  const html = renderToStaticMarkup(
    createElement(ScheduleToggle, {
      repositoryId: 'repo-1',
      graderId: AGENT_READINESS,
      schedule: { paused: true },
      canRun: true,
    }),
  );
  expect(html).toContain('no longer has access');
  expect(html).toContain('Turn off nightly grading');
});

test('an off schedule offers to be turned on and says nothing about pausing', () => {
  const html = renderToStaticMarkup(
    createElement(ScheduleToggle, {
      repositoryId: 'repo-1',
      graderId: AGENT_READINESS,
      schedule: null,
      canRun: true,
    }),
  );
  expect(html).toContain('Grade nightly');
  expect(html).not.toContain('no longer has access');
});

test('a demo repository gets no toggle', () => {
  expect(
    renderToStaticMarkup(
      createElement(ScheduleToggle, {
        repositoryId: 'repo-1',
        graderId: AGENT_READINESS,
        schedule: null,
        canRun: false,
      }),
    ),
  ).toBe('');
});
