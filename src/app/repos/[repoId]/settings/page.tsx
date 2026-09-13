import { Button, Surface } from '@fieldnote/design-system';
import { requireTrackedRepository } from '../../../../auth/access';
import { currentPolicy, prRows } from '../../../../db/queries/dashboard';
import { latestImport } from '../../../../db/queries/repository-imports';
import { repositoryRecord } from '../../../../db/queries/repository-header';
import { actEnabled } from '../../../../db/queries/act-settings';
import { ImportProgress } from '../../../../components/onboarding/import-progress';
import {
  githubRepositoryUrl,
  RepositoryMetadata,
} from '../../../../components/dashboard/repository-metadata';
import { saveGates, refreshImport, saveActEnabled } from '../actions';
import { gateKey } from '../../../../domain/pull-request/types';
import { pageRouteId } from '../../../../lib/page-route-id';

export const dynamic = 'force-dynamic';

// Settings is the required-gates form and its policy version, the import
// control (ImportProgress + the refresh form), the collection detail
// (RepositoryMetadata), and the gate-candidate discovery the form has always
// offered. It loads currentPolicy, latestImport, repositoryRecord, prRows
// and actEnabled:
//
// - currentPolicy + latestImport: the gate policy and the collection
//   record, as originally scoped.
// - repositoryRecord (src/db/queries/repository-header.ts): a
//   per-request-memoised single-repository lookup, NOT repositoryRecords()
//   directly. The layout calls the same cached function for the coverage
//   strip, so within one request this runs repositoryRecords()'s
//   accessible-PR-history join once, shared between the two callers,
//   instead of a second full join here.
// - prRows: NOT rendered as a table here (that's Delivery's). It exists
//   solely to derive the required-gates form's candidate list — every check
//   observed across accessible PRs, not just the checks already in the
//   policy — exactly as the old page did:
//   `[...policy.gates, ...rows.flatMap((r) => r.pr.facts.checks)]`. Without
//   it an admin could only toggle existing gates, never promote a
//   newly-seen check to one; do not "tidy this away" as an unused import.
export default async function Settings({ params }: { params: Promise<{ repoId: string }> }) {
  const repoId = pageRouteId((await params).repoId),
    repo = await requireTrackedRepository(repoId);
  const [policy, latest, record, rows, actOn] = await Promise.all([
    currentPolicy(repoId),
    latestImport(repoId),
    repositoryRecord(repoId),
    prRows([repoId]),
    actEnabled(repoId),
  ]);
  const candidates = [
    ...new Map(
      [...policy.gates, ...rows.flatMap((r) => r.pr.facts.checks)].map((g) => [
        gateKey(g),
        { appId: g.appId, name: g.name },
      ]),
    ).values(),
  ];
  return (
    <div className="metrics-page">
      <div className="eyebrow panel-eyebrow">Repository / Settings</div>
      <h2>Settings</h2>
      <p className="page-intro">
        Configuration is not analysis: gates and collection, in one place.
      </p>

      <h2>Required gates</h2>
      <p className="muted">Policy v{policy.version}</p>
      <p>
        {policy.gates.map((g) => `${g.name} (app ${g.appId})`).join(', ') ||
          'Not configured — outcomes remain unknown.'}
      </p>
      {repo.canAdmin && (
        <form action={saveGates.bind(null, repoId)}>
          {candidates.map((g) => (
            <label key={gateKey(g)}>
              <input
                type="checkbox"
                name="gate"
                value={JSON.stringify(g)}
                defaultChecked={policy.gates.some((p) => gateKey(p) === gateKey(g))}
              />{' '}
              {g.name} (app {g.appId})
            </label>
          ))}
          <Button>Save policy and recompute PRs</Button>
        </form>
      )}

      <h2>Pull requests</h2>
      <p className="muted">
        This records your opt-in for later. fieldnote cannot open pull requests yet — that workflow
        does not exist. When it does, it will need write access to contents and pull requests on the
        installation.
      </p>
      {repo.canAdmin ? (
        <form action={saveActEnabled.bind(null, repoId)}>
          <label>
            <input type="checkbox" name="actEnabled" defaultChecked={actOn} /> Open readiness pull
            requests for this repository
          </label>
          <Button>Save</Button>
        </form>
      ) : (
        <p>{actOn ? 'On.' : 'Off.'}</p>
      )}

      <h2>Collection detail</h2>
      <Surface>
        <RepositoryMetadata record={record} githubUrl={githubRepositoryUrl(repo)} />
      </Surface>

      <h2>Data</h2>
      {latest ? (
        <>
          <p className="muted">
            Initial import: latest 100 pull requests by creation date. New activity is updated as it
            arrives.
          </p>
          {latest.state === 'complete' ? (
            <p>{`Imported batch: ${latest.total ?? 'unknown'} PRs.`}</p>
          ) : (
            <ImportProgress
              key={latest.id}
              initial={latest}
              repository={repo}
              canAdmin={repo.canAdmin}
            />
          )}
        </>
      ) : (
        <p className="muted">Existing imported history</p>
      )}
      {repo.canAdmin && (!latest || latest.state === 'complete') && (
        <form action={refreshImport.bind(null, repoId)}>
          <Button>Refresh latest 100 PRs</Button>
        </form>
      )}
    </div>
  );
}
