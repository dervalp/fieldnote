import Link from 'next/link';
import type { RepositoryHeader } from '../../db/queries/repository-header';
import { repoSectionPath } from '../../lib/app-routes';
import { ImportProgress } from '../onboarding/import-progress';
import './coverage-strip.css';

// The product's claim is that missing evidence stays unknown rather than being
// guessed. This states that claim in one line, above every figure it qualifies.
// The six underlying collection timestamps are not here: they stay in
// RepositoryMetadata, for the case where someone is debugging collection
// rather than reading a metric.

function evidencePhrase(review: boolean, ci: boolean) {
  if (review && ci) return 'Review and CI both detected';
  if (review) return 'Review detected, no CI';
  if (ci) return 'CI detected, no review';
  return 'Neither review nor CI detected';
}

function fetchPhrase(fetched: { at: string; source: string } | null) {
  return fetched ? (
    <>
      last collected{' '}
      <time dateTime={fetched.at}>{fetched.at.slice(0, 16).replace('T', ' ')} UTC</time>
    </>
  ) : (
    'no completed collection recorded'
  );
}

function historyPhrase(historyState: string) {
  return historyState === 'complete'
    ? 'background history current'
    : `background history ${historyState.toLowerCase()}`;
}

export function CoverageStrip({
  repo,
  coverage,
  activeImport,
  latestImportState,
}: {
  repo: { id: string; owner: string; name: string; canAdmin: boolean };
  coverage: RepositoryHeader['coverage'];
  activeImport: RepositoryHeader['activeImport'];
  latestImportState: RepositoryHeader['latestImportState'];
}) {
  const brokenImport = latestImportState === 'failed' || latestImportState === 'partial';
  const complete = coverage.reviewDetected && coverage.ciDetected && !activeImport && !brokenImport;
  const status = activeImport
    ? 'Collection in progress'
    : brokenImport
      ? 'Collection incomplete'
      : complete
        ? 'Evidence complete'
        : coverage.reviewDetected || coverage.ciDetected
          ? 'Evidence partial'
          : 'No evidence detected';
  return (
    <div className="coverage">
      <span className={complete ? 'cov-dot' : 'cov-dot partial'} aria-hidden="true" />
      <b>{status}</b>
      <span className="cov-detail">
        {brokenImport ? <>Latest import {latestImportState} · </> : null}
        {evidencePhrase(coverage.reviewDetected, coverage.ciDetected)} ·{' '}
        {fetchPhrase(coverage.lastSuccessfulFetch)} · {historyPhrase(coverage.historyState)}
      </span>
      <Link className="cov-link" href={repoSectionPath(repo.id, 'settings')}>
        Collection detail →
      </Link>
      {/* An import in flight is the sharpest "do not trust these numbers yet"
          condition, so it has to keep counting. The layout never re-renders on
          navigation and refreshAnalysis revalidates no path, so a server-rendered
          counter would freeze. The existing polling component is reused verbatim
          and mounts only while an import is actually running. */}
      {activeImport && (
        <div className="cov-import">
          <ImportProgress
            key={activeImport.id}
            initial={activeImport}
            repository={repo}
            canAdmin={repo.canAdmin}
          />
        </div>
      )}
    </div>
  );
}
