import { beforeEach, expect, test, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  repositories: vi.fn(),
  visibleIds: vi.fn(),
  select: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('404');
  }),
}));

vi.mock('../../../../auth/access', () => ({
  accessibleRepositories: deps.repositories,
}));
vi.mock('../../../../db/queries/history-access', () => ({ visiblePrIds: deps.visibleIds }));
vi.mock('../../../../db/queries/dashboard', () => ({
  currentPolicy: async () => ({ version: 0, gates: [] }),
}));
vi.mock('../../../../db', () => ({ db: () => ({ select: deps.select }) }));
vi.mock('next/navigation', () => ({ notFound: deps.notFound }));

import Pr from './page';

function query(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'where']) chain[method] = vi.fn(() => chain);
  Object.assign(chain, { then: promise.then.bind(promise) });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  deps.repositories.mockResolvedValue([
    { id: 'repo', trackingStartedAt: new Date('2026-01-01T00:00:00.000Z') },
  ]);
  deps.visibleIds.mockResolvedValue([]);
  deps.select
    .mockReturnValueOnce(
      query([
        {
          id: 'pr:123',
          repositoryId: 'repo',
          facts: { checks: [], files: [], revisions: [], historyComplete: true, issues: [] },
          openedAt: new Date('2025-01-01T00:00:00.000Z'),
          mergedAt: null,
          closedAt: null,
        },
      ]),
    )
    .mockReturnValueOnce(
      query([
        {
          projection: {
            evidenceStatus: 'incomplete',
            gatePolicyVersion: 0,
            analyzerVersion: 'test',
            firstPassGreen: null,
            attemptsToGreen: null,
            cleanGreen: null,
            harnessChangedAfterFailure: null,
            timeToFirstGreenSeconds: null,
            evidenceReasons: [],
          },
        },
      ]),
    );
});

test('direct PR access rejects a stored record outside the visible history window', async () => {
  await expect(Pr({ params: Promise.resolve({ prId: 'hidden-pr' }) })).rejects.toThrow('404');
  expect(deps.visibleIds).toHaveBeenCalledWith(['repo']);
  expect(deps.select).not.toHaveBeenCalled();
});

test('escaped PR route ID resolves the same visible record without bypassing history access', async () => {
  deps.visibleIds.mockResolvedValue(['pr:123']);
  await expect(Pr({ params: Promise.resolve({ prId: 'pr%3A123' }) })).resolves.toBeDefined();
  expect(deps.visibleIds).toHaveBeenCalledWith(['repo']);
});
