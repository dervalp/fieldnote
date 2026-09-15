import 'dotenv/config';
import { db, closeDb } from '../src/db';
import {
  installations,
  repositories,
  gatePolicies,
  users,
  workspaces,
  gradeRuns,
} from '../src/db/schema';
import { persistPr } from '../src/db/queries/persist-pr';
import {
  demoFacts,
  demoGrade,
  demoDeliveryGrade,
  demoTestDisciplineGrade,
  demoGradeSha,
  demoPolicy,
} from '../src/demo/fixtures';
import { DEMO_WORKSPACE_ID } from '../src/demo/workspace';
import { agentReadinessManifest } from '../src/domain/grading/graders/agent-readiness';
import { deliveryHealthManifest } from '../src/domain/grading/graders/delivery-health';
import { testDisciplineManifest } from '../src/domain/grading/graders/test-discipline';
import { installBuiltIns } from '../src/db/queries/graders';
import { recomputeExecutedDetections } from '../src/db/queries/ai-involvement';
import type { AgentMarker } from '../src/domain/ai-involvement/types';
if (process.env.NODE_ENV === 'production' || process.env.DEMO_MODE !== 'true')
  throw new Error('Seed requires explicit local DEMO_MODE=true');
try {
  await db()
    .insert(installations)
    .values({
      id: 'demo-installation',
      githubInstallationId: 'demo',
      accountLogin: 'demo',
      accountType: 'Organization',
    })
    .onConflictDoNothing();
  await db()
    .insert(repositories)
    .values({
      id: 'demo-repository',
      installationId: 'demo-installation',
      githubRepositoryId: 'demo',
      owner: 'demo',
      name: 'checkout-service',
      defaultBranch: 'main',
      isPrivate: false,
      isDemo: true,
    })
    .onConflictDoNothing();
  await db()
    .insert(gatePolicies)
    .values({ repositoryId: 'demo-repository', ...demoPolicy })
    .onConflictDoNothing();
  // A grade is owned by whoever asked for it: grade_runs.requestedBy and
  // requestedWorkspaceId are both NOT NULL, so the demo needs an identity and a
  // workspace before it can hold a readiness card. Neither is reachable — no
  // session points at this user — and neither is on the read path either:
  // DEMO_MODE resolves the demo workspace and its repositories without touching
  // these tables, which is why workspace_repositories needs no row here for the
  // card to render.
  await db()
    .insert(users)
    .values({ id: 'demo-user', login: 'demo', displayName: 'Demo', credentials: 'demo-unused' })
    .onConflictDoNothing();
  await db()
    .insert(workspaces)
    .values({ id: DEMO_WORKSPACE_ID, name: 'Demo workspace' })
    .onConflictDoNothing();
  // Publishes the three built-ins into (graders, grader_versions) and installs
  // them into the demo workspace — the same seeding a real workspace gets from
  // ensureDefaultWorkspace(), done here because this workspace row is inserted
  // directly rather than through that path.
  await installBuiltIns(DEMO_WORKSPACE_ID);
  const graded = new Date('2026-09-30T09:12:00Z');
  await db()
    .insert(gradeRuns)
    .values({
      id: 'demo-grade-run',
      repositoryId: 'demo-repository',
      graderId: agentReadinessManifest.id,
      rubricVersion: agentReadinessManifest.version,
      evaluatorVersion: agentReadinessManifest.evaluatorVersion,
      requestedBy: 'demo-user',
      requestedWorkspaceId: DEMO_WORKSPACE_ID,
      state: 'complete',
      sha: demoGradeSha,
      result: demoGrade,
      dispatchedAt: graded,
      startedAt: graded,
      completedAt: graded,
    })
    .onConflictDoNothing();
  await db()
    .insert(gradeRuns)
    .values({
      id: 'demo-delivery-grade-run',
      repositoryId: 'demo-repository',
      graderId: deliveryHealthManifest.id,
      rubricVersion: deliveryHealthManifest.version,
      evaluatorVersion: deliveryHealthManifest.evaluatorVersion,
      requestedBy: 'demo-user',
      requestedWorkspaceId: DEMO_WORKSPACE_ID,
      state: 'complete',
      sha: demoGradeSha,
      result: demoDeliveryGrade,
      dispatchedAt: graded,
      startedAt: graded,
      completedAt: graded,
    })
    .onConflictDoNothing();
  await db()
    .insert(gradeRuns)
    .values({
      id: 'demo-test-discipline-grade-run',
      repositoryId: 'demo-repository',
      graderId: testDisciplineManifest.id,
      rubricVersion: testDisciplineManifest.version,
      evaluatorVersion: testDisciplineManifest.evaluatorVersion,
      requestedBy: 'demo-user',
      requestedWorkspaceId: DEMO_WORKSPACE_ID,
      state: 'complete',
      sha: demoGradeSha,
      result: demoTestDisciplineGrade,
      dispatchedAt: graded,
      startedAt: graded,
      completedAt: graded,
    })
    .onConflictDoNothing();
  // Every fourth pull request carries a different kind of agent evidence, so the
  // seeded demo exercises branch prefixes, commit trailers, pull-request bodies,
  // and the no-agent case. Claude Code appears through two signals on the same
  // pull requests, which is what makes occurrences a union rather than a sum.
  const agentEvidence = (index: number, sha: string) => {
    const slug = ['checkout-validation', 'payment-retry', 'inventory-race'][index % 3];
    if (index % 4 === 0) return { headRef: `codex/${slug}`, agentMarkers: [] as AgentMarker[] };
    if (index % 4 === 1)
      return {
        headRef: `claude/${slug}`,
        agentMarkers: [
          { agent: 'claude-code', source: 'commit-trailer', ref: sha },
          { agent: 'claude-code', source: 'pr-body', ref: 'body' },
        ] as AgentMarker[],
      };
    if (index % 4 === 2) return { headRef: `copilot/${slug}`, agentMarkers: [] as AgentMarker[] };
    return { headRef: `feature/${slug}`, agentMarkers: [] as AgentMarker[] };
  };
  for (let index = 0; index < 21; index++) {
    const facts = demoFacts(index);
    await persistPr({
      id: `demo-pr-${index + 1}`,
      repositoryId: 'demo-repository',
      githubPrId: `demo-${index + 1}`,
      githubPrNumber: index + 1,
      title: [
        'Add checkout validation',
        'Repair payment retry',
        'Handle inventory race',
        'Update checkout harness',
        'Investigate flaky checkout',
        'Pending CI execution',
        'Rerun unit gate',
      ][index % 7],
      state: facts.closedAt ? 'closed' : 'open',
      authorLogin: index % 2 ? 'alex' : 'sam',
      headSha: facts.revisions.at(-1)!.sha,
      baseSha: 'demo-base',
      openedAt: new Date(facts.openedAt),
      mergedAt: facts.mergedAt ? new Date(facts.mergedAt) : null,
      closedAt: facts.closedAt ? new Date(facts.closedAt) : null,
      sourceUpdatedAt: new Date('2026-09-30T00:00:00Z'),
      facts,
      ...agentEvidence(index, facts.revisions.at(-1)!.sha),
    });
  }
  // Production recomputes on import, backfill and webhook sync; the seed has none
  // of those, so it calls the same function directly.
  await recomputeExecutedDetections('demo-repository');
  console.log('Seeded 21 PRs. Demo signal: /app/prs/demo-pr-4');
  console.log('AI involvement: /app/repos/demo-repository/ai-involvement');
  console.log(`Readiness ${demoGrade.score}/100: /app/repos/demo-repository`);
  console.log(
    `Delivery ${demoDeliveryGrade.score}/100: /app/repos/demo-repository/grading?grader=fieldnote%2Fdelivery-health`,
  );
  console.log(
    `Test discipline ${demoTestDisciplineGrade.score}/100: /app/repos/demo-repository/grading?grader=fieldnote%2Ftest-discipline`,
  );
} finally {
  await closeDb();
}
