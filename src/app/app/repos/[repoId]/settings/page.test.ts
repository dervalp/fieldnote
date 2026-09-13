import { beforeEach, expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const deps = vi.hoisted(() => ({
  authorize: vi.fn(),
  policy: vi.fn(),
  latest: vi.fn(),
  record: vi.fn(),
  prRows: vi.fn(),
  actEnabled: vi.fn(),
}));
vi.mock('../../../../../auth/access', () => ({ requireTrackedRepository: deps.authorize }));
vi.mock('../../../../../db/queries/dashboard', () => ({
  currentPolicy: deps.policy,
  prRows: deps.prRows,
}));
vi.mock('../../../../../db/queries/repository-imports', () => ({ latestImport: deps.latest }));
vi.mock('../../../../../db/queries/repository-header', () => ({ repositoryRecord: deps.record }));
vi.mock('../../../../../db/queries/act-settings', () => ({ actEnabled: deps.actEnabled }));

import Settings from './page';

const call = () => Settings({ params: Promise.resolve({ repoId: 'repo' }) });

const policy = {
  version: 3,
  gates: [
    { appId: '15368', name: 'unit' },
    { appId: '15368', name: 'playwright' },
  ],
};

const record = {
  repositoryId: 'repo',
  prs: [],
  accessiblePrCount: 21,
  latestPrActivity: '2026-09-10T14:02:00.000Z',
  reviewDetected: true,
  ciDetected: true,
  lastSuccessfulFetch: { at: '2026-09-10T14:02:00.000Z', source: 'webhook delivery' },
  latestAttempt: { at: '2026-09-10T14:02:00.000Z', source: 'webhook delivery', status: 'complete' },
  importState: 'complete',
  historyState: 'current',
};

const rowWithNewCheck = {
  pr: {
    id: 'pr-1',
    facts: {
      checks: [{ appId: '15368', name: 'lint', id: 'c1', execution: 1, status: 'completed' }],
    },
  },
  metrics: {},
};

beforeEach(() => {
  vi.resetAllMocks();
  deps.authorize.mockResolvedValue({ id: 'repo', owner: 'owner', name: 'repo', canAdmin: true });
  deps.policy.mockResolvedValue(policy);
  deps.record.mockResolvedValue(record);
  deps.prRows.mockResolvedValue([rowWithNewCheck]);
  deps.actEnabled.mockResolvedValue(false);
  deps.latest.mockResolvedValue({
    id: 'run-1',
    repositoryId: 'repo',
    state: 'complete',
    total: 42,
    completed: 42,
    failed: 0,
    message: null,
    createdAt: '2026-09-08T00:00:00.000Z',
    finishedAt: '2026-09-08T00:05:00.000Z',
  });
});

test('renders the required-gates form with its policy version', async () => {
  const html = renderToStaticMarkup(await call());
  expect(html).toContain('Required gates');
  expect(html).toContain('Policy v3');
  expect(html).toContain('unit (app 15368)');
  expect(html).toContain('playwright (app 15368)');
  expect(html).toContain('Save policy and recompute PRs');
});

test('offers a check observed on accessible PRs but not yet a gate as a candidate to add', async () => {
  const html = renderToStaticMarkup(await call());
  // 'lint' is on rowWithNewCheck's facts.checks but not in policy.gates — the
  // form must still offer it, unchecked, so an admin can promote it to a gate.
  const lintLabel = /<label><input[^>]*\/> lint \(app 15368\)<\/label>/.exec(html)?.[0];
  expect(lintLabel).toBeDefined();
  expect(lintLabel).not.toContain('checked');
});

test('renders RepositoryMetadata, unmodified, as the collection detail', async () => {
  const html = renderToStaticMarkup(await call());
  expect(html).toContain('Collection detail');
  expect(html).toContain('Review + CI detected');
  expect(html).toContain('Last successful fetch');
  expect(html).toContain('webhook delivery');
  expect(html).toContain('21 PRs');
  expect(html).toContain('Background history');
});

test('renders the collection state and the refresh control from the import record', async () => {
  const html = renderToStaticMarkup(await call());
  expect(html).toContain('Imported batch: 42 PRs.');
  expect(html).toContain('Refresh latest 100 PRs');
});

test('renders ImportProgress, which carries its own Retry affordance, while an import is incomplete', async () => {
  deps.latest.mockResolvedValue({
    id: 'run-2',
    repositoryId: 'repo',
    state: 'partial',
    total: 100,
    completed: 90,
    failed: 10,
    message: null,
    createdAt: '2026-09-08T00:00:00.000Z',
    finishedAt: '2026-09-08T00:05:00.000Z',
  });
  const html = renderToStaticMarkup(await call());
  // ImportProgress renders its own Retry form for a partial/failed run —
  // unlike the header's Refresh action, this branch is reachable here: this
  // route renders ImportProgress whenever the latest import isn't complete.
  expect(html).toContain('Retry failed PRs');
});

test('loads the gate policy, the collection record, the repository record, and the PR checks', async () => {
  await call();
  expect(deps.policy).toHaveBeenCalledWith('repo');
  expect(deps.latest).toHaveBeenCalledWith('repo');
  expect(deps.record).toHaveBeenCalledWith('repo');
  expect(deps.prRows).toHaveBeenCalledWith(['repo']);
  expect(deps.actEnabled).toHaveBeenCalledWith('repo');
});

test('renders only one h1 worth of identity — the view starts at h2', async () => {
  const html = renderToStaticMarkup(await call());
  expect(html).not.toContain('<h1');
  expect(html).toContain('<h2>Settings</h2>');
});
