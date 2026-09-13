import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireRepository } from '../../../../../workspaces/access';
import { getPlan } from '../../../../../db/queries/authoring-runs';
import { PlanView } from '../../../../../components/act/plan-view';
import { pageRouteId } from '../../../../../lib/page-route-id';
import { AGENT_READINESS } from '../../../../../domain/grading/graders/agent-readiness';
import { graderCheckTitles } from '../../../../../domain/grading/registry';

export const dynamic = 'force-dynamic';

export default async function Plan({
  params,
}: {
  params: Promise<{ repoId: string; runId: string }>;
}) {
  const { repoId: rawRepoId, runId } = await params;
  const repoId = pageRouteId(rawRepoId);
  const repo = await requireRepository(repoId);
  const plan = await getPlan(repoId, runId);
  if (!plan) notFound();
  return (
    <div className="metrics-page">
      <div className="eyebrow panel-eyebrow">Repository / Act</div>
      <h2>What fieldnote proposes.</h2>
      <p className="page-intro">
        One change per failing readiness check for {repo.owner} / {repo.name}.
      </p>
      <PlanView
        run={plan.run}
        remedies={plan.remedies}
        checkTitles={graderCheckTitles(AGENT_READINESS)}
      />
      <p>
        <Link href={`/repos/${encodeURIComponent(repoId)}/grading`}>Back to readiness</Link>
      </p>
    </div>
  );
}
