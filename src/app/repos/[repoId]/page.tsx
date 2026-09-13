import Link from 'next/link';
import { requireTrackedRepository } from '../../../auth/access';
import { latestGrade } from '../../../db/queries/grade-runs';
import { AGENT_READINESS } from '../../../domain/grading/graders/agent-readiness';
import { loadDetections } from '../../../db/queries/ai-involvement';
import { loadCohorts } from '../../../db/queries/cohorts';
import { GradeCard, GradeBanner } from '@fieldnote/design-system';
import {
  gradeBannerProps,
  gradeCardProps,
} from '../../../components/grading/grade-presentation';
import { AgentsInvolved } from '../../../components/agents/agents-involved';
import { AgentShare } from '../../../components/agents/agent-share';
import { CohortComparison } from '../../../components/cohorts/cohort-comparison';
import { InvalidRange } from '../../../components/dashboard/basic-dashboard';
import {
  readRange,
  rangeEnd,
  rangeQuery,
  type RangePageProps,
} from '../../../components/dashboard/range-query';
import { pageRouteId } from '../../../lib/page-route-id';

export const dynamic = 'force-dynamic';

// This is the view the product exists to produce: whether the repository is
// a place agents can work (the readiness card), which agents actually work
// there (the agents-involved card), and how well each performs (agent share
// and the cohort comparison). It loads exactly the latest grade run, the
// detections and the cohort aggregation — nothing that belongs to Delivery
// (the dashboard aggregation, the pull-request records) or Settings (the
// gate policy, the import record). The repository identity, breadcrumb,
// facts line, actions and coverage strip are all rendered once by the
// layout, so this view never renders a second <h1>; its own heading starts
// at <h2>.
export default async function Repository({
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
        href={`/repos/${encodeURIComponent(repoId)}`}
        headingLevel="h2"
      />
    );
  }
  const [grade, involvement, table] = await Promise.all([
    latestGrade(repo.id, AGENT_READINESS),
    loadDetections(repo.id),
    loadCohorts(repo.id, range),
  ]);
  const query = rangeQuery(range, search);
  return (
    <div className="metrics-page">
      <div className="eyebrow panel-eyebrow">Repository / Agents</div>
      <h2>Is this repository working for agents?</h2>
      <p className="page-intro">
        {range.days} UTC days ending {rangeEnd(range)}. The full KPI history for this same range,
        and the pull-request table across all accessible history, are on{' '}
        <Link href={`/repos/${encodeURIComponent(repoId)}/delivery${query}`}>Delivery</Link>.
      </p>
      <div className="agents-view">
        {grade?.score !== null && grade?.score !== undefined ? (
          (() => {
            // Resolved once and shared. The banner derives its tier from the
            // card's props rather than from the score a second time, so the
            // two cannot disagree about what this score means.
            const card = gradeCardProps({
              score: grade.score,
              repositoryName: `${repo.owner} / ${repo.name}`,
              sha: grade.sha,
              rubricVersion: grade.rubricVersion,
              checks: grade.checks,
              graderId: AGENT_READINESS,
            });
            return (
              <>
                {/* Both render; src/app/style.css shows exactly one per
                    viewport width — the full card above phone width, the
                    banner below it. See the .agents-view rules there. */}
                <GradeCard {...card} />
                <GradeBanner {...gradeBannerProps(card)} />
              </>
            );
          })()
        ) : (
          <section className="grading-ungraded">
            <h2>Not graded yet.</h2>
            <p>
              A score appears only after all evidence is collected. Run the grader from{' '}
              <Link href={`/repos/${encodeURIComponent(repoId)}/grading`}>Readiness</Link>.
            </p>
          </section>
        )}
        <div className="agents-col">
          <AgentsInvolved
            detections={involvement.detections}
            state={involvement.state}
            repoId={repoId}
          />
          <AgentShare attributed={table.attributedPullRequests} total={table.totalPullRequests} />
          <CohortComparison table={table} />
        </div>
      </div>
    </div>
  );
}
