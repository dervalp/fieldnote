import { beforeEach, expect, test, vi } from 'vitest';

const { send, reconcile, select } = vi.hoisted(() => ({
  send: vi.fn(),
  reconcile: vi.fn().mockResolvedValue(['repository:1']),
  select: vi.fn(),
}));
vi.mock('../inngest/client', () => ({ inngest: { send } }));
vi.mock('./repositories', () => ({ reconcileInstallation: reconcile, repositoryClient: vi.fn() }));
vi.mock('./resolve-installation', () => ({ resolveWebhookInstallationId: async () => '123' }));
vi.mock('../db/queries/foreground-hydration', () => ({
  queueForegroundHydration: async (data: unknown) => data,
  markForegroundDispatched: async () => {},
}));
vi.mock('../db', () => ({ db: () => ({ select }) }));

import { handleGithubEvent } from './handle-event';

const base = {
  id: 'e',
  deliveryId: 'd',
  action: 'created',
  installationId: '123',
  repositoryId: null,
  payload: {},
  receivedAt: new Date(),
  processedAt: null,
  processingError: null,
  disposition: 'pending',
  dispatchedAt: null,
  leaseUntil: null,
} as const;

function query(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'where']) chain[method] = vi.fn(() => chain);
  Object.assign(chain, { then: promise.then.bind(promise) });
  return chain;
}

beforeEach(() => vi.clearAllMocks());

test('installation grants access without requesting analysis', async () => {
  await expect(handleGithubEvent({ ...base, eventName: 'installation' })).resolves.toBe(
    'processed',
  );
  expect(reconcile).toHaveBeenCalledWith('123');
  expect(send).not.toHaveBeenCalled();
});

test('pull request event for an untracked repository requests no hydration', async () => {
  select.mockReturnValue(
    query([{ id: 'repository:1', active: true, trackingStartedAt: null, githubRepositoryId: '1' }]),
  );
  await expect(
    handleGithubEvent({
      ...base,
      eventName: 'pull_request',
      repositoryId: '1',
      payload: { pull_request: { number: 7 } },
    }),
  ).resolves.toBe('unsupported');
  expect(send).not.toHaveBeenCalled();
});

test('pull request event for a revoked repository requests no hydration', async () => {
  select.mockReturnValue(
    query([
      {
        id: 'repository:1',
        active: false,
        trackingStartedAt: new Date(),
        githubRepositoryId: '1',
      },
    ]),
  );
  await expect(
    handleGithubEvent({
      ...base,
      eventName: 'pull_request',
      repositoryId: '1',
      payload: { pull_request: { number: 7 } },
    }),
  ).resolves.toBe('unsupported');
  expect(send).not.toHaveBeenCalled();
});

for (const eventName of ['pull_request_review', 'pull_request', 'pull_request_review_comment']) {
  test(`${eventName} review transition hydrates a tracked PR`, async () => {
    select.mockReturnValue(
      query([
        {
          id: 'repository:1',
          active: true,
          trackingStartedAt: new Date(),
          githubRepositoryId: '1',
        },
      ]),
    );
    await expect(
      handleGithubEvent({
        ...base,
        action: eventName === 'pull_request_review' ? 'dismissed' : 'review_requested',
        eventName,
        repositoryId: '1',
        payload: { pull_request: { number: 7 } },
      }),
    ).resolves.toBe('processed');
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ repositoryId: 'repository:1', number: 7 }),
      }),
    );
    expect(send.mock.calls.map(([event]) => event.name)).toEqual(['github/pr.sync.requested']);
  });
  test(`${eventName} review transition cannot hydrate an untracked PR`, async () => {
    select.mockReturnValue(
      query([
        { id: 'repository:1', active: true, trackingStartedAt: null, githubRepositoryId: '1' },
      ]),
    );
    await expect(
      handleGithubEvent({
        ...base,
        eventName,
        repositoryId: '1',
        payload: { pull_request: { number: 7 } },
      }),
    ).resolves.toBe('unsupported');
    expect(send).not.toHaveBeenCalled();
  });
}
