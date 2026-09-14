import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { aggregatePeriod } from '../../domain/dashboard/aggregate';
import { previousRange, resolveRange } from '../../domain/dashboard/range';
import type { DashboardData } from '../../domain/dashboard/types';
import { DailyCharts } from './daily-charts';
import { BasicDashboard } from './basic-dashboard';
import { DateRange } from './date-range';
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/dashboard',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
const now = new Date('2026-09-08T12:00:00Z');
function data(days = 30): DashboardData {
  const range = resolveRange({ days }, now);
  const period = aggregatePeriod([], range);
  return {
    ...period,
    range,
    previousRange: previousRange(range),
    previousDays: [],
    previousTotals: period.totals,
    comparisons: { mergedPercent: null, firstPassPoints: null, ciSuccessPoints: null },
    previousCoverageReasons: [],
    previousUndatedCi: period.undatedCi,
    coverage: 'partial',
    timezone: 'UTC',
    visiblePrCount: 100,
    collectionBounds: { from: '2025-09-08', to: '2026-09-08', source: 'backfill-discovery' },
  };
}
test.each([7, 30, 90])(
  'renders every one of %i UTC positions for each metric with labelled gaps',
  (count) => {
    const html = renderToStaticMarkup(createElement(DailyCharts, { days: data(count).days }));
    for (const metric of ['merged', 'first-pass', 'ci']) {
      expect(html.match(new RegExp(`data-metric="${metric}"`, 'g'))).toHaveLength(count);
    }
    expect(html).toContain('2026-09-08');
    expect(html).toContain('Gap: no eligible merged PRs');
    expect(html).toContain('Gap: no eligible workflow results');
    expect(html).not.toContain('data-segment="failed"');
  },
);
test('eligible percent stacks retain recovered results and separate local PR meanings', () => {
  const day = data(7).days[0];
  day.firstPass = { value: 25, numerator: 1, denominator: 4, excluded: 2 };
  day.prOutcomes = { 'first-pass': 1, 'not-first-pass': 3, ineligible: 1, unknown: 1 };
  day.ci = { ...day.ci, 'first-pass': 1, recovered: 2, failed: 1, pending: 5 };
  const html = renderToStaticMarkup(createElement(DailyCharts, { days: [day] }));
  expect(html).toContain('data-segment="recovered" style="height:50%"');
  expect(html).toContain('data-segment="not-first-pass" style="height:75%"');
  expect(html).toContain('Not first-pass');
  expect(html).toContain('Pending 5');
  expect(html).toContain('0–100%');
});
test('three cards show raw denominators, unavailable comparisons, and undated diagnostics separately', () => {
  const d = data();
  d.totals.firstPass = { numerator: 3, denominator: 4, excluded: 2, value: 75 };
  d.totals.ciSuccess = { numerator: 3, denominator: 4, excluded: 5, value: 75 };
  d.totals.ciRecovered = { numerator: 2, denominator: 4, excluded: 5, value: 50 };
  d.undatedCi.unknown = 3;
  const html = renderToStaticMarkup(createElement(BasicDashboard, { data: d }));
  expect(html.match(/data-kpi=/g)).toHaveLength(3);
  expect(html).toContain('75.0%');
  expect(html).toContain('3 / 4 eligible merged PRs');
  expect(html).toContain('50.0% passed after reruns');
  expect(html).toContain('3 workflow runs without a defensible UTC date');
  expect(html).toContain('Comparison unavailable');
});
test('custom picker uses collection bounds; unknown horizon withholds custom dates but retains presets', () => {
  const d = data();
  const html = renderToStaticMarkup(
    createElement(DateRange, { range: d.range, bounds: d.collectionBounds }),
  );
  expect(html).toContain('min="2025-09-08"');
  expect(html).toContain('max="2026-09-08"');
  const advanced = renderToStaticMarkup(
    createElement(DateRange, {
      range: resolveRange({ days: 7 }, new Date('2026-09-15T12:00:00Z')),
      bounds: { ...d.collectionBounds, to: '2026-09-15' },
    }),
  );
  expect(advanced).toContain('max="2026-09-15"');
  expect(advanced).toContain('value="2026-09-09"');
  expect(advanced).toContain('value="2026-09-15"');
  const unknown = renderToStaticMarkup(
    createElement(DateRange, {
      range: d.range,
      bounds: { from: null, to: null, source: 'unknown' },
    }),
  );
  expect(unknown).not.toContain('type="date"');
  expect(unknown).toContain('Last 90 days');
  expect(unknown).toContain('Custom dates become available');
});
test('a full-year custom timeline budgets gaps within chart width and retains every inspectable date', () => {
  const range = resolveRange({ from: '2025-09-08', to: '2026-09-08' }, now);
  const days = aggregatePeriod([], range).days;
  const html = renderToStaticMarkup(createElement(DailyCharts, { days }));
  for (const metric of ['merged', 'first-pass', 'ci']) {
    expect(html.match(new RegExp(`data-metric="${metric}"`, 'g'))).toHaveLength(366);
  }
  expect(html.match(/<option /g)).toHaveLength(1098);
  // The emitted gap may be at most 2px, and all inter-day gaps together
  // must occupy less than a quarter of the available plot at any width.
  const gaps = [...html.matchAll(/column-gap:min\(2px,\s*([\d.]+)%\)/g)];
  expect(gaps).toHaveLength(3);
  for (const [, percent] of gaps) expect(Number(percent) * 365).toBeLessThan(25);
});

test('coverage offers a named, closed history dialog with explicit close and no premature success', () => {
  const html = renderToStaticMarkup(createElement(BasicDashboard, { data: data() }));
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toContain('<dialog');
  expect(html).toContain('aria-labelledby=');
  expect(html).toContain('aria-describedby=');
  expect(html).toContain('Close');
  expect(html).not.toContain('Your interest is registered');
});
