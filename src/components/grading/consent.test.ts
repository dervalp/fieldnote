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

test('the default mode asks to install', () => {
  const html = render(agentReadinessManifest);
  expect(html).toContain(`Install ${agentReadinessManifest.card.title}`);
  expect(html).toContain('>Install<');
});

test('a never-reviewed grader carries the not-reviewed line by default', () => {
  expect(render(agentReadinessManifest)).toContain('Not reviewed');
});

// This is the state line's only appearance in a customer-facing screen, and
// the point of the whole feature: a reviewer must be able to trust that what
// they read here is what a customer is shown, not a copy that can drift.
test('a verified grader carries the same read-by-fieldnote line the settings page shows', () => {
  const html = renderToStaticMarkup(
    createElement(ConsentScreen, {
      manifest: agentReadinessManifest,
      author: 'fieldnote',
      version: agentReadinessManifest.version,
      action: vi.fn(),
      cancelHref: '/app/settings/graders',
      verifiedAt: new Date('2026-09-01'),
    }),
  );
  expect(html).toContain('Read by fieldnote on 2026-09-01');
  expect(html).not.toContain('Not reviewed');
});

test("update mode says 'Update', not 'Install', in the heading and the button", () => {
  const html = renderToStaticMarkup(
    createElement(ConsentScreen, {
      manifest: agentReadinessManifest,
      author: 'fieldnote',
      version: agentReadinessManifest.version,
      action: vi.fn(),
      cancelHref: '/app/settings/graders',
      mode: 'update',
    }),
  );
  expect(html).toContain(`Update ${agentReadinessManifest.card.title}`);
  expect(html).toContain('>Update<');
  expect(html).not.toContain(`Install ${agentReadinessManifest.card.title}`);
});
