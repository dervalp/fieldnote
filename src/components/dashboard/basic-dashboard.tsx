import { Surface } from '@fieldnote/design-system';
import type { CoverageReason, DashboardData } from '../../domain/dashboard/types';
import { DailyCharts } from './daily-charts';
import { DateRange } from './date-range';
import { HistoryInterest } from './history-interest';
const coverageLabels: Record<CoverageReason, string> = {
  'import-incomplete': 'Initial import is still incomplete.',
  'history-undiscovered': 'Background history discovery is incomplete.',
  'outside-collected-history': 'Some selected dates fall outside established collection coverage.',
  'free-history-limit':
    'Older collected PRs fall outside your latest 100 per repository and are excluded.',
  'evidence-incomplete': 'Some review, revision, or CI history is incomplete.',
  'unknown-workflow-date': 'Some workflow results cannot be assigned a defensible date.',
  'no-repositories': 'No accessible tracked repositories are available.',
  'current-day': 'Today is partial; more activity may arrive.',
};
const percent = (value: number | null) => (value == null ? '—' : `${value.toFixed(1)}%`);
function delta(value: number | null, unit: string) {
  return value == null
    ? 'Comparison unavailable'
    : `${value > 0 ? '+' : ''}${value.toFixed(1)}${unit} vs previous period`;
}
export function BasicDashboard({ data }: { data: DashboardData }) {
  const { totals, comparisons } = data;
  const undated = Object.values(data.undatedCi).reduce((a, b) => a + b, 0);
  return (
    <>
      <DateRange range={data.range} bounds={data.collectionBounds} />
      <div className="basic-kpis">
        <Surface data-kpi="merged">
          <h2>PRs merged</h2>
          <strong>{totals.merged || data.coverage === 'complete' ? totals.merged : '—'}</strong>
          <p>{delta(comparisons.mergedPercent, '%')}</p>
          <small>
            {totals.merged} observed merges within accessible history
            {data.coverage !== 'complete' ? ' · incomplete coverage' : ''}
          </small>
        </Surface>
        <Surface data-kpi="first-pass">
          <h2>First-pass green</h2>
          <strong>{percent(totals.firstPass.value)}</strong>
          <p>{delta(comparisons.firstPassPoints, ' percentage points')}</p>
          <small>
            {totals.firstPass.numerator} / {totals.firstPass.denominator} eligible merged PRs ·{' '}
            {totals.firstPass.excluded} excluded
          </small>
          <small>
            Ineligible {totals.prOutcomes.ineligible} · Unknown {totals.prOutcomes.unknown}
          </small>
        </Surface>
        <Surface data-kpi="ci">
          <h2>CI success rate</h2>
          <strong>{percent(totals.ciSuccess.value)}</strong>
          <p>{delta(comparisons.ciSuccessPoints, ' percentage points')}</p>
          <small>
            {totals.ciSuccess.numerator} / {totals.ciSuccess.denominator} eligible workflow runs ·{' '}
            {totals.ciSuccess.excluded} excluded
          </small>
          <small>
            {percent(totals.ciRecovered.value)} passed after reruns ({totals.ciRecovered.numerator}{' '}
            runs)
          </small>
        </Surface>
      </div>
      <div className="metric-coverage">
        <div>
          <strong>Free · Latest 100 PRs per repository</strong>
          <p>
            {data.visiblePrCount} accessible PRs · {data.coverage} coverage
          </p>
        </div>
        <HistoryInterest />
        {data.coverageReasons.length > 0 && (
          <ul>
            {data.coverageReasons.map((reason) => (
              <li key={reason}>{coverageLabels[reason]}</li>
            ))}
          </ul>
        )}
        <p>
          Rates exclude unknown and ineligible outcomes. Gaps mean no eligible denominator or
          incomplete count coverage; they do not mean failure. Comparisons require comparable
          evidence in both equal-length periods.
        </p>
        {data.previousCoverageReasons.length > 0 && (
          <details>
            <summary>Previous period coverage</summary>
            <ul>
              {data.previousCoverageReasons.map((reason) => (
                <li key={reason}>{coverageLabels[reason]}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <p className="metric-exclusions">
        Excluded dated CI states: Pending {totals.ci.pending} · Cancelled {totals.ci.cancelled} ·
        Skipped {totals.ci.skipped} · Neutral {totals.ci.neutral} · Unknown {totals.ci.unknown}.
      </p>
      {undated > 0 && (
        <p className="metric-advisory">
          {undated} workflow runs without a defensible UTC date are excluded from charts and KPI
          totals:{' '}
          {Object.entries(data.undatedCi)
            .filter(([, count]) => count > 0)
            .map(([outcome, count]) => `${outcome} ${count}`)
            .join(' · ')}
          . These are undated diagnostics, not results assigned to this period.
        </p>
      )}
      <h2>Progress, day by day.</h2>
      <p className="muted">
        {data.range.days} UTC calendar days. Select a bar or inspect a date for values and
        denominators.
      </p>
      <DailyCharts days={data.days} />
    </>
  );
}
export function InvalidRange({
  message,
  href,
  headingLevel: Heading = 'h1',
}: {
  message: string;
  href: string;
  /** Defaults to h1: correct for the two route-root callers (dashboard, repos
   * directory). A view nested under a layout that already renders its own h1
   * — the Agents view under the repository layout — must pass 'h2' so this
   * error state never produces a second h1 on the page. */
  headingLevel?: 'h1' | 'h2';
}) {
  return (
    <div className="metrics-page">
      <Heading>Invalid date range</Heading>
      <p role="alert">{message}</p>
      <a href={href}>Return to Last 7 days</a>
    </div>
  );
}
