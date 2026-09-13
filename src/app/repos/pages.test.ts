import { createElement, type ReactNode } from 'react';
import { renderToReadableStream } from 'react-dom/server';
import { beforeEach, expect, test, vi } from 'vitest';

// `Directory` now renders `<AppShell>` as JSX (an async Server Component
// nested one level down), rather than calling it directly. The synchronous
// `renderToStaticMarkup` cannot resolve a nested async component and throws
// "a component suspended while responding to synchronous input" — the
// streaming renderer can wait on it, so tests read the fully-drained stream.
async function renderAsync(node: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value);
  }
  return html;
}
// Repository-detail coverage (KPI cards, PR table, gate policy, route-id
// guards) moved with that behaviour: Task 6 rewrote `./[repoId]/page` as the
// Agents view, so it is now covered by `./[repoId]/page.test.ts`. This file
// keeps only the `/repos` directory, which Task 6 did not touch.
//
// `./page` now renders `AppShell` directly (Task 6 restructured the /repos
// route since its layout could not pass a trail down to `[repoId]`), so this
// test mocks the same shell dependencies `app-shell.test.ts` does.
const deps = vi.hoisted(() => ({
  available: vi.fn(),
  records: vi.fn(),
}));
vi.mock('../../auth/access', () => ({ accessibleRepositories: deps.available }));
vi.mock('../../db/queries/repository-records', () => ({ repositoryRecords: deps.records }));
vi.mock('../../lib/env', () => ({ env: () => ({ DEMO_MODE: 'false' }) }));
vi.mock('../../auth/session', () => ({
  currentUser: async () => ({ id: 'u1', displayName: 'Pierre', login: 'pierre' }),
}));
vi.mock('../../workspaces/access', () => ({
  requireWorkspace: async () => ({ id: 'w1', name: 'Personal workspace', role: 'owner' }),
}));
vi.mock('../../workspaces/store', () => ({ listWorkspaces: async () => [] }));
vi.mock('../../components/sidebar', () => ({ Sidebar: () => createElement('aside') }));
import Directory from './page';
const repo = {
  id: 'repository:1',
  owner: 'owner',
  name: 'real-project',
  trackingStartedAt: new Date(),
  canAdmin: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  deps.available.mockResolvedValue([repo, { ...repo, id: 'untracked', trackingStartedAt: null }]);
  deps.records.mockResolvedValue([
    {
      repositoryId: 'repository:1',
      prs: [],
      accessiblePrCount: 100,
      reviewDetected: false,
      ciDetected: false,
      latestPrActivity: '2026-09-07T10:00:00.000Z',
      lastSuccessfulFetch: { at: '2026-09-06T10:00:00.000Z', source: 'Latest PR import' },
      latestAttempt: {
        at: '2026-09-08T10:00:00.000Z',
        status: 'failed',
        source: 'Latest PR import',
      },
      importState: 'failed',
      historyState: 'partial',
    },
  ]);
});
test('directory shows only tracked authorized repositories with genuine links and separate failed attempt', async () => {
  const html = await renderAsync(
    await Directory({ searchParams: Promise.resolve({ days: '90' }) }),
  );
  expect(deps.records).toHaveBeenCalledWith(['repository:1']);
  expect(html).toContain('href="/repos/repository%3A1?days=90"');
  expect(html).toContain('https://github.com/owner/real-project');
  expect(html).toContain('2026-09-06');
  expect(html).toContain('2026-09-08');
  expect(html).toContain('failed');
  expect(html).toContain('No review or CI detected');
  expect(html).not.toContain('Not configured');
});
