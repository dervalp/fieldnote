import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Surface, GradeCard } from '@fieldnote/design-system';
import { requireRepository, requireWorkspace } from '../../../../../workspaces/access';
import { getGrade, gradeHistory, gradeSummaries } from '../../../../../db/queries/grade-runs';
import { publicGradeSettings } from '../../../../../db/queries/public-grade-settings';
import { ShareToggle } from '../../../../../components/grading/share-toggle';
// Importing the barrel (not just agent-readiness) registers every built-in
// grader as a side effect, the way registry.ts's own docstring on
// listGraders() asks a caller to. This is the one page that needs the full
// roster; every other caller still names the one grader it means.
import { AGENT_READINESS } from '../../../../../domain/grading/graders';
import { getGrader, graderCheckTitles, listGraders } from '../../../../../domain/grading/registry';
import { ManifestError } from '../../../../../domain/grading/manifest';
import { gradeCardProps } from '../../../../../components/grading/grade-presentation';
import { GradeControls } from '../../../../../components/grading/report';
import { GradeReport } from '../../../../../components/grading/report-view';
import { pageRouteId } from '../../../../../lib/page-route-id';
import { publicBadgePath, publicGradePath, repoSectionPath } from '../../../../../lib/app-routes';
import { actEnabled } from '../../../../../db/queries/act-settings';
import { fetchGrantedPermissions } from '../../../../../github/installation-permissions';
import { actAvailability, nothingGranted } from '../../../../../domain/act/availability';
import { availabilityMessage } from '../../../../../domain/act/availability-copy';
import { latestPlan } from '../../../../../db/queries/authoring-runs';
import { ActEntry } from '../../../../../components/act/act-entry';
import { gradeSchedules } from '../../../../../db/queries/grade-schedules';
import { ScheduleToggle } from '../../../../../components/grading/schedule-toggle';
export const dynamic = 'force-dynamic';

