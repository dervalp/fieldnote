import { beforeEach, expect, test, vi } from 'vitest';
import { RetryAfterError } from 'inngest';
import { GithubCollectionRetryError } from '../../github/retry-errors';
const mocks = vi.hoisted(() => ({
  createFunction: vi.fn((config, handler) => ({ config, handler })),
  runForegroundHydration: vi.fn(),
  finishForegroundHydration: vi.fn(),
  recomputeExecutedDetections: vi.fn(),
  findAuthoredPr: vi.fn(),
  send: vi.fn(),
}));
vi.mock('../client', () => ({
  inngest: { createFunction: mocks.createFunction, send: mocks.send },
}));
vi.mock('../../db/queries/authored-pr-monitor', () => ({ findAuthoredPr: mocks.findAuthoredPr }));
vi.mock('../../db/queries/foreground-hydration', () => mocks);
vi.mock('../../db/queries/ai-involvement', () => mocks);
import './sync-pull-request';
const { handler, config } = mocks.createFunction.mock.results[0].value;
const data = { repositoryId: 'repo', number: 1, hydrationId: 'work', sourceEventId: 'source' };
const step = { run: async (_name: string, fn: () => unknown) => fn() };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.findAuthoredPr.mockResolvedValue(null);
});
test('authored monitor dispatch follows persisted hydration and uses hydrated repository and number', async () => {
  const order: string[] = [];
  mocks.runForegroundHydration.mockImplementationOnce(async () => {
    order.push('hydrated');
    return 'hydrated-id';
  });
  mocks.findAuthoredPr.mockImplementationOnce(async (repositoryId, number) => {
    expect([repositoryId, number]).toEqual(['repo', 1]);
    order.push('lookup');
    return { id: 'authored' };
  });
  mocks.send.mockImplementationOnce(async () => {
    order.push('monitor');
  });
  await handler({ event: { data }, runId: 'execution', step });
  expect(order).toEqual(['hydrated', 'lookup', 'monitor']);
  expect(mocks.send).toHaveBeenCalledWith({
    name: 'repository/authored-pr.monitor.requested',
    data: { authoredPrId: 'authored' },
  });
});
test('an unclaimed or previously failed hydration cannot dispatch authored monitoring', async () => {
  mocks.runForegroundHydration.mockResolvedValueOnce(undefined);
  mocks.findAuthoredPr.mockResolvedValueOnce({ id: 'authored' });
  await handler({ event: { data }, runId: 'execution', step });
  expect(mocks.send).not.toHaveBeenCalled();
});
test('foreground worker forwards a stable execution identity and honors sanitized retry deadlines', async () => {
  const error = new GithubCollectionRetryError([
    { status: 403, errorCategory: 'rate-limit', retryAt: '2026-09-20T00:00:00.000Z' },
  ]);
  mocks.runForegroundHydration.mockRejectedValueOnce(error);
  const result = handler({ event: { data }, runId: 'execution', step });
  await expect(result).rejects.toBeInstanceOf(RetryAfterError);
  await expect(result).rejects.toMatchObject({ retryAfter: '2026-09-20T00:00:00.000Z' });
  expect(mocks.runForegroundHydration).toHaveBeenCalledWith(data, 'execution');
  expect(mocks.recomputeExecutedDetections).not.toHaveBeenCalled();
});
test('exhausted failure closes only its own lifecycle execution', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await config.onFailure({
    event: { data: { event: { data }, run_id: 'failed-execution' } },
    error: new Error('failed'),
  });
  expect(mocks.finishForegroundHydration).toHaveBeenCalledWith(data, 'failed', 'failed-execution');
  log.mockRestore();
});
test('a webhook-driven sync recomputes ai involvement after hydration', async () => {
  await handler({ event: { data }, runId: 'execution', step });
  expect(mocks.recomputeExecutedDetections).toHaveBeenCalledWith('repo');
});
test('the import path (no sourceEventId) never recomputes per pull request', async () => {
  const importData = { repositoryId: 'repo', number: 1 };
  await handler({ event: { data: importData }, runId: 'execution', step });
  expect(mocks.recomputeExecutedDetections).not.toHaveBeenCalled();
});
test('a recompute failure does not fail an otherwise healthy hydration', async () => {
  // The hydrate step is memoized; a retry would only re-run this aggregate, so
  // its failure must never mark a successful hydration as failed.
  mocks.runForegroundHydration.mockResolvedValueOnce('hydrated-id');
  mocks.recomputeExecutedDetections.mockRejectedValueOnce(new Error('boom'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await expect(handler({ event: { data }, runId: 'execution', step })).resolves.toBe('hydrated-id');
  expect(mocks.finishForegroundHydration).not.toHaveBeenCalled();
  log.mockRestore();
});
