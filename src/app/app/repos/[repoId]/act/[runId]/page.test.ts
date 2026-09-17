import { beforeEach, expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const deps = vi.hoisted(() => ({
  authorize: vi.fn(),
  setup: vi.fn(),
  summary: vi.fn(),
  plan: vi.fn(),
}));
vi.mock('../../../../../../workspaces/access', () => ({ requireRepository: deps.authorize }));
vi.mock('../../../../../../db/queries/fieldnote-setup', () => ({
  getSetupPlan: deps.setup,
  getSetupSummary: deps.summary,
}));
vi.mock('../../../../../../db/queries/authoring-runs', () => ({ getPlan: deps.plan }));
vi.mock('../../grading/actions', () => ({
  answerFieldnoteSetup: vi.fn(),
  requestFieldnoteSetup: vi.fn(),
}));
vi.mock('next/navigation', async (original) => ({
  ...(await original<object>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));
import Plan from './page';
const call = () =>
  Plan({ params: Promise.resolve({ repoId: 'repository%3A1', runId: 'run%3A2' }) });
beforeEach(() => {
  vi.resetAllMocks();
  deps.authorize.mockResolvedValue({ id: 'repository:1', owner: 'octo', name: 'repo' });
  deps.setup.mockResolvedValue(null);
  deps.plan.mockResolvedValue(null);
  deps.summary.mockResolvedValue({
    installation: { kind: 'proposed', runId: 'run:2', pullRequestUrl: null },
    progress: { runId: 'run:2', state: 'awaiting-input', pullRequestUrl: null },
    latestAvailable: false,
  });
});
test('renders persisted setup notes and the current question at the decoded run route', async () => {
  deps.setup.mockImplementation(async (repo, run) =>
    repo === 'repository:1' && run === 'run:2'
      ? {
          run: { id: run, state: 'running' },
          proposal: { state: 'awaiting-input', detectedAgents: [] },
          notes: [
            { id: 'q', speaker: 'agent', kind: 'question', body: '[Tracker.kind] Which tracker?' },
          ],
          files: [],
        }
      : null,
  );
  const html = renderToStaticMarkup(await call());
  expect(html).toContain('Setup conversation');
  expect(html).toContain('name="questionId" value="q"');
  expect(html).toContain('href="/app/repos/repository%3A1/grading"');
});
test('retains existing readiness plans', async () => {
  deps.plan.mockResolvedValue({
    run: { state: 'complete', sha: 'a'.repeat(40), model: null },
    remedies: [],
  });
  expect(renderToStaticMarkup(await call())).toContain('No model wrote this plan');
});
test('an unknown or foreign setup run is a 404', async () => {
  await expect(call()).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
});
test('authorization failure prevents the setup read', async () => {
  deps.authorize.mockRejectedValue(new Error('denied'));
  await expect(call()).rejects.toThrow('denied');
  expect(deps.setup).not.toHaveBeenCalled();
});
test('a failed conversation does not misreport that Act permissions are disabled', async () => {
  deps.setup.mockResolvedValue({
    run: { id: 'run:2', state: 'failed' },
    proposal: null,
    notes: [],
    files: [],
  });
  deps.summary.mockResolvedValue({
    installation: { kind: 'missing', latest: '' },
    progress: { runId: 'run:2', state: 'failed', pullRequestUrl: null },
    latestAvailable: false,
  });
  const html = renderToStaticMarkup(await call());
  expect(html).toContain('Your conversation has been saved');
  expect(html).not.toContain('Enable Act');
});
