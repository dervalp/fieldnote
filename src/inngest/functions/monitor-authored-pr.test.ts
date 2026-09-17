import { beforeEach, expect, test, vi } from 'vitest';
import { SetupWriteError } from '../../github/write-authored-pr';
const deps = vi.hoisted(() => ({
  load: vi.fn(),
  observe: vi.fn(),
  reserve: vi.fn(),
  repair: vi.fn(),
  finish: vi.fn(),
  outcome: vi.fn(),
  human: vi.fn(),
  send: vi.fn(),
  configs: [] as Array<{ onFailure?: (input: unknown) => Promise<unknown> }>,
}));
vi.mock('../client', () => ({
  inngest: {
    createFunction: (config: unknown, handler: unknown) => {
      deps.configs.push(config as never);
      return handler;
    },
    send: deps.send,
  },
}));
vi.mock('../../db/queries/authored-pr-monitor', () => ({
  loadAuthoredPrMonitor: deps.load,
  reservePrRepair: deps.reserve,
  finishPrRepair: deps.finish,
  recordPrOutcome: deps.outcome,
  recordMonitorHumanRequired: deps.human,
}));
vi.mock('../../github/monitor-authored-pr', () => ({
  observeAuthoredPr: deps.observe,
  repairAuthoredPr: deps.repair,
}));
import { monitorAuthoredPrFunction, repairAuthoredPrFunction } from './monitor-authored-pr';
const handler = monitorAuthoredPrFunction as unknown as (input: unknown) => Promise<unknown>;
const repairHandler = () =>
  repairAuthoredPrFunction as unknown as (input: unknown) => Promise<unknown>;
