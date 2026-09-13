import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import type { CompletedGrade } from '../../db/queries/grade-runs';
import type { CheckResult } from '../../domain/grading/types';
vi.stubGlobal('React', React);
vi.mock('../../app/app/repos/[repoId]/grading/actions', () => ({ runGrade: vi.fn() }));
import { GradeCard } from '@fieldnote/design-system';
import { gradeCardProps } from './grade-presentation';
import { GradeReport } from './report';
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
    createElement(GradeReport, { grade, owner: 'owner', name: 'repo', outdated: false }),
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
  [0, 'common', 'An agent will guess'],
  [50, 'shimmer', 'can start, but will stop'],
  [70, 'bronze', 'Enough context to work from'],
  [80, 'silver', 'Readable, testable, navigable'],
  [90, 'gold', 'land a change unaided'],
  [100, 'rainbow', 'Nothing the rubric asks for is missing'],
] as const)(
  'score %s renders the %s finish with its flavour line',
  (score, finish, flavourSnippet) => {
    const html = renderToStaticMarkup(
      createElement(
        GradeCard,
        gradeCardProps({
          score,
          repositoryName: 'demo/repo',
          sha,
          rubricVersion: '0.1.0',
          checks: score === 100 ? [passingCheck] : [passingCheck, failingCheck],
        }),
      ),
    );
    expect(html).toContain(`data-finish="${finish}"`);
    expect(html).toContain(flavourSnippet);
    if (score === 100) {
      expect(html).toContain('No higher tier.');
      expect(html).not.toContain('Next tier');
    }
  },
);

test('actual evaluator checks have readable report headings', async () => {
  const { evaluateReadiness } = await import('../../domain/grading/readiness-v01');
  const evaluated = evaluateReadiness({ sha, complete: true, documents: [] });
  const html = renderToStaticMarkup(
    createElement(GradeReport, {
      grade: { ...grade, ...evaluated },
      owner: 'owner',
      name: 'repo',
      outdated: false,
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
