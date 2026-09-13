import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRepository } from '../../../../workspaces/access';
import { getGrade, gradeHistory, gradeSummaries } from '../../../../db/queries/grade-runs';
import { AGENT_READINESS } from '../../../../domain/grading/graders/agent-readiness';
import { getGrader, graderCheckTitles } from '../../../../domain/grading/registry';
import { GradeCard } from '@fieldnote/design-system';
import { gradeCardProps } from '../../../../components/grading/grade-presentation';
import { GradeControls, GradeReport } from '../../../../components/grading/report';
import { pageRouteId } from '../../../../lib/page-route-id';
import { actEnabled } from '../../../../db/queries/act-settings';
import { fetchGrantedPermissions } from '../../../../github/installation-permissions';
import { actAvailability, nothingGranted } from '../../../../domain/act/availability';
import { availabilityMessage } from '../../../../domain/act/availability-copy';
import { latestPlan } from '../../../../db/queries/authoring-runs';
import { ActEntry } from '../../../../components/act/act-entry';
export const dynamic = 'force-dynamic';
export default async function Grading({
  params,
  searchParams,
}: {
  params: Promise<{ repoId: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  // The built-in is named here rather than assumed inside the queries, so the
  // single-grader assumption is visible. What this page shows when a
  // repository has four grades is slice 2's decision.
  const readinessGrader = getGrader(AGENT_READINESS);
  const checkTitles = graderCheckTitles(AGENT_READINESS);
  const repoId = pageRouteId((await params).repoId);
  const repo = await requireRepository(repoId);
  const { run } = await searchParams;
  const [summaries, history, selected, enabled, plan] = await Promise.all([
    gradeSummaries([repoId], AGENT_READINESS),
    gradeHistory(repoId, AGENT_READINESS),
    run ? getGrade(repoId, run, AGENT_READINESS) : Promise.resolve(null),
    actEnabled(repoId),
    latestPlan(repoId),
  ]);
  if (run && !selected) notFound();
  const summary = summaries[0];
  const grade = run ? selected : summary?.latest;
  const href = `/repos/${encodeURIComponent(repoId)}/grading`;
  // The installation lookup is a network round-trip, so it only runs once
  // the repository has opted in — a demo repository has no real
  // installation and must not 500 this page over a fetch nobody asked for.
  // actAvailability evaluates opt-in first, so skipping the fetch changes no
  // outcome, only whether the network is touched. This fetch depends on
  // `enabled`, so it cannot join the Promise.all above.
  const permissions = enabled
    ? await fetchGrantedPermissions(repoId).catch((error: unknown) => {
        console.error('Act availability check failed', error);
        return nothingGranted;
      })
    : nothingGranted;
  const availability = actAvailability({
    enabled,
    permissions,
    failingCheckCount: grade?.checks.filter((check) => check.status === 'fail').length ?? 0,
  });
  const message = availabilityMessage(availability);
  return (
    <div className="metrics-page">
      {/* Identity and the back-link live in the repository layout header; the
          tagline is demoted to h2 as this tab panel's own heading. */}
      <div className="eyebrow panel-eyebrow">Repository / Readiness</div>
      <h2>A record of readiness.</h2>
      <p className="page-intro">Understand the foundations your agents build on.</p>
      <GradeControls
        key={repoId}
        repositoryId={repoId}
        initial={summary?.status ?? null}
        canRun={!repo.isDemo}
      />
      {run && (
        <p>
          Viewing a saved report. <Link href={href}>View latest completed report</Link>
        </p>
      )}
      {/* A team that opted in should learn why Act cannot proceed; nobody
          else should be told about a switch that does nothing. */}
      {grade && enabled && message && <p className="muted">{message}</p>}
      {grade && (
        <ActEntry
          repositoryId={repoId}
          availability={availability}
          latest={plan ? { id: plan.id, state: plan.state } : null}
        />
      )}
      <div className="grading-layout">
        <div>
          {grade?.score !== null && grade?.score !== undefined ? (
            <GradeCard
              {...gradeCardProps({
                score: grade.score,
                repositoryName: `${repo.owner} / ${repo.name}`,
                sha: grade.sha,
                rubricVersion: grade.rubricVersion,
                checks: grade.checks,
                graderId: AGENT_READINESS,
              })}
            />
          ) : (
            <section className="grading-ungraded">
              <h2>Not graded yet.</h2>
              <p>
                A score appears only after all evidence is collected. Run the grader to create your
                first report.
              </p>
            </section>
          )}
          {history.length > 0 && (
            <details className="grading-history">
              <summary>Completed reports ({history.length})</summary>
              <ul>
                {history.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`${href}?run=${encodeURIComponent(item.id)}`}
                      aria-current={grade?.id === item.id ? 'page' : undefined}
                    >
                      {item.score} / 100 · {item.sha.slice(0, 7)} ·{' '}
                      {item.computedAt.toISOString().slice(0, 10)} · v{item.rubricVersion}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        {grade && (
          <GradeReport
            grade={grade}
            owner={repo.owner}
            name={repo.name}
            checkTitles={checkTitles}
            outdated={
              grade.rubricVersion !== readinessGrader.version ||
              grade.evaluatorVersion !== readinessGrader.evaluatorVersion
            }
          />
        )}
      </div>
    </div>
  );
}
