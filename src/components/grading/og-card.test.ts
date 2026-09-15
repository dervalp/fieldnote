import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { OgCard } from './og-card';
import { publicGrader } from '../../domain/grading/public-grade';
import { agentReadinessManifest } from '../../domain/grading/graders/agent-readiness';

const grader = publicGrader(agentReadinessManifest);
const repository = { owner: 'acme', name: 'widgets', isPrivate: false };
const grade = {
  score: 80,
  sha: 'a'.repeat(40),
  computedAt: new Date('2026-09-01T00:00:00.000Z'),
  rubricVersion: '0.1.0',
  evaluatorVersion: '1.0.0',
  checks: [
    {
      id: 'root-readme',
      points: 20,
      maxPoints: 20,
      status: 'pass' as const,
      paths: ['README.md'],
      lineRanges: [],
      explanation: 'Found a root README.md.',
    },
  ],
};
const render = (view: Parameters<typeof OgCard>[0]['view']) =>
  renderToStaticMarkup(createElement(OgCard, { view }));

test('a graded image shows the score, the grader and the repository', () => {
  const html = render({ state: 'graded', repository, grader, grade, stale: false, outdated: false });
  expect(html).toContain('80');
  expect(html).toContain('Very good');
  expect(html).toContain('Agent Readiness');
  expect(html).toContain('acme/widgets');
});

test('an image never carries a check or a file name', () => {
  const html = render({ state: 'graded', repository, grader, grade, stale: false, outdated: false });
  expect(html).not.toContain('README.md');
  expect(html).not.toContain('Project documentation');
});

test('a stale image says stale and no number', () => {
  const html = render({ state: 'graded', repository, grader, grade, stale: true, outdated: false });
  expect(html).toContain('stale');
  expect(html).not.toContain('>80<');
});

test('a private image says only fieldnote', () => {
  const html = render({ state: 'private' });
  expect(html).toContain('fieldnote');
  expect(html).not.toContain('acme');
  expect(html).not.toContain('Agent Readiness');
});

test('the same state line as the page names whether fieldnote read this grader', () => {
  const unreviewedHtml = render({ state: 'graded', repository, grader, grade, stale: false, outdated: false });
  expect(unreviewedHtml).toContain('Not reviewed');

  const verified = { ...grader, verifiedAt: new Date('2026-09-01T00:00:00.000Z') };
  const verifiedHtml = render({
    state: 'graded',
    repository,
    grader: verified,
    grade,
    stale: false,
    outdated: false,
  });
  expect(verifiedHtml).toContain('Read by fieldnote on 2026-09-01');
});
