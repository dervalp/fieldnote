import { RetryAfterError } from 'inngest';
import { GithubCollectionRetryError } from '../../github/retry-errors';
import { inngest } from '../client';
import { prSyncData } from '../events';
import {
  finishForegroundHydration,
  runForegroundHydration,
} from '../../db/queries/foreground-hydration';
import { recomputeExecutedDetections } from '../../db/queries/ai-involvement';
import { findAuthoredPr } from '../../db/queries/authored-pr-monitor';
export const syncPullRequestFunction = inngest.createFunction(
  {
    id: 'sync-pull-request',
    triggers: [{ event: 'github/pr.sync.requested' }],
    retries: 5,
    onFailure: async ({ event, error }) => {
      const data = prSyncData.parse(event.data.event.data);
      const { repositoryId, number, sourceEventId } = data;
      await finishForegroundHydration(data, 'failed', event.data.run_id);
      console.error('Pull request synchronization failed', {
        repositoryId,
        pullRequestNumber: number,
        sourceEventId,
        error: error.message,
      });
    },
    concurrency: { limit: 1, key: 'event.data.repositoryId + ":" + event.data.number' },
  },
  async ({ event, step, runId }) => {
    const data = prSyncData.parse(event.data);
    const result = await step.run('hydrate-and-project-pr', async () => {
      try {
        return await runForegroundHydration(data, runId);
      } catch (error) {
        if (error instanceof GithubCollectionRetryError)
          throw new RetryAfterError(error.message, new Date(error.retryAt));
        throw error;
      }
    });
    await step.run('dispatch-authored-pr-monitor', async () => {
      if (typeof result !== 'string') return;
      const authored = await findAuthoredPr(data.repositoryId, data.number);
      if (authored)
        await inngest.send({
          name: 'repository/authored-pr.monitor.requested',
          data: { authoredPrId: authored.id },
        });
    });
    // Only the webhook path sets sourceEventId (see handle-event.ts); the import
    // path invokes this per pull request and must not repeat the whole-repository
    // aggregate once per item. Runs after hydration so it sees the fresh rows.
    // A recompute failure must not turn a healthy hydration into a failed one
    // (the hydrate step above is memoized, so a retry would only re-run this),
    // so it is swallowed here rather than left to the function's retries/onFailure.
    if (data.sourceEventId)
      await step.run('recompute-ai-involvement', async () => {
        try {
          await recomputeExecutedDetections(data.repositoryId);
        } catch (error) {
          console.error('AI involvement recompute failed', {
            repositoryId: data.repositoryId,
            error,
          });
        }
      });
    return result;
  },
);
