import { beforeEach, expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RangeSearch } from '../../../components/dashboard/range-query';

const deps = vi.hoisted(() => ({
  authorize: vi.fn(),
  grade: vi.fn(),
  detections: vi.fn(),
  cohorts: vi.fn(),
}));
vi.mock('../../../auth/access', () => ({ requireTrackedRepository: deps.authorize }));
vi.mock('../../../db/queries/grade-runs', () => ({ latestGrade: deps.grade }));
vi.mock('../../../db/queries/ai-involvement', () => ({ loadDetections: deps.detections }));
vi.mock('../../../db/queries/cohorts', () => ({ loadCohorts: deps.cohorts }));

import Repository from './page';

const call = (search: RangeSearch = {}) =>
  Repository({
    params: Promise.resolve({ repoId: 'repo' }),
    searchParams: Promise.resolve(search),
  });

const cohortTable = {
  rows: [
    {
      agent: 'codex',
      label: 'Codex',
      attributed: true,
      pullRequestCount: 6,
      firstPass: { value: 83.3, known: 5, unknown: 1 },
      averageAttempts: 1.2,
      clean: { value: 83.3, known: 5, unknown: 1 },
    },
    {
      agent: 'unattributed',
      label: 'Unattributed',
      attributed: false,
      pullRequestCount: 2,
      firstPass: { value: null, known: 0, unknown: 2 },
      averageAttempts: null,
      clean: { value: null, known: 0, unknown: 2 },
    },
  ],
  totalPullRequests: 8,
  attributedPullRequests: 6,
};

beforeEach(() => {
  vi.resetAllMocks();
  deps.authorize.mockResolvedValue({ id: 'repo', owner: 'owner', name: 'repo', canAdmin: false });
  deps.grade.mockResolvedValue({
    id: 'run',
    score: 80,
    sha: 'a'.repeat(40),
    rubricVersion: '0.1.0',
    evaluatorVersion: '1.0.0',
    computedAt: new Date('2026-09-08'),
    checks: [],
  });
  deps.detections.mockResolvedValue({ detections: [], state: null });
  deps.cohorts.mockResolvedValue(cohortTable);
});

test('renders the cohort comparison and an agent share derived from the same table', async () => {
  const html = renderToStaticMarkup(await call());
  expect(html).toContain('How each agent is doing');
  expect(html).toContain('Codex');
  expect(html).toContain('Agent share of work');
  // 6 attributed of 8 total, both read off cohortTable — never a separate count.
  expect(html).toContain('75%');
  expect(html).toContain('6 of 8 pull requests carry agent evidence');
});

test('loads the cohort aggregation scoped to the authorized repository and the parsed range', async () => {
  await call({ days: '30' });
  expect(deps.cohorts).toHaveBeenCalledWith('repo', expect.objectContaining({ days: 30 }));
  expect(deps.detections).toHaveBeenCalledWith('repo');
  expect(deps.grade).toHaveBeenCalledWith('repo', 'fieldnote/agent-readiness');
});

test('an invalid range renders the guard instead of querying anything, without a second h1', async () => {
  const html = renderToStaticMarkup(await call({ days: '5' }));
  expect(html).toContain('Invalid date range');
  expect(deps.cohorts).not.toHaveBeenCalled();
  expect(deps.detections).not.toHaveBeenCalled();
  expect(deps.grade).not.toHaveBeenCalled();
  // The layout already renders the page's one <h1>; this guard must render
  // at h2 here, unlike its other two callers (dashboard, /repos), which sit
  // at their own route root and keep the default h1.
  expect(html).not.toContain('<h1');
  expect(html).toContain('<h2>Invalid date range</h2>');
});

test('no completed grade run renders an ungraded placeholder instead of a score', async () => {
  deps.grade.mockResolvedValue(null);
  const html = renderToStaticMarkup(await call());
  expect(html).toContain('Not graded yet');
  expect(html).not.toContain('out of 100');
});

test('renders only one h1 worth of identity — the view starts at h2', async () => {
  const html = renderToStaticMarkup(await call());
  expect(html).not.toContain('<h1');
  expect(html).toContain('<h2>Is this repository working for agents?</h2>');
});

test('the Delivery link carries the parsed range forward, not just the raw search params', async () => {
  const html = renderToStaticMarkup(await call({ from: '2026-08-01', to: '2026-08-30' }));
  expect(html).toContain('href="/repos/repo/delivery?from=2026-08-01&amp;to=2026-08-30"');
});

test('escaped route id is decoded before authorization', async () => {
  await Repository({
    params: Promise.resolve({ repoId: 'repository%3A1360100266' }),
    searchParams: Promise.resolve({}),
  });
  expect(deps.authorize).toHaveBeenCalledWith('repository:1360100266');
});

test('malformed route id is rejected before any protected read', async () => {
  await expect(
    Repository({
      params: Promise.resolve({ repoId: 'repository%ZZ1' }),
      searchParams: Promise.resolve({}),
    }),
  ).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
  expect(deps.authorize).not.toHaveBeenCalled();
  expect(deps.grade).not.toHaveBeenCalled();
  expect(deps.detections).not.toHaveBeenCalled();
  expect(deps.cohorts).not.toHaveBeenCalled();
});

test('a double-escaped route id is decoded only once and still requires an exact access grant', async () => {
  deps.authorize.mockRejectedValue(new Error('not found'));
  await expect(
    Repository({
      params: Promise.resolve({ repoId: 'repository%253A1360100266' }),
      searchParams: Promise.resolve({}),
    }),
  ).rejects.toThrow('not found');
  expect(deps.authorize).toHaveBeenCalledWith('repository%3A1360100266');
  expect(deps.cohorts).not.toHaveBeenCalled();
  expect(deps.grade).not.toHaveBeenCalled();
  expect(deps.detections).not.toHaveBeenCalled();
});
