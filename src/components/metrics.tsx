import { Surface } from '@fieldnote/design-system';
import { aggregate } from '../metrics/aggregate';
import type { PrMetrics } from '../domain/pull-request/types';
export const yesNo = (value: boolean | null) => (value === null ? 'Unknown' : value ? 'Yes' : 'No');
export const duration = (seconds: number | null) =>
  seconds === null ? '—' : `${Math.round(seconds / 60)} min`;
export function MetricCards({ metrics }: { metrics: PrMetrics[] }) {
  const a = aggregate(metrics);
  const rates = [
    ['First-pass green', a.firstPass],
    ['Eventually green', a.eventually],
    ['Harness changed after failure', a.mutation],
    ['Clean Green', a.clean],
  ] as const;
  return (
    <div className="cards">
      {rates.map(([name, rate]) => (
        <Surface key={name}>
          <small>{name}</small>
          <strong>{rate.value === null ? '—' : `${rate.value.toFixed(1)}%`}</strong>
          <small>
            {rate.known} known · {rate.unknown} unknown
          </small>
        </Surface>
      ))}
      <Surface>
        <small>Average attempts to green</small>
        <strong>{a.averageAttempts?.toFixed(1) ?? '—'}</strong>
      </Surface>
      <Surface>
        <small>Median time to green</small>
        <strong>{duration(a.medianTime)}</strong>
      </Surface>
    </div>
  );
}
