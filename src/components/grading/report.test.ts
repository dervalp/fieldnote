import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import type { CompletedGrade } from '../../db/queries/grade-runs';
import type { CheckResult } from '../../domain/grading/types';
vi.stubGlobal('React', React);
vi.mock('../../app/repos/[repoId]/grading/actions', () => ({ runGrade: vi.fn() }));
import { GradeCard } from '@fieldnote/design-system';
import { gradeCardProps } from './grade-presentation';
import { GradeReport } from './report';
import {
  AGENT_READINESS,
  agentReadinessManifest,
} from '../../domain/grading/graders/agent-readiness';
import { graderCheckTitles } from '../../domain/grading/registry';
const titles = graderCheckTitles(agentReadinessManifest.id);
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
          graderId: AGENT_READINESS,
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
        graderId: AGENT_READINESS,
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
