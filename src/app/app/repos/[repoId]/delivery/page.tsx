import Link from 'next/link';
import { requireTrackedRepository } from '../../../../../auth/access';
import { loadBasicDashboard } from '../../../../../db/queries/basic-dashboard';
import { currentPolicy, prRows } from '../../../../../db/queries/dashboard';
import { BasicDashboard, InvalidRange } from '../../../../../components/dashboard/basic-dashboard';
import {
  readRange,
  rangeQuery,
  type RangePageProps,
  type RangeSearch,
} from '../../../../../components/dashboard/range-query';
import { MetricCards } from '../../../../../components/metrics';
import { PrTable } from '../../../../../components/pr-table';
import { githubRepositoryUrl } from '../../../../../components/dashboard/repository-metadata';
import { failureBreakdown } from '../../../../../metrics/aggregate';
import { pageRouteId } from '../../../../../lib/page-route-id';

export const dynamic = 'force-dynamic';

type Projection = 'basic' | 'gate-policy';

function readProjection(search: RangeSearch): Projection {
  const value = Array.isArray(search.projection) ? search.projection[0] : search.projection;
  return value === 'gate-policy' ? 'gate-policy' : 'basic';
}

// Delivery is the KPI cards, the three daily charts, the date range, the
// pull-request table at full width (with the Agent column Task 2's
// per-pull-request attribution makes possible), the failure breakdown, and
// the gate-policy projection as a toggle on that same table — never a
// separate list. It loads loadBasicDashboard, prRows and currentPolicy.
// currentPolicy is a single-row indexed `limit 1` select (see
// db/queries/dashboard.ts), not the accessible-PR-history join
// repositoryRecords() runs — Delivery still never calls repositoryRecords.
// currentPolicy is needed because failureBreakdown(prs, policy) classifies
// each observed check as a gate or not by testing it against the *current*
// policy at render time; that is not something prMetrics.projection
// (already computed against whichever policy was active at last save)
// carries. MetricCards and the table's gate-policy columns need no policy
// query — they render prMetrics.projection as-is.
export default async function Delivery({
  params,
  searchParams,
}: { params: Promise<{ repoId: string }> } & RangePageProps) {
  const repoId = pageRouteId((await params).repoId),
    repo = await requireTrackedRepository(repoId);
  const search = (await searchParams) ?? {};
  let range;
  try {
    range = readRange(search);
  } catch (error) {
    return (
      <InvalidRange
        message={(error as Error).message}
        href={`/repos/${encodeURIComponent(repoId)}/delivery`}
        headingLevel="h2"
      />
    );
  }
  const [data, rows, policy] = await Promise.all([
    loadBasicDashboard([repo.id], range),
    prRows([repoId]),
    currentPolicy(repoId),
  ]);
  const failures = failureBreakdown(
    rows.map((r) => r.pr),
    policy,
  );
  const projection = readProjection(search);
  const basePath = `/repos/${encodeURIComponent(repoId)}/delivery`;
  const rangeQ = rangeQuery(range, search);
  const toggleHref = (view: Projection) => {
    const params = new URLSearchParams(rangeQ.slice(1));
    if (view === 'gate-policy') params.set('projection', 'gate-policy');
    else params.delete('projection');
    const q = params.toString();
    return q ? `${basePath}?${q}` : basePath;
  };
  return (
    <div className="metrics-page">
      <div className="eyebrow panel-eyebrow">Repository / Delivery</div>
      <h2>Delivery</h2>
      <p className="page-intro">
        Review, CI, and progress for this repository.{' '}
        <a href={githubRepositoryUrl(repo)}>GitHub ↗</a>
      </p>
      <BasicDashboard data={data} />
      <h2>Pull requests</h2>
      <p className="muted">
        {rows.length} accessible pull request{rows.length === 1 ? '' : 's'} with computed metrics.
        The date range above applies to the KPIs and charts, not this table.
      </p>
      <nav aria-label="Pull request projection" className="projection-toggle">
        <Link
          href={toggleHref('basic')}
          scroll={false}
          aria-current={projection === 'basic' ? 'true' : undefined}
        >
          Basic outcomes
        </Link>
        <Link
          href={toggleHref('gate-policy')}
          scroll={false}
          aria-current={projection === 'gate-policy' ? 'true' : undefined}
        >
          Gate-policy projection
        </Link>
      </nav>
      {/* The old page opened its "Advanced gate analysis" accordion with this
          sentence. The accordion is gone; the projection is not, so the
          sentence follows the projection here. It is the only place the product
          reconciles its two first-pass-green definitions — the cohort table on
          Agents and the KPI cards here can disagree — so it keeps both original
          claims (these use your configured gates; they do not define the
          headline metrics) and the policy version, which says which gates
          "configured" currently means. */}
      <p className="muted">
        Separate gate-policy projections · policy v{policy.version}. These metrics use your
        configured gates and do not define the KPI cards and charts above.
      </p>
      {projection === 'gate-policy' && rows.length > 0 && (
        <MetricCards metrics={rows.map((r) => r.metrics.projection)} />
      )}
      {rows.length > 0 ? (
        <PrTable rows={rows} githubUrl={githubRepositoryUrl(repo)} projection={projection} />
      ) : (
        <p>No accessible PR records imported yet.</p>
      )}
      <h2>Failures by check name</h2>
      {failures.length > 0 ? (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Gate</th>
                <th>Failures</th>
                <th>Affected PRs</th>
                <th>Failure rate</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((f) => (
                <tr key={`${f.appId}:${f.checkName}`}>
                  <td>
                    {f.checkName} <small>app {f.appId}</small>
                  </td>
                  <td>{f.failureCount}</td>
                  <td>{f.affectedPrCount}</td>
                  <td>
                    {(f.failureRate * 100).toFixed(1)}% / {f.total} executions
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No gate failures observed, or no gates are configured.</p>
      )}
    </div>
  );
}
