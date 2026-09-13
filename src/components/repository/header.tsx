import { Button } from '@fieldnote/design-system';
import { refreshImport } from '../../app/repos/[repoId]/actions';
import { githubRepositoryUrl } from '../dashboard/repository-metadata';
import { canRefreshImport } from '../../domain/import/progress';
import type { RepositoryHeader } from '../../db/queries/repository-header';
import { CoverageStrip } from './coverage-strip';
import './header.css';

// Server component. Everything here is true regardless of which view is open,
// which is why it lives in the layout rather than in any one page. The date
// range is deliberately absent: layouts do not rerender on navigation and so
// cannot read search params, and the range applies only to Delivery and Agents.

export type HeaderRepository = {
  id: string;
  owner: string;
  name: string;
  defaultBranch: string;
  isPrivate: boolean;
  canAdmin: boolean;
};

export function RepositoryPageHeader({
  repo,
  header,
}: {
  repo: HeaderRepository;
  header: RepositoryHeader;
}) {
  return (
    <>
      <header className="rhead">
        <div className="rhead-top">
          <div className="rhead-id">
            <h1>
              <span className="owner">{repo.owner}/</span>
              {repo.name}
            </h1>
            <p className="facts">
              <span>{repo.isPrivate ? 'Private' : 'Public'}</span>
              <span className="sep" aria-hidden="true">
                ·
              </span>
              <span>default branch {repo.defaultBranch}</span>
              <span className="sep" aria-hidden="true">
                ·
              </span>
              <span>{header.record.accessiblePrCount} pull requests accessible</span>
              <span className="sep" aria-hidden="true">
                ·
              </span>
              <span>Free plan</span>
            </p>
          </div>
          <div className="rhead-actions">
            <Button as="a" variant="secondary" href={githubRepositoryUrl(repo)}>
              GitHub ↗
            </Button>
            {/* Exact parity with the gate this header replaced: never over an
                in-flight, failed or partial run, because Refresh inserts a new
                run and only the latest run may be retried. */}
            {repo.canAdmin && canRefreshImport(header.latestImportState) && (
              <form action={refreshImport.bind(null, repo.id)}>
                <Button>Refresh data</Button>
              </form>
            )}
          </div>
        </div>
        <CoverageStrip
          repo={repo}
          coverage={header.coverage}
          activeImport={header.activeImport}
          latestImportState={header.latestImportState}
        />
      </header>
    </>
  );
}
