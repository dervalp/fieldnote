'use client';
import Link from 'next/link';
import { Button } from '@fieldnote/design-system';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { DashboardData, Range } from '../../domain/dashboard/types';
import { rangeEnd } from './range-query';
import { canonicalPathname } from '../../lib/navigation-path';

/**
 * Every param on the current URL other than the range params themselves —
 * days/from/to. Callers outside this route's own range controls (Delivery's
 * `?projection=`) ride along on every preset link and custom-range submit,
 * so switching the date range doesn't silently reset an unrelated toggle.
 */
function otherParams(searchParams: URLSearchParams): URLSearchParams {
  const kept = new URLSearchParams(searchParams);
  kept.delete('days');
  kept.delete('from');
  kept.delete('to');
  return kept;
}

/**
 * The custom-range form's submit target, factored out of the onSubmit
 * handler so it can be unit-tested directly: renderToStaticMarkup (this
 * codebase's whole rendering-test pattern) never fires interaction
 * handlers, so logic that only runs inside one has no regression guard
 * from a rendering test alone. `current` is the full current search —
 * `days` (if the range was previously a preset) is dropped along with any
 * previous `from`/`to`, replaced rather than duplicated, while every other
 * param (Delivery's `?projection=`) survives.
 */
export function customRangeHref(
  pathname: string,
  current: URLSearchParams,
  from: string,
  to: string,
): string {
  const params = otherParams(current);
  params.set('from', from);
  params.set('to', to);
  return `${pathname}?${params}`;
}

export function DateRange({
  range,
  bounds,
}: {
  range: Range;
  bounds: DashboardData['collectionBounds'];
}) {
  const pathname = canonicalPathname(usePathname());
  const router = useRouter();
  const kept = otherParams(useSearchParams());
  const start = range.start.slice(0, 10),
    end = rangeEnd(range);
  const known = bounds.from !== null && bounds.to !== null;
  return (
    <div className="metric-range">
      <p>
        <time>{start}</time> – <time>{end}</time> · UTC
        {end === new Date().toISOString().slice(0, 10) ? ' · Today is partial' : ''}
      </p>
      <nav aria-label="Date range" className="range-presets">
        {[7, 30, 90].map((days) => {
          const params = new URLSearchParams(kept);
          params.set('days', String(days));
          return (
            <Link
              key={days}
              href={`${pathname}?${params}`}
              scroll={false}
              aria-current={
                range.days === days && end === new Date().toISOString().slice(0, 10)
                  ? 'true'
                  : undefined
              }
            >
              Last {days} days
            </Link>
          );
        })}
      </nav>
      {known ? (
        <details className="custom-range">
          <summary>Custom dates</summary>
          <form
            key={`${start}:${end}:${bounds.from}:${bounds.to}`}
            action={pathname}
            method="get"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const values = new FormData(form);
              const from = String(values.get('from')),
                to = String(values.get('to'));
              const input = form.elements.namedItem('to') as HTMLInputElement;
              input.setCustomValidity(from > to ? 'End date must be on or after start date.' : '');
              if (form.reportValidity())
                router.push(customRangeHref(pathname, kept, from, to), { scroll: false });
            }}
          >
            <label>
              From (UTC)
              <input
                type="date"
                name="from"
                required
                min={bounds.from!}
                max={bounds.to!}
                defaultValue={
                  start < bounds.from! ? bounds.from! : start > bounds.to! ? bounds.to! : start
                }
                onChange={(e) => {
                  const to = e.currentTarget.form?.elements.namedItem(
                    'to',
                  ) as HTMLInputElement | null;
                  to?.setCustomValidity('');
                }}
              />
            </label>
            <label>
              To (UTC)
              <input
                type="date"
                name="to"
                required
                min={bounds.from!}
                max={bounds.to!}
                defaultValue={
                  end > bounds.to! ? bounds.to! : end < bounds.from! ? bounds.from! : end
                }
                onChange={(e) => e.currentTarget.setCustomValidity('')}
              />
            </label>
            <Button type="submit">Apply dates</Button>
          </form>
          <p className="muted">
            Collected horizon: {bounds.from} – {bounds.to}. Free visibility and incomplete evidence
            may still leave gaps.
          </p>
        </details>
      ) : (
        <p className="muted custom-unavailable">
          Custom dates become available when history discovery establishes the collected date range.
          Presets show the evidence available so far.
        </p>
      )}
    </div>
  );
}
