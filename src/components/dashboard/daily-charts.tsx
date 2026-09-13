'use client';
import { useId, useState } from 'react';
import { Surface } from '@fieldnote/design-system';
import type { Day } from '../../domain/dashboard/types';
type Metric = 'merged' | 'first-pass' | 'ci';
const names: Record<Metric, string> = {
  merged: 'PRs merged',
  'first-pass': 'First-pass green',
  ci: 'CI success rate',
};
function details(day: Day, metric: Metric) {
  const context = `${day.date} UTC · ${day.coverage} coverage. `;
  if (metric === 'merged')
    return (
      context +
      (day.mergedValue === null
        ? 'Gap: merged count coverage unknown; no observed merges.'
        : `${day.mergedValue} observed merged PRs.`)
    );
  if (metric === 'first-pass')
    return (
      context +
      (day.firstPass.value === null
        ? 'Gap: no eligible merged PRs.'
        : `${day.firstPass.value.toFixed(1)}% first-pass; ${day.firstPass.numerator} / ${day.firstPass.denominator} eligible merged PRs. Not first-pass ${day.prOutcomes['not-first-pass']}.`) +
      ` Excluded: ineligible ${day.prOutcomes.ineligible}, unknown ${day.prOutcomes.unknown}.`
    );
  const ci = day.ci,
    denominator = ci['first-pass'] + ci.recovered + ci.failed;
  return (
    context +
    (denominator
      ? `${((100 * (ci['first-pass'] + ci.recovered)) / denominator).toFixed(1)}% success; ${ci['first-pass'] + ci.recovered} / ${denominator} eligible workflow results. First attempt ${ci['first-pass']}, recovered ${ci.recovered}, failed ${ci.failed}.`
      : 'Gap: no eligible workflow results.') +
    ` Excluded: Pending ${ci.pending}, cancelled ${ci.cancelled}, skipped ${ci.skipped}, neutral ${ci.neutral}, unknown ${ci.unknown}.`
  );
}
function DayBar({ day, metric, max }: { day: Day; metric: Metric; max: number }) {
  if (metric === 'merged')
    return day.mergedValue === null ? (
      <span className="chart-gap" />
    ) : (
      <span className="count-bar" style={{ height: `${(100 * day.mergedValue) / max}%` }} />
    );
  const denominator =
    metric === 'first-pass'
      ? day.firstPass.denominator
      : day.ci['first-pass'] + day.ci.recovered + day.ci.failed;
  if (!denominator) return <span className="chart-gap" />;
  const segments =
    metric === 'first-pass'
      ? ([
          ['not-first-pass', denominator - day.firstPass.numerator],
          ['first-pass', day.firstPass.numerator],
        ] as const)
      : ([
          ['failed', day.ci.failed],
          ['recovered', day.ci.recovered],
          ['first-pass', day.ci['first-pass']],
        ] as const);
  return (
    <span className="percent-stack">
      {segments.map(([key, count]) => (
        <span key={key} data-segment={key} style={{ height: `${(100 * count) / denominator}%` }} />
      ))}
    </span>
  );
}
function Chart({ days, metric }: { days: Day[]; metric: Metric }) {
  const id = useId();
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, days.length - 1);
  const max = Math.max(1, ...days.map((d) => d.mergedValue ?? 0));
  const ticks = new Set(
    days.length <= 7
      ? days.map((_, i) => i)
      : [0, Math.floor((days.length - 1) / 2), days.length - 1],
  );
  return (
    <Surface className="daily-chart" aria-labelledby={`${id}-title`}>
      <div className="chart-heading">
        <h3 id={`${id}-title`}>{names[metric]}</h3>
        <p>
          {metric === 'merged' ? `Count · 0–${max} PRs` : 'Percent · 0–100%'} · {days.length} daily
          positions
        </p>
        {metric !== 'merged' && (
          <div className="chart-legend" aria-label={`${names[metric]} legend`}>
            <span>
              <i className="legend-green" />
              {metric === 'first-pass' ? 'First-pass green' : 'First attempt passed'}
            </span>
            {metric === 'ci' && (
              <span>
                <i className="legend-amber" />
                Passed after rerun
              </span>
            )}
            <span>
              <i className="legend-rust" />
              {metric === 'first-pass' ? 'Not first-pass' : 'Failed'}
            </span>
          </div>
        )}
      </div>
      <div className="chart-plot">
        <div className="chart-axis" aria-hidden="true">
          <span>{metric === 'merged' ? max : '100%'}</span>
          <span>0</span>
        </div>
        <div
          className="dated-columns"
          style={{
            gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
            // Keep all gaps below 25% of the plot even for a long custom range.
            columnGap: `min(2px, ${25 / Math.max(1, days.length)}%)`,
          }}
        >
          {days.map((day, i) => (
            <div className="dated-column" key={day.date}>
              <button
                type="button"
                className="day-position"
                data-metric={metric}
                data-date={day.date}
                aria-label={details(day, metric)}
                aria-describedby={`${id}-details`}
                aria-pressed={index === i}
                onFocus={() => setSelected(i)}
                onMouseEnter={() => setSelected(i)}
                onClick={() => setSelected(i)}
              >
                <DayBar day={day} metric={metric} max={max} />
              </button>
              <span
                className={`date-tick ${i === days.length - 1 ? 'last-tick' : ''}`}
                aria-hidden="true"
              >
                {ticks.has(i) ? day.date.slice(5) : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
      {days.length > 0 && (
        <div className="daily-detail">
          <label htmlFor={`${id}-date`}>Inspect day (UTC)</label>
          <select
            id={`${id}-date`}
            value={days[index].date}
            onChange={(event) => setSelected(days.findIndex((d) => d.date === event.target.value))}
          >
            {days.map((day) => (
              <option key={day.date} value={day.date}>
                {day.date}
              </option>
            ))}
          </select>
          <p id={`${id}-details`} aria-live="polite">
            {details(days[index], metric)}
          </p>
        </div>
      )}
      {metric === 'first-pass' && (
        <p className="chart-footnote">
          PR outcomes are frozen at merge. Not first-pass does not mean currently failed.
        </p>
      )}
      {metric === 'ci' && (
        <p className="chart-footnote">
          Workflow runs linked to visible PRs, as of the range end. Completed outcomes use
          completion dates; pending activity uses its start date. Excluded states do not fill the
          stack.
        </p>
      )}
    </Surface>
  );
}
export function DailyCharts({ days }: { days: Day[] }) {
  return (
    <div className="daily-charts">
      {(['merged', 'first-pass', 'ci'] as const).map((metric) => (
        <Chart key={metric} days={days} metric={metric} />
      ))}
    </div>
  );
}
