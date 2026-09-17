import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, test, vi } from 'vitest';
const deps = vi.hoisted(() => ({
  answer: vi.fn(),
  refresh: vi.fn(),
  pending: false,
  state: {} as { error?: string },
  submit: undefined as
    undefined | ((state: { error?: string }, data: FormData) => Promise<{ error?: string }>),
}));
vi.mock('../../app/app/repos/[repoId]/grading/actions', () => ({
  answerFieldnoteSetup: deps.answer,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: deps.refresh }) }));
vi.mock('react', async (original) => ({
  ...(await original<object>()),
  useActionState: (action: typeof deps.submit) => {
    deps.submit = action;
    return [deps.state, () => {}, deps.pending];
  },
}));
import { SetupAnswerForm } from './setup-answer-form';
const render = () =>
  renderToStaticMarkup(
    createElement(SetupAnswerForm, {
      repositoryId: 'repo',
      runId: 'run',
      questionId: 'question',
      question: 'Which agents?',
      agents: [
        { agent: 'codex', label: 'Codex', supported: true },
        { agent: 'cursor', label: 'Cursor', supported: false },
      ],
    }),
  );
beforeEach(() => {
  vi.resetAllMocks();
  deps.pending = false;
  deps.state = {};
});
test('submits the bound repository/run and original question, answer, and repeated selections', async () => {
  render();
  const data = new FormData();
  data.set('questionId', 'question');
  data.set('answer', 'Use both.');
  data.append('agents', 'codex');
  data.append('agents', 'cursor');
  await deps.submit!({}, data);
  expect(deps.answer).toHaveBeenCalledWith('repo', 'run', data);
  expect(data.getAll('agents')).toEqual(['codex', 'cursor']);
  expect(deps.refresh).toHaveBeenCalledOnce();
});
test('pending disables submission and errors are safe actionable feedback', async () => {
  deps.pending = true;
  expect(render()).toContain('disabled=""');
  expect(render()).toContain('Saving answer');
  deps.answer.mockRejectedValue(new Error('secret provider transcript'));
  deps.state = await deps.submit!({}, new FormData());
  deps.pending = false;
  const html = render();
  expect(html).toContain('role="alert"');
  expect(html).toContain('Unable to save this answer');
  expect(html).not.toContain('secret provider transcript');
  expect(deps.refresh).not.toHaveBeenCalled();
});
