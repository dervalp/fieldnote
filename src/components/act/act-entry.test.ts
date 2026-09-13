import { expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../app/app/repos/[repoId]/grading/actions', () => ({
  requestPlanRun: vi.fn(),
  runGrade: vi.fn(),
}));

import { ActEntry } from './act-entry';

const render = (props: Parameters<typeof ActEntry>[0]) =>
  renderToStaticMarkup(createElement(ActEntry, props));

test('offers a plan when Act is available and no plan exists', () => {
  const html = render({
    repositoryId: 'repo',
    availability: { available: true },
    latest: null,
  });
  expect(html).toContain('Plan the fixes');
});

test('renders nothing when Act is unavailable, because the availability line already explains why', () => {
  const html = render({
    repositoryId: 'repo',
    availability: { available: false, reason: 'not_enabled' },
    latest: null,
  });
  expect(html).toBe('');
});

test('links to a completed plan rather than offering another', () => {
  const html = render({
    repositoryId: 'repo',
    availability: { available: true },
    latest: { id: 'run-1', state: 'complete' },
  });
  expect(html).toContain('/repos/repo/act/run-1');
  expect(html).not.toContain('Plan the fixes');
});

test('says a plan is already running instead of offering a second', () => {
  const html = render({
    repositoryId: 'repo',
    availability: { available: true },
    latest: { id: 'run-1', state: 'running' },
  });
  expect(html).toContain('Planning');
  expect(html).not.toContain('Plan the fixes');
});

test('offers a plan again after one failed', () => {
  const html = render({
    repositoryId: 'repo',
    availability: { available: true },
    latest: { id: 'run-1', state: 'failed' },
  });
  expect(html).toContain('Plan the fixes');
});
