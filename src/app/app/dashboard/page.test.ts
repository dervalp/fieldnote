import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, test, vi } from 'vitest';
import { aggregatePeriod } from '../../../domain/dashboard/aggregate';
import { previousRange } from '../../../domain/dashboard/range';
const deps = vi.hoisted(() => ({ available: vi.fn(), load: vi.fn(), demo: false }));
vi.mock('../../../db/queries/dashboard', () => ({ prRows: async () => [] }));
vi.mock('../../../db/queries/repository-imports', () => ({ latestImport: async () => null }));
vi.mock('../../../auth/access', () => ({ accessibleRepositories: deps.available }));
vi.mock('../../../db/queries/basic-dashboard', () => ({ loadBasicDashboard: deps.load }));
vi.mock('../../../lib/env', () => ({ env: () => ({ DEMO_MODE: deps.demo ? 'true' : 'false' }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (href: string) => {
    throw new Error(href);
  },
}));
import Dashboard from './page';
beforeEach(() => {
  vi.clearAllMocks();
  deps.demo = false;
  deps.load.mockImplementation(async (_ids, range) => {
    const p = aggregatePeriod([], range);
    return {
      ...p,
      range,
      previousRange: previousRange(range),
      previousDays: [],
      previousTotals: p.totals,
      comparisons: {},
      previousCoverageReasons: [],
      previousUndatedCi: p.undatedCi,
      coverage: 'partial',
      timezone: 'UTC',
      visiblePrCount: 0,
      collectionBounds: { from: null, to: null, source: 'unknown' },
    };
  });
});
test('untracked installations redirect before metrics are fetched', async () => {
  deps.available.mockResolvedValue([{ id: 'untracked', trackingStartedAt: null }]);
  await expect(Dashboard()).rejects.toThrow('/onboarding');
  expect(deps.load).not.toHaveBeenCalled();
});
test('overview only loads authorized tracked IDs and retains range on repository navigation', async () => {
  deps.available.mockResolvedValue([
    { id: 'untracked', trackingStartedAt: null },
    { id: 'tracked', trackingStartedAt: new Date() },
  ]);
  const page = await Dashboard({ searchParams: Promise.resolve({ days: '30' }) });
  expect(deps.load).toHaveBeenCalledWith(['tracked'], expect.objectContaining({ days: 30 }));
  const html = renderToStaticMarkup(page);
  expect(html).toContain('href="/repos?days=30"');
  expect(html.match(/data-kpi=/g)).toHaveLength(3);
  expect(html).not.toContain('Demo fixtures');
});
test('explicit demo rows retain read access without onboarding', async () => {
  deps.demo = true;
  deps.available.mockResolvedValue([{ id: 'demo', trackingStartedAt: null, isDemo: true }]);
  await Dashboard();
  expect(deps.load).toHaveBeenCalledWith(['demo'], expect.objectContaining({ days: 7 }));
});
test('invalid ranges display validation and never reach the loader', async () => {
  deps.available.mockResolvedValue([{ id: 'tracked', trackingStartedAt: new Date() }]);
  const html = renderToStaticMarkup(
    await Dashboard({ searchParams: Promise.resolve({ from: '2026-09-08', to: '2026-08-01' }) }),
  );
  expect(html).toContain('Invalid date');
  expect(deps.load).not.toHaveBeenCalled();
});
