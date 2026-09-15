import { loadBasicDashboard } from './basic-dashboard';
import { resolveRange } from '../../domain/dashboard/range';
import { INCOMPLETE } from '../../domain/grading/declarative';
import type { GraderManifest } from '../../domain/grading/manifest';
import type { MetricReading, MetricsWindow } from '../../domain/grading/types';

export type MetricsNeed = NonNullable<GraderManifest['needs']['fieldnote.metrics']>;

export type MetricsCollection =
  | { metrics: MetricsWindow; complete: true }
  | {
      metrics: MetricsWindow;
      complete: false;
      // Whose failure this was, and therefore which sentence a reader sees.
      // A failed run stores no result, so the error code is the only thing
      // that reaches them.
      incompleteReason: string;
      incompleteCode: 'incomplete_collection' | 'insufficient_evidence';
    };

const reading = (numerator: number, denominator: number): MetricReading => ({
  numerator,
  denominator,
  value: denominator ? (100 * numerator) / denominator : null,
});

/**
 * fieldnote.metrics, collected for one repository over one window.
 *
 * Trusted worker primitive. loadBasicDashboard() documents that its repository
 * ids must come from accessibleRepositories() or requireTrackedRepository() for
 * the current request; a grade run has no session and is authorized instead by
 * validateGradeRun(), which re-checks installation, workspace link, membership
 * and demo mode before collection and again before completion — the same route
 * collectFiles() already relies on. visiblePrIds() is a flat per-repository
 * history cap with no session component, so the Free limit applies identically.
 */
export async function collectMetrics(
  repositoryId: string,
  need: MetricsNeed,
  now = new Date(),
): Promise<MetricsCollection> {
  const range = resolveRange({ days: need.windowDays }, now);
  const data = await loadBasicDashboard([repositoryId], range);
  const { merged, firstPass, ciSuccess, ci } = data.totals;
  const metrics: MetricsWindow = {
    days: range.days,
    start: range.start,
    endExclusive: range.endExclusive,
    mergedPullRequests: merged,
    'first-pass-rate': reading(firstPass.numerator, firstPass.denominator),
    'ci-success-rate': reading(ciSuccess.numerator, ciSuccess.denominator),
    // Deliberately not MetricTotals.ciRecovered. That is recovered over every
    // completed run, which falls as a repository gets healthier and would score
    // a green repository badly. The check asks how many red runs came back, so
    // the denominator is only the red ones.
    'ci-recovery-rate': reading(ci.recovered, ci.recovered + ci.failed),
  };
  // Partial coverage is fieldnote's failure to collect, and fieldnote's
  // sentence. Too little merged work is the grader's floor, and the grader's.
  if (data.coverage !== 'complete')
    return {
      metrics,
      complete: false,
      incompleteReason: INCOMPLETE,
      incompleteCode: 'incomplete_collection',
    };
  if (merged < need.minMergedPullRequests)
    return {
      metrics,
      complete: false,
      incompleteReason: need.insufficientReason,
      incompleteCode: 'insufficient_evidence',
    };
  return { metrics, complete: true };
}
