import {
  queueForegroundHydration,
  markForegroundDispatched,
} from '../db/queries/foreground-hydration';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { repositories, pullRequests } from '../db/schema';
import type { StoredEvent } from '../inngest/process-event';
import { inngest } from '../inngest/client';
import { reconcileInstallation, repositoryClient } from './repositories';
import { githubApp } from './app';
import { resolveWebhookInstallationId } from './resolve-installation';
const relatedSchema = z.object({
  head_sha: z.string(),
  pull_requests: z.array(z.object({ number: z.number() })).optional(),
});
export async function handleGithubEvent(event: StoredEvent): Promise<'processed' | 'unsupported'> {
  if (event.eventName === 'ping') return 'processed';
  const installationId = await resolveWebhookInstallationId(event, async ({ owner, repo }) => {
    const { data } = await githubApp().octokit.rest.apps.getRepoInstallation({ owner, repo });
    return data.id;
  });
  if (!installationId) return 'unsupported';
  if (['installation', 'installation_repositories'].includes(event.eventName)) {
    await reconcileInstallation(installationId);
    return 'processed';
  }
  if (
    ![
      'pull_request',
      'pull_request_review',
      'pull_request_review_comment',
      'check_run',
      'check_suite',
      'workflow_run',
    ].includes(event.eventName) ||
    !event.repositoryId
  )
    return 'unsupported';
  let [repo] = await db()
    .select()
    .from(repositories)
    .where(eq(repositories.githubRepositoryId, event.repositoryId));
  if (!repo) {
    await reconcileInstallation(installationId);
    [repo] = await db()
      .select()
      .from(repositories)
      .where(eq(repositories.githubRepositoryId, event.repositoryId));
  }
  if (!repo || !repo.active || !repo.trackingStartedAt) return 'unsupported';
  const numbers = new Set<number>();
  if (
    ['pull_request', 'pull_request_review', 'pull_request_review_comment'].includes(event.eventName)
  )
    numbers.add(
      z.object({ number: z.number().int().positive() }).parse(event.payload.pull_request).number,
    );
  else {
    const entity = relatedSchema.parse(event.payload[event.eventName]);
    for (const pr of entity.pull_requests ?? []) numbers.add(pr.number);
    const known = await db()
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.repositoryId, repo.id));
    for (const pr of known)
      if (pr.facts.revisions.some((r) => r.sha === entity.head_sha)) numbers.add(pr.githubPrNumber);
    if (!numbers.size) {
      const { client } = await repositoryClient(repo.id);
      const associated = await client.paginate(
        client.rest.repos.listPullRequestsAssociatedWithCommit,
        { owner: repo.owner, repo: repo.name, commit_sha: entity.head_sha, per_page: 100 },
      );
      for (const pr of associated) numbers.add(pr.number);
    }
  }
  for (const number of numbers) {
    // Authored-PR monitoring is dispatched by sync-pull-request only after
    // hydration persists. This handler consumes an already persisted raw event.
    const data = await queueForegroundHydration({
      repositoryId: repo.id,
      number,
      sourceEventId: event.id,
    });
    await inngest.send({
      id: `${event.deliveryId}:pr:${number}`,
      name: 'github/pr.sync.requested',
      data,
    });
    await markForegroundDispatched(data.hydrationId);
  }
  return numbers.size ? 'processed' : 'unsupported';
}
