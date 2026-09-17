import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireRepository } from '../../../../../../workspaces/access';
import { getPlan } from '../../../../../../db/queries/authoring-runs';
import { PlanView } from '../../../../../../components/act/plan-view';
import { pageRouteId } from '../../../../../../lib/page-route-id';
import { repoSectionPath } from '../../../../../../lib/app-routes';
import { agentReadinessManifest } from '../../../../../../domain/grading/graders/agent-readiness';
import { getSetupPlan, getSetupSummary } from '../../../../../../db/queries/fieldnote-setup';
import { SetupConversation } from '../../../../../../components/act/setup-conversation';
import { FieldnoteSetupEntry } from '../../../../../../components/act/fieldnote-setup-entry';

export const dynamic = 'force-dynamic';

export default async function Plan({
  params,
}: {
  params: Promise<{ repoId: string; runId: string }>;
}) {
  const { repoId: rawRepoId, runId: rawRunId } = await params;
  const repoId = pageRouteId(rawRepoId);
  const runId = pageRouteId(rawRunId);
  const repo = await requireRepository(repoId);
  const setup = await getSetupPlan(repoId, runId);
  if (setup) {
    const summary = await getSetupSummary(repoId, null, runId);
    return (
      <div className="metrics-page">
        <div className="eyebrow panel-eyebrow">Repository / Act</div>
        <h2>
          Set up Fieldnote for {repo.owner} / {repo.name}.
        </h2>
        <p className="page-intro">
          Explore the repository, confirm how your team works, and prepare one setup pull request.
        </p>
        {summary.progress &&
          summary.progress.state !== 'exploring' &&
          summary.progress.state !== 'awaiting-input' && (
            <FieldnoteSetupEntry
              repositoryId={repoId}
              installation={summary.installation}
              progress={summary.progress}
              canStart={false}
              showStart={false}
            />
          )}
        <SetupConversation
          repositoryId={repoId}
          runId={runId}
          state={setup.run.state === 'failed' ? 'failed' : (setup.proposal?.state ?? 'exploring')}
          candidates={setup.proposal?.detectedAgents ?? []}
          notes={setup.notes.map(({ id, speaker, kind, body }) => ({ id, speaker, kind, body }))}
        />
        <p>
          <Link href={repoSectionPath(repoId, 'grading')}>Back to readiness</Link>
        </p>
      </div>
    );
  }
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
        checkTitles={Object.fromEntries(
          agentReadinessManifest.checks.map((check) => [check.id, check.title]),
        )}
      />
      <p>
        <Link href={repoSectionPath(repoId, 'grading')}>Back to readiness</Link>
      </p>
    </div>
  );
}
