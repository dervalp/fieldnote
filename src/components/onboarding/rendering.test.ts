import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
vi.mock('../../app/app/onboarding/actions', () => ({
  startFirstAnalysis: vi.fn(),
  retryAnalysis: vi.fn(),
  refreshRepositoryAccess: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { RepositoryPicker } from './repository-picker';
import { ImportProgress } from './import-progress';
import type { ImportSnapshot } from '../../domain/import/types';
const repository = { id: 'repo', owner: 'org', name: 'project', canAdmin: true, isPrivate: true };
const run: ImportSnapshot = {
  id: 'run',
  repositoryId: 'repo',
  state: 'queued',
  total: null,
  completed: 0,
  failed: 0,
  message: null,
  createdAt: '2026-09-08T00:00:00.000Z',
  finishedAt: null,
};
function progress(changes: Partial<ImportSnapshot>, canAdmin = true) {
  return renderToStaticMarkup(
    createElement(ImportProgress, { initial: { ...run, ...changes }, repository, canAdmin }),
  );
}
test('picker starts unselected with disabled submit and admin-only choice', () => {
  const html = renderToStaticMarkup(
    createElement(RepositoryPicker, {
      repositories: [repository, { ...repository, id: 'read', canAdmin: false }],
      installUrl: 'https://github.com/apps/fieldnote/installations/new',
    }),
  );
  expect(html).not.toContain('checked=');
  expect(html).toContain('disabled="">Start first analysis');
  expect(html).toContain('Ask a repository admin to enable analysis');
});
test('queued and discovering do not render percentages', () => {
  expect(progress({ state: 'queued', total: 100 })).not.toContain('<progress');
  expect(progress({ state: 'discovering' })).toContain('Finding your latest 100 pull requests.');
});
test('partial results preserve actual success percentage and restrict retries', () => {
  const html = progress({ state: 'partial', total: 100, completed: 90, failed: 10 });
  expect(html).toContain('value="90"');
  expect(html).toContain('10 PRs could not be imported');
  expect(html).toContain('Retry failed PRs');
  expect(
    progress({ state: 'partial', total: 100, completed: 90, failed: 10 }, false),
  ).not.toContain('Retry failed PRs');
});
test('empty completion explains new activity without invented percentage', () => {
  const html = progress({ state: 'complete', total: 0 });
  expect(html).toContain('No pull requests yet.');
  expect(html).not.toContain('<progress');
  expect(html).toContain('View repository');
});
