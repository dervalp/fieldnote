import { beforeEach, expect, test, vi } from 'vitest';
const { requestGrade, dispatchGrade } = vi.hoisted(() => ({
  requestGrade: vi.fn(),
  dispatchGrade: vi.fn(),
}));
vi.mock('../../../../db/queries/grade-runs', () => ({ requestGrade }));
vi.mock('../../../../inngest/dispatch-grade', () => ({ dispatchGrade }));
import { runGrade } from './actions';
beforeEach(() => {
  vi.resetAllMocks();
  requestGrade.mockResolvedValue({ id: 'run', state: 'queued' });
});
test('member may queue a grader and receives only its run id', async () => {
  expect(await runGrade('repo')).toEqual({ runId: 'run' });
  expect(requestGrade).toHaveBeenCalledWith('repo', 'fieldnote/agent-readiness');
  expect(dispatchGrade).toHaveBeenCalledWith('run');
});
test.each(['outsider', 'disconnected repository', 'demo workspace'])(
  'denied %s never dispatches',
  async (reason) => {
    requestGrade.mockRejectedValue(new Error(reason));
    await expect(runGrade('repo')).rejects.toThrow();
    expect(dispatchGrade).not.toHaveBeenCalled();
  },
);
test('dispatch outage preserves queued id for polling and reconciliation', async () => {
  dispatchGrade.mockRejectedValue(new Error('secret'));
  expect(await runGrade('repo')).toEqual({ runId: 'run' });
});
