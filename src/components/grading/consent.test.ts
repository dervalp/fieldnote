import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { ConsentScreen } from './consent';
import { agentReadinessManifest } from '../../domain/grading/graders/agent-readiness';
import { deliveryHealthManifest } from '../../domain/grading/graders/delivery-health';

const render = (manifest: typeof agentReadinessManifest) =>
  renderToStaticMarkup(
    createElement(ConsentScreen, {
      manifest,
      author: 'fieldnote',
      version: manifest.version,
      action: vi.fn(),
      cancelHref: '/app/settings/graders',
    }),
  );

test('a file grader asks for the files it declared, and nothing about file lists', () => {
  const html = render(agentReadinessManifest);
  expect(html).toContain('The contents of files matching README.md');
  expect(html).not.toContain('list of file names');
});

test('a metrics grader asks for the window it declared', () => {
  expect(render(deliveryHealthManifest)).toContain(
    'Your merged pull request and CI record over 30 days',
  );
});

test('the screen names the grader, its author and the version being installed', () => {
  const html = render(agentReadinessManifest);
  expect(html).toContain(agentReadinessManifest.card.title);
  expect(html).toContain('fieldnote');
  expect(html).toContain(agentReadinessManifest.version);
});

test('it says plainly that nothing else is collected', () => {
  expect(render(agentReadinessManifest)).toContain('Nothing else is collected.');
});
