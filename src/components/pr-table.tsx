import Link from 'next/link';
import type { prRows } from '../db/queries/dashboard';
import { yesNo, duration } from './metrics';
import { catalogue } from '../domain/ai-involvement/catalogue';
import { UNATTRIBUTED } from '../domain/ai-involvement/attribute';
import { prPath } from '../lib/app-routes';

/**
 * Same labelling rules as the cohort table (db/queries/cohorts.ts labelFor):
 * the catalogue label for an attributed agent, exactly "Unattributed" for
 * UNATTRIBUTED ('unknown') — never "Human" and never implied to be human —
 * and the raw agent id as a fallback for an id no longer in the catalogue.
 * Kept as its own copy rather than importing labelFor out of cohorts.ts: it
 * is three lines, and cohort-comparison.tsx/metrics.tsx already duplicate
 * their own small formatting helpers rather than share across these
 * presentational modules.
 */
function agentLabel(agent: string): string {
  if (agent === UNATTRIBUTED) return 'Unattributed';
  return catalogue.find((entry) => entry.agent === agent)?.label ?? agent;
}

/**
 * One pull-request table, full width, with two projections of the same
 * rows toggled by the caller (Delivery) rather than rendered as a separate
 * list: "basic" is the recent-activity view the old page rendered inline
 * (status, source activity, GitHub link); "gate-policy" is the metrics this
 * component used to render alone, computed against the current gate policy
 * at write time (prMetrics.projection), not recomputed here.
 */
export function PrTable({
  rows,
  githubUrl,
  projection,
}: {
  rows: Awaited<ReturnType<typeof prRows>>;
  githubUrl: string;
  projection: 'basic' | 'gate-policy';
}) {
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Pull request</th>
            <th>Agent</th>
            <th>Status</th>
            {projection === 'gate-policy' ? (
              <>
                <th>First pass</th>
                <th>Attempts</th>
                <th>Clean green</th>
                <th>Harness mutation</th>
                <th>Time to green</th>
              </>
            ) : (
              <>
                <th>Source activity (UTC)</th>
                <th>GitHub</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ pr, metrics: m }) => (
            <tr key={pr.id}>
              <td>
                <Link href={prPath(pr.id)}>
                  #{pr.githubPrNumber} {pr.title}
                </Link>
              </td>
              <td>{agentLabel(pr.agentProvider)}</td>
              <td>{pr.mergedAt ? 'Merged' : pr.state}</td>
              {projection === 'gate-policy' ? (
                <>
                  <td>{yesNo(m.firstPassGreen)}</td>
                  <td>
                    {m.attemptsToGreen ?? '—'} <small>({m.ciAttemptCount} total)</small>
                  </td>
                  <td>{yesNo(m.cleanGreen)}</td>
                  <td>{yesNo(m.harnessChangedAfterFailure)}</td>
                  <td>{duration(m.timeToFirstGreenSeconds)}</td>
                </>
              ) : (
                <>
                  <td>
                    <time dateTime={pr.sourceUpdatedAt.toISOString()}>
                      {pr.sourceUpdatedAt.toISOString().slice(0, 16).replace('T', ' ')}
                    </time>
                  </td>
                  <td>
                    <a href={`${githubUrl}/pull/${pr.githubPrNumber}`}>View PR ↗</a>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