// A row of cards, one per registered grader, whether or not it has ever run —
// so a second grader advertises itself before anyone has used it. `?grader=`
// selects which card's report and history render beneath the row, defaulting
// to the built-in readiness grader; an id nothing registers is a 404 rather
// than a silent fallback to the default. There is no primary grader and no
// composite score: the graders answer different questions, and a mean of
// "can an agent work here" and "does work reach green cleanly" is a number
// about nothing.
export default async function Grading({
  params,
  searchParams,
}: {
  params: Promise<{ repoId: string }>;
  searchParams: Promise<{ run?: string; grader?: string }>;
}) {
  const repoId = pageRouteId((await params).repoId);
  const repo = await requireRepository(repoId);
  const { run, grader } = await searchParams;
  const graders = listGraders();
  let selectedGrader;
  try {
    selectedGrader = getGrader(grader ?? AGENT_READINESS);
  } catch (error) {
    if (error instanceof ManifestError) notFound();
    throw error;
  }
  const checkTitles = graderCheckTitles(selectedGrader.id);
  // The one place the /app prefix is spelled is repoSectionPath; the grader
  // selection rides on the query string it already carries.
  const gradingHref = (query = '') => repoSectionPath(repoId, 'grading', query);
  const hrefFor = (graderId: string) =>
    graderId === AGENT_READINESS
      ? gradingHref()
      : gradingHref(`?${new URLSearchParams({ grader: graderId })}`);
  const historyHref = (graderId: string, runId: string) => {
    const query = new URLSearchParams();
    if (graderId !== AGENT_READINESS) query.set('grader', graderId);
    query.set('run', runId);
    return gradingHref(`?${query}`);
  };
  const [summaries, history, historical, enabled, plan, schedules, sharing, workspace] =
    await Promise.all([
      gradeSummaries(
        [repoId],
        graders.map((entry) => entry.id),
      ),
      gradeHistory(repoId, selectedGrader.id),
      run ? getGrade(repoId, run, selectedGrader.id) : Promise.resolve(null),
      actEnabled(repoId),
      latestPlan(repoId),
      gradeSchedules(repoId),
      publicGradeSettings(repoId),
      requireWorkspace(),
    ]);
  if (run && !historical) notFound();
  const summaryFor = (graderId: string) => summaries.find((entry) => entry.graderId === graderId);
  const summary = summaryFor(selectedGrader.id);
  const isReadiness = selectedGrader.id === AGENT_READINESS;
  // An unscored current run outranks an older completed one: it is the
  // repository's current state, not a step backward in its history. The
  // scored report nobody threw away is still one click away, in the history
  // list below. A pinned `?run=` still wins over both.
  const grade = run ? historical : (summary?.unscored ?? summary?.latest ?? null);
  const href = hrefFor(selectedGrader.id);
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
    // Named from the readiness grader's own summary, never from whichever
    // card is on screen: switching cards, or viewing a historical readiness
    // run, must not change what Act says. Nothing an agent writes into a
    // repository raises a first-pass rate.
    failingCheckCount:
      summaryFor(AGENT_READINESS)?.latest?.checks.filter((check) => check.status === 'fail')
        .length ?? 0,
  });
  const message = availabilityMessage(availability);
  return (
    <div className="metrics-page">
      {/* Identity and the back-link live in the repository layout header; the
          tagline is demoted to h2 as this tab panel's own heading. */}
      <div className="eyebrow panel-eyebrow">Repository / Grades</div>
      <h2>Every grader&rsquo;s read on this repository.</h2>
      <p className="page-intro">Select a card to see that grader&rsquo;s evidence and history.</p>
      <div className="grade-row">
        {graders.map((entry) => {
          const isSelected = entry.id === selectedGrader.id;
          // The selected card tracks whatever is on screen, including a
          // historical `?run=` selection; every other card shows its own
          // latest, since `?run=` only ever names a run of the selected
          // grader.
          const entryGrade = isSelected
            ? grade
            : (summaryFor(entry.id)?.unscored ?? summaryFor(entry.id)?.latest ?? null);
          return (
            <div
              key={entry.id}
              className="grade-row-item"
              aria-current={isSelected ? 'true' : undefined}
            >
              <Link href={hrefFor(entry.id)} className="grade-row-link">
                {entryGrade?.score !== null && entryGrade?.score !== undefined ? (
                  <GradeCard
                    {...gradeCardProps({
                      score: entryGrade.score,
                      repositoryName: `${repo.owner} / ${repo.name}`,
                      sha: entryGrade.sha,
                      rubricVersion: entryGrade.rubricVersion,
                      checks: entryGrade.checks,
                      graderId: entry.id,
                    })}
                  />
                ) : (
                  <Surface className="grading-ungraded">
                    <h2>{entry.card.title}</h2>
                    <p>{entry.card.tagline}</p>
                    <p>
                      {entryGrade
                        ? entryGrade.incompleteReason
                          ? `Not scored. ${entryGrade.incompleteReason}`
                          : 'Not scored.'
                        : 'Not graded yet. A score appears only after all evidence is collected. Run the grader to create the first report.'}
                    </p>
                  </Surface>
                )}
              </Link>
            </div>
          );
        })}
      </div>
      <GradeControls
        key={`${repoId}:${selectedGrader.id}`}
        repositoryId={repoId}
        graderId={selectedGrader.id}
        initial={summary?.status ?? null}
        canRun={!repo.isDemo}
      />
      <ScheduleToggle
        repositoryId={repoId}
        graderId={selectedGrader.id}
        schedule={schedules[selectedGrader.id] ?? null}
        canRun={!repo.isDemo}
      />
      <ShareToggle
        repositoryId={repoId}
        graderId={selectedGrader.id}
        graderTitle={selectedGrader.card.title}
        shared={sharing[selectedGrader.id]?.shared ?? false}
        canShare={workspace.role === 'owner' && !repo.isDemo}
        isPrivate={repo.isPrivate}
        pagePath={publicGradePath(repo.owner, repo.name, selectedGrader.id)}
        badgePath={publicBadgePath(repo.owner, repo.name, selectedGrader.id)}
        // A README needs an absolute URL. APP_URL is absent in demo mode, where
        // sharing is refused anyway, so an empty base is never pasted anywhere.
        baseUrl={process.env.APP_URL ?? ''}
      />
      {run && (
        <p>
          Viewing a saved report. <Link href={href}>View latest completed report</Link>
        </p>
      )}
      {/* A team that opted in should learn why Act cannot proceed; nobody
          else should be told about a switch that does nothing. Act names
          only the readiness grader, so neither this line nor the entry below
          it belongs under any other card. These two gates follow the
          completed grade, not whatever the card is showing: an unscored
          current run has no bearing on failingCheckCount below, which is
          sourced only from the readiness grader's own completed summary. */}
      {isReadiness && summary?.latest && enabled && message && <p className="muted">{message}</p>}
      {isReadiness && summary?.latest && (
        <ActEntry
          repositoryId={repoId}
          availability={availability}
          latest={plan ? { id: plan.id, state: plan.state } : null}
        />
      )}
      <div className="grading-layout">
        <div>
          {history.length > 0 && (
            <details className="grading-history">
              <summary>Completed reports ({history.length})</summary>
              <ul>
                {history.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={historyHref(selectedGrader.id, item.id)}
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
            graderTitle={selectedGrader.card.title}
            disclaimer={selectedGrader.disclaimer}
            outdated={
              grade.rubricVersion !== selectedGrader.version ||
              grade.evaluatorVersion !== selectedGrader.evaluatorVersion
            }
          />
        )}
      </div>
    </div>
  );
}
