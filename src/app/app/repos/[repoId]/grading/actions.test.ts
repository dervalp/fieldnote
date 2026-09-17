import { beforeEach, expect, test, vi } from 'vitest';
const { requestGrade, dispatchGrade } = vi.hoisted(() => ({
  requestGrade: vi.fn(),
  dispatchGrade: vi.fn(),
}));
vi.mock('../../../../../db/queries/grade-runs', () => ({ requestGrade }));
vi.mock('../../../../../inngest/dispatch-grade', () => ({ dispatchGrade }));
const setup = vi.hoisted(() => ({
  requireRepository: vi.fn(),
  request: vi.fn(),
  answer: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock('../../../../../workspaces/access', () => ({ requireRepository: setup.requireRepository }));
vi.mock('../../../../../db/queries/fieldnote-setup', () => ({ requestSetupPlan: setup.request }));
vi.mock('../../../../../authoring/fieldnote-setup', () => ({ answerSetupPlan: setup.answer }));
vi.mock('../../../../../inngest/dispatch-authoring', () => ({
  dispatchAuthoringPlan: setup.dispatch,
}));
import { runGrade, requestFieldnoteSetup, answerFieldnoteSetup } from './actions';
beforeEach(() => {
  vi.resetAllMocks();
  requestGrade.mockResolvedValue({ id: 'run', state: 'queued' });
});
test('member may queue a grader and receives only its run id', async () => {
  expect(await runGrade('repo', 'fieldnote/agent-readiness')).toEqual({ runId: 'run' });
  expect(requestGrade).toHaveBeenCalledWith('repo', 'fieldnote/agent-readiness');
  expect(dispatchGrade).toHaveBeenCalledWith('run');
});
test('a grader other than the built-in readiness one passes through unchanged', async () => {
  // No `if` naming a grader id here: the caller names the grader, the action
  // does not choose one.
  expect(await runGrade('repo', 'fieldnote/delivery-health')).toEqual({ runId: 'run' });
  expect(requestGrade).toHaveBeenCalledWith('repo', 'fieldnote/delivery-health');
});
test.each(['outsider', 'disconnected repository', 'demo workspace'])(
  'denied %s never dispatches',
  async (reason) => {
    requestGrade.mockRejectedValue(new Error(reason));
    await expect(runGrade('repo', 'fieldnote/agent-readiness')).rejects.toThrow();
    expect(dispatchGrade).not.toHaveBeenCalled();
  },
);
test('dispatch outage preserves queued id for polling and reconciliation', async () => {
  dispatchGrade.mockRejectedValue(new Error('secret'));
  expect(await runGrade('repo', 'fieldnote/agent-readiness')).toEqual({ runId: 'run' });
});

test('setup authorizes before requesting and returns only the durable polling identity', async () => {
  setup.requireRepository.mockResolvedValue({ id: 'repo' });
  setup.request.mockResolvedValue({ id: 'setup', state: 'queued' });
  setup.dispatch.mockRejectedValue(new Error('provider secret'));
  expect(await requestFieldnoteSetup('repo')).toEqual({ runId: 'setup' });
  expect(setup.requireRepository.mock.invocationCallOrder[0]).toBeLessThan(
    setup.request.mock.invocationCallOrder[0],
  );
  expect(setup.dispatch).toHaveBeenCalledWith('setup');
});

test.each(['request', 'answer'])(
  'unauthorized setup %s never reads or mutates a run',
  async (kind) => {
    setup.requireRepository.mockRejectedValue(new Error('denied'));
    const form = new FormData();
    form.set('answer', 'Yes');
    await expect(
      kind === 'request'
        ? requestFieldnoteSetup('repo')
        : answerFieldnoteSetup('repo', 'run', form),
    ).rejects.toThrow('denied');
    expect(setup.request).not.toHaveBeenCalled();
    expect(setup.answer).not.toHaveBeenCalled();
  },
);

test('answer reauthorizes and delegates only the repository, run, and submitted form', async () => {
  const form = new FormData();
  form.set('answer', 'Yes; Codex and Claude Code are correct.');
  await answerFieldnoteSetup('repo', 'run', form);
  expect(setup.requireRepository).toHaveBeenCalledWith('repo');
  expect(setup.answer).toHaveBeenCalledWith('repo', 'run', form);
  expect(setup.requireRepository.mock.invocationCallOrder[0]).toBeLessThan(
    setup.answer.mock.invocationCallOrder[0],
  );
});
