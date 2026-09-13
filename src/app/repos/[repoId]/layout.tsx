import { requireTrackedRepository } from '../../../auth/access';
import { RepositoryPageHeader } from '../../../components/repository/header';
import { TabBar } from '../../../components/repository/tab-bar';
import { TAB_PANEL_ID } from '../../../components/repository/tabs';
import { composeRepositoryHeader, repositoryRecord } from '../../../db/queries/repository-header';
import { latestImport } from '../../../db/queries/repository-imports';
import { pageRouteId } from '../../../lib/page-route-id';
import { AppShell } from '../../../components/app-shell';
export const dynamic = 'force-dynamic';
// The layout renders on every tab, so it loads only what every tab shows: the
// repository record and the coverage facts. Anything a single view needs —
// the dashboard aggregation, the PR records, the gate policy, the cohorts —
// belongs in that view's own page.tsx. The date range is not here at all:
// layouts do not rerender on navigation and cannot read search params.
//
// Calls repositoryRecord (not repositoryRecords) so that when Settings also
// needs a RepositoryRecord (for RepositoryMetadata), React's per-request
// cache() gives the two calls one execution of the underlying
// accessible-PR-history join, not two.
export default async function RepositoryLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ repoId: string }>;
}) {
  const repoId = pageRouteId((await params).repoId),
    repo = await requireTrackedRepository(repoId);
  const [record, latest] = await Promise.all([repositoryRecord(repo.id), latestImport(repo.id)]);
  const header = composeRepositoryHeader(record, latest);
  return (
    <AppShell crumbs={[{ label: 'All repositories', href: '/repos' }, { label: repo.name }]}>
      <div className="repo-layout">
        <RepositoryPageHeader repo={repo} header={header} />
        {/* The preview's Readiness and Involvement counts are not rendered:
            neither is available from the header load, and adding a query the
            other three tabs never read is exactly the split this layout exists
            to avoid. Re-add them the day a count is cheap here. */}
        <TabBar repoId={repoId} />
        <div className="repo-panel" id={TAB_PANEL_ID} role="tabpanel">
          {children}
        </div>
      </div>
    </AppShell>
  );
}
