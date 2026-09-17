import { beforeEach, expect, test, vi } from 'vitest';
const deps = vi.hoisted(() => ({
  readiness: vi.fn(),
  setup: vi.fn(),
  execute: vi.fn(),
  dispatch: vi.fn(),
  dispatchExecute: vi.fn(),
}));
vi.mock('../../db/queries/authoring-runs', () => ({ listUndispatchedPlans: deps.readiness }));
vi.mock('../../db/queries/fieldnote-setup', () => ({
  listUndispatchedSetupPlans: deps.setup,
  listUndispatchedSetupExecutes: deps.execute,
}));
vi.mock('../dispatch-authoring', () => ({
  dispatchAuthoringPlan: deps.dispatch,
  dispatchSetupExecute: deps.dispatchExecute,
}));
vi.mock('../client', () => ({
  inngest: { createFunction: (_options: unknown, handler: unknown) => handler },
}));
import { reconcileAuthoring } from './reconcile-authoring';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('DEMO_MODE', 'false');
  deps.execute.mockResolvedValue([]);
});
test('reconciliation recovers queued setup executes without sending them as plans', async () => {
  deps.readiness.mockResolvedValue([]);
  deps.setup.mockResolvedValue([]);
  deps.execute.mockResolvedValue(['execute']);
  const handler = reconcileAuthoring as unknown as (context: unknown) => Promise<unknown>;
  expect(
    await handler({ step: { run: (_name: string, work: () => Promise<unknown>) => work() } }),
  ).toEqual({ count: 1 });
  expect(deps.dispatchExecute).toHaveBeenCalledWith('execute');
  expect(deps.dispatch).not.toHaveBeenCalled();
});
test('reconciliation recovers queued setup plans even when another plan dispatch fails', async () => {
  deps.readiness.mockResolvedValue(['readiness']);
  deps.setup.mockResolvedValue(['setup']);
  deps.dispatch
    .mockRejectedValueOnce(new Error('temporary outage'))
    .mockResolvedValueOnce(undefined);
  const handler = reconcileAuthoring as unknown as (context: unknown) => Promise<unknown>;
  expect(
    await handler({ step: { run: (_name: string, work: () => Promise<unknown>) => work() } }),
  ).toEqual({ count: 2 });
  expect(deps.dispatch.mock.calls).toEqual([['readiness'], ['setup']]);
});