const pr = { id: 'pr', repositoryId: 'repo', number: 42, headSha: 'a'.repeat(40), outcome: 'open' };
const trigger = {
  kind: 'ci',
  reference: 'check:1',
  disposition: 'actionable',
  path: '.fieldnote/profile.md',
  instruction: 'format',
};
const snapshot = {
  outcome: 'open',
  headSha: pr.headSha,
  failures: [trigger],
  reviews: [],
  pending: false,
};
const durable: unknown[] = [];
const context = {
  event: { data: { authoredPrId: 'pr' } },
  step: {
    run: async (_name: string, work: () => Promise<unknown>) => {
      const result = await work();
      durable.push(result);
      return result;
    },
    sendEvent: deps.send,
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  durable.length = 0;
  deps.load.mockResolvedValue({ pr, repairs: [] });
  deps.observe.mockResolvedValue(snapshot);
  deps.reserve.mockResolvedValue({
    id: 'repair',
    ordinal: 1,
    state: 'queued',
    baseHeadSha: pr.headSha,
  });
  deps.repair.mockResolvedValue({ headSha: 'b'.repeat(40) });
  deps.send.mockImplementation(async (_name: string, event: { name: string; data: unknown }) => {
    if (event.name === 'repository/authored-pr.repair.requested')
      await repairHandler()({ ...context, event });
  });
});
test('reserves before provider work and stores only commit metadata in durable steps', async () => {
  const order: string[] = [];
  deps.reserve.mockImplementation(async () => {
    order.push('reserve');
    return { id: 'repair', ordinal: 1, state: 'queued', baseHeadSha: pr.headSha };
  });
  deps.repair.mockImplementation(async () => {
    order.push('provider');
    return { headSha: 'b'.repeat(40) };
  });
  await handler(context);
  expect(order).toEqual(['reserve', 'provider']);
  expect(deps.finish).toHaveBeenCalledWith('repair', { headSha: 'b'.repeat(40) });
  expect(JSON.stringify(durable)).not.toMatch(/files|transcript|content/);
});
test('losing a reservation race never invokes the provider', async () => {
  deps.reserve.mockResolvedValue(null);
  await handler(context);
  expect(deps.repair).not.toHaveBeenCalled();
});
test.each(['merged', 'closed'])(
  '%s stores outcome and only merge dispatches verification',
  async (outcome) => {
    deps.observe.mockResolvedValue({ ...snapshot, outcome });
    await handler(context);
    expect(deps.outcome).toHaveBeenCalledWith('pr', expect.objectContaining({ outcome }));
    expect(deps.repair).not.toHaveBeenCalled();
    if (outcome === 'merged')
      expect(deps.send).toHaveBeenCalledWith('verify-installation', {
        name: 'repository/fieldnote.installation.verify.requested',
        data: { authoredPrId: 'pr' },
      });
    else expect(deps.send).not.toHaveBeenCalled();
  },
);
test('three attempts and dangerous feedback persist human-required without provider work', async () => {
  deps.load.mockResolvedValue({
    pr,
    repairs: [1, 2, 3].map((ordinal) => ({ ordinal, state: 'complete' })),
  });
  await handler(context);
  expect(deps.human).toHaveBeenCalledWith('pr', 'repair_limit');
  expect(deps.repair).not.toHaveBeenCalled();
});
test('transient failures keep the same reserved attempt retryable and hide provider details', async () => {
  deps.repair.mockRejectedValue(new Error('private provider source and token'));
  await expect(handler(context)).rejects.toThrow('Setup repair temporarily unavailable');
  expect(deps.finish).not.toHaveBeenCalled();
});
test('the third reserved repair resumes after a transient failure without consuming another ordinal', async () => {
  deps.load.mockResolvedValue({
    pr,
    repairs: [1, 2]
      .map((ordinal) => ({ id: `old-${ordinal}`, ordinal, state: 'failed' }))
      .concat([{ id: 'third', ordinal: 3, state: 'queued' }]),
  });
  await handler(context);
  expect(deps.repair).toHaveBeenCalledWith('pr', 'third');
  expect(deps.reserve).not.toHaveBeenCalled();
  expect(deps.human).not.toHaveBeenCalled();
});
test('a persisted human-required stop prevents further repairs while still observing terminal outcomes', async () => {
  deps.load.mockResolvedValue({ pr, repairs: [], humanRequired: true });
  await handler(context);
  expect(deps.reserve).not.toHaveBeenCalled();
  expect(deps.repair).not.toHaveBeenCalled();
  deps.observe.mockResolvedValue({ ...snapshot, outcome: 'merged' });
  await handler(context);
  expect(deps.send).toHaveBeenCalled();
});
test('retry exhaustion closes the reserved attempt so recovery can allocate the next bounded round', async () => {
  deps.load.mockResolvedValue({ pr, repairs: [{ id: 'attempt', ordinal: 1, state: 'queued' }] });
  await deps.configs[1]?.onFailure?.({
    event: { data: { event: { data: { authoredPrId: 'pr', repairId: 'attempt' } } } },
  });
  expect(deps.finish).toHaveBeenCalledWith('attempt', { errorCode: 'repair_failed' });
});
test('a delayed failure callback targets the event attempt, never a newer reservation', async () => {
  deps.load.mockResolvedValue({
    pr,
    repairs: [{ id: 'new-attempt', ordinal: 2, state: 'queued' }],
  });
  await deps.configs[1]?.onFailure?.({
    event: { data: { event: { data: { authoredPrId: 'pr', repairId: 'old-attempt' } } } },
  });
  expect(deps.finish).toHaveBeenCalledWith('old-attempt', { errorCode: 'repair_failed' });
});
test('pending checks leave a reserved repair eligible for later reconciliation', async () => {
  deps.repair.mockRejectedValueOnce(new SetupWriteError('repair_pending'));
  await handler(context);
  expect(deps.finish).not.toHaveBeenCalled();
  expect(deps.human).not.toHaveBeenCalled();
});
test('delayed obsolete repair deliveries do not record a human stop', async () => {
  deps.repair.mockRejectedValueOnce(new SetupWriteError('repair_obsolete'));
  await handler(context);
  expect(deps.finish).not.toHaveBeenCalled();
  expect(deps.human).not.toHaveBeenCalled();
});
