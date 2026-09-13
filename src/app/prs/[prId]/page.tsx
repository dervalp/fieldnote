import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { Surface } from '@fieldnote/design-system';
import { db } from '../../../db';
import { pullRequests, prMetrics } from '../../../db/schema';
import { accessibleRepositories } from '../../../auth/access';
import { currentPolicy } from '../../../db/queries/dashboard';
import { visiblePrIds } from '../../../db/queries/history-access';
import { analyzePullRequest } from '../../../domain/pull-request/analyzer';
import { yesNo, duration } from '../../../components/metrics';
import { pageRouteId } from '../../../lib/page-route-id';
export const dynamic = 'force-dynamic';
export default async function Pr({ params }: { params: Promise<{ prId: string }> }) {
  const prId = pageRouteId((await params).prId);
  const repositories = (await accessibleRepositories()).filter(
    (repo) =>
      repo.trackingStartedAt !== null || (process.env.NODE_ENV === 'development' && repo.isDemo),
  );
  const visibleIds = await visiblePrIds(repositories.map((repository) => repository.id));
  if (!visibleIds.includes(prId)) notFound();

  const [pr] = await db().select().from(pullRequests).where(eq(pullRequests.id, prId));
  if (!pr) notFound();
  const repo = repositories.find((repository) => repository.id === pr.repositoryId);
  if (!repo) notFound();
  const [row] = await db().select().from(prMetrics).where(eq(prMetrics.pullRequestId, pr.id));
  const policy = await currentPolicy(repo.id),
    analysis = analyzePullRequest(pr.facts, policy),
    m = row?.projection ?? analysis.metrics;
  return (
    <>
      <Link href={`/repos/${encodeURIComponent(repo.id)}`}>
        {repo.owner}/{repo.name}
      </Link>
      <h1>
        #{pr.githubPrNumber} {pr.title}
      </h1>
      <p>
        {m.evidenceStatus} evidence · Gate policy v{m.gatePolicyVersion} · Analyzer{' '}
        {m.analyzerVersion}
      </p>
      <div className="cards">
        {[
          ['First Pass Green', yesNo(m.firstPassGreen)],
          ['Attempts to Green', m.attemptsToGreen ?? '—'],
          ['Clean Green', yesNo(m.cleanGreen)],
          ['Harness Mutation', yesNo(m.harnessChangedAfterFailure)],
          ['Time to Green', duration(m.timeToFirstGreenSeconds)],
        ].map(([name, value]) => (
          <Surface key={name}>
            <small>{name}</small>
            <strong>{value}</strong>
          </Surface>
        ))}
      </div>
      {m.harnessChangedAfterFailure && <p className="notice">Harness modified after failed CI.</p>}
      {m.evidenceReasons.map((reason) => (
        <p key={reason}>{reason}</p>
      ))}
      <h2>PR timeline</h2>
      <p>PR opened · {pr.openedAt.toISOString()}</p>
      {[...pr.facts.revisions]
        .sort(
          (a, b) =>
            (a.observedAt ?? '9999').localeCompare(b.observedAt ?? '9999') ||
            a.sha.localeCompare(b.sha),
        )
        .map((revision, i) => (
          <Surface key={`${revision.sha}:${i}`} className="timeline">
            <h3>SHA {revision.sha.slice(0, 12)}</h3>
            <small>
              {revision.observedAt ?? 'Revision ordering unavailable'} ·{' '}
              {revision.diffComplete ? 'Compared revision' : 'Diff evidence incomplete'}
            </small>
            {revision.files.length > 0 && (
              <>
                <h4>Changed files</h4>
                <ul>
                  {revision.files.map((f) => (
                    <li key={f.path}>
                      {f.previousPath ? `${f.previousPath} → ` : ''}
                      {f.path} (+{f.additions}/−{f.deletions})
                    </li>
                  ))}
                </ul>
              </>
            )}
            <table>
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Execution</th>
                  <th>Result</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {pr.facts.checks
                  .filter((c) => c.sha === revision.sha)
                  .sort(
                    (a, b) =>
                      (a.queuedAt ?? '').localeCompare(b.queuedAt ?? '') ||
                      a.id.localeCompare(b.id),
                  )
                  .map((c) => (
                    <tr key={`${c.id}:${c.execution}`}>
                      <td>{c.name}</td>
                      <td>{c.execution}</td>
                      <td>{c.conclusion?.toUpperCase() ?? c.status}</td>
                      <td>{c.completedAt ?? '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Surface>
        ))}
      {pr.mergedAt ? (
        <p>PR merged · {pr.mergedAt.toISOString()}</p>
      ) : pr.closedAt ? (
        <p>PR closed · {pr.closedAt.toISOString()}</p>
      ) : (
        <p>PR remains open</p>
      )}
    </>
  );
}
