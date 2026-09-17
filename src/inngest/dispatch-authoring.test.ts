import { beforeEach, expect, test, vi } from 'vitest';

const rows = vi.hoisted(() => ({
  selected: [] as { id: string; workflow?: string }[],
  updates: 0,
}));
vi.mock('../db', () => ({
  db: () => ({
    select: () => ({ from: () => ({ where: async () => rows.selected }) }),
    update: () => ({
      set: () => ({
        where: async () => {
          rows.updates += 1;
        },
      }),
    }),
  }),
}));

import { dispatchAuthoringPlan } from './dispatch-authoring';

beforeEach(() => {
  rows.selected = [];
  rows.updates = 0;
});

test('sends one event keyed on the run id and marks the row dispatched', async () => {
  rows.selected = [{ id: 'run-1' }];
  const send = vi.fn().mockResolvedValue(undefined);
  await dispatchAuthoringPlan('run-1', send);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith({
    id: 'run-1',
    name: 'repository/authoring.plan.requested',
    data: { runId: 'run-1' },
  });
  expect(rows.updates).toBe(1);
});

test('sends nothing when the row is no longer queued and undispatched', async () => {
  const send = vi.fn();
  await dispatchAuthoringPlan('run-1', send);
  expect(send).not.toHaveBeenCalled();
  expect(rows.updates).toBe(0);
});

test('leaves the row undispatched when the send fails, so reconciliation retries it', async () => {
  rows.selected = [{ id: 'run-1' }];
  const send = vi.fn().mockRejectedValue(new Error('inngest down'));
  await expect(dispatchAuthoringPlan('run-1', send)).rejects.toThrow('inngest down');
  expect(rows.updates).toBe(0);
});

test('routes a setup plan through its own event with the stable run identity', async () => {
  rows.selected = [{ id: 'setup', workflow: 'fieldnote-setup' }];
  const send = vi.fn().mockResolvedValue(undefined);
  await dispatchAuthoringPlan('setup', send);
  expect(send).toHaveBeenCalledWith({
    id: 'setup',
    name: 'repository/fieldnote.setup.plan.requested',
    data: { runId: 'setup' },
  });
});
