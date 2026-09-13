import { expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanView } from './plan-view';
import { AGENT_READINESS } from '../../domain/grading/graders/agent-readiness';
import { graderCheckTitles } from '../../domain/grading/registry';

const checkTitles = graderCheckTitles(AGENT_READINESS);

const run = {
  id: 'run-1',
  state: 'complete',
  sha: 'e'.repeat(40),
  model: null,
  authorVersion: 'readiness-floor-v01',
  errorCode: null,
  completedAt: new Date('2026-09-11T10:00:00Z'),
} as Parameters<typeof PlanView>[0]['run'];

const remedies = [
  {
    id: 'r1',
    authoringRunId: 'run-1',
    checkId: 'root-agent-instructions',
    path: 'AGENTS.md',
    rationale: 'No nonempty root AGENTS.md or CLAUDE.md was found.',
    ordinal: 0,
  },
] as Parameters<typeof PlanView>[0]['remedies'];

const render = (props: Parameters<typeof PlanView>[0]) =>
  renderToStaticMarkup(createElement(PlanView, props));

test('names each remedy by its path and the readiness check it answers', () => {
  const html = render({ run, remedies, checkTitles });
  expect(html).toContain('AGENTS.md');
  expect(html).toContain('Agent instructions');
});

test('shows the rationale the grade observed, verbatim', () => {
  expect(render({ run, remedies, checkTitles })).toContain(
    'No nonempty root AGENTS.md or CLAUDE.md was found.',
  );
});

test('disables every checkbox, because approving is not built yet', () => {
  const html = render({ run, remedies, checkTitles });
  expect(html).toContain('disabled=""');
  expect(html).not.toContain('<form');
});

test('says no model wrote this plan when model is null', () => {
  expect(render({ run, remedies, checkTitles })).toContain('No model wrote this plan');
});

test('names the model when one did', () => {
  const html = render({ run: { ...run, model: 'claude-opus-5' }, remedies, checkTitles });
  expect(html).toContain('claude-opus-5');
  expect(html).not.toContain('No model wrote this plan');
});

test('reports a run that failed instead of rendering an empty plan', () => {
  const html = render({
    run: { ...run, state: 'failed', errorCode: 'grade_missing' },
    remedies: [],
    checkTitles,
  });
  expect(html).toContain('grade_missing');
});
