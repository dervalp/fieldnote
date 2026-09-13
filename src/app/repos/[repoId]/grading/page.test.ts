import { beforeEach, expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const deps = vi.hoisted(() => ({
  authorize: vi.fn(),
  summaries: vi.fn(),
  history: vi.fn(),
  get: vi.fn(),
  actEnabled: vi.fn(),
  fetchGrantedPermissions: vi.fn(),
  latestPlan: vi.fn(),
}));
vi.mock('../../../../workspaces/access', () => ({ requireRepository: deps.authorize }));
vi.mock('../../../../db/queries/grade-runs', () => ({
  gradeSummaries: deps.summaries,
  gradeHistory: deps.history,
  getGrade: deps.get,
}));
vi.mock('../../../../db/queries/act-settings', () => ({ actEnabled: deps.actEnabled }));
vi.mock('../../../../github/installation-permissions', () => ({
  fetchGrantedPermissions: deps.fetchGrantedPermissions,
}));
vi.mock('../../../../db/queries/authoring-runs', () => ({ latestPlan: deps.latestPlan }));
vi.mock('../../../../components/act/act-entry', () => ({
  ActEntry: ({ availability }: { availability: { available: boolean } }) =>
    createElement('p', null, availability.available ? 'act-available' : 'act-unavailable'),
}));
vi.mock('../../../../components/grading/report', () => ({
  GradeControls: ({ initial }: { initial: { state: string } | null }) =>
    createElement('p', null, initial?.state),
  GradeReport: ({ grade }: { grade: { rubricVersion: string } }) =>
    createElement('p', null, grade.rubricVersion),
}));
import Grading from './page';
const completed = {
  id: 'old',
  score: 60,
  sha: 'a'.repeat(40),
  rubricVersion: '0.1.0',
  evaluatorVersion: '1.0.0',
  computedAt: new Date('2026-09-08'),
  checks: [],
};
const call = (run?: string) =>
  Grading({ params: Promise.resolve({ repoId: 'repo' }), searchParams: Promise.resolve({ run }) });
beforeEach(() => {
  vi.resetAllMocks();
  deps.authorize.mockResolvedValue({
    id: 'repo',
    owner: 'owner',
    name: 'repo',
    isDemo: false,
  });
  deps.summaries.mockResolvedValue([{ latest: completed, status: { id: 'new', state: 'failed' } }]);
  deps.history.mockResolvedValue([completed]);
  deps.get.mockResolvedValue(null);
  deps.actEnabled.mockResolvedValue(false);
  deps.fetchGrantedPermissions.mockResolvedValue({ contents: null, pullRequests: null });
  deps.latestPlan.mockResolvedValue(null);
});
test('latest completed score remains visible alongside failed current attempt', async () => {
  const html = renderToStaticMarkup(await call());
  expect(html).toContain('60 out of 100');
  expect(html).toContain('failed');
});
test('historical selection is scoped to the authorized repository', async () => {
  deps.get.mockResolvedValue({ ...completed, score: 20, rubricVersion: '0.0.1' });
  const html = renderToStaticMarkup(await call('old'));
  expect(deps.get).toHaveBeenCalledWith('repo', 'old', 'fieldnote/agent-readiness');
  expect(html).toContain('20 out of 100');
  expect(html).toContain('0.0.1');
  expect(html).toContain('Viewing a saved report');
});
test('missing or foreign historical run is not replaced by latest grade', async () => {
  await expect(call('foreign')).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
});
test('outsider fails before any grade read', async () => {
  deps.authorize.mockRejectedValue(new Error('denied'));
  await expect(call()).rejects.toThrow('denied');
  expect(deps.summaries).not.toHaveBeenCalled();
  expect(deps.history).not.toHaveBeenCalled();
});
test('incomplete evidence has an ungraded state with no numeric card', async () => {
  deps.summaries.mockResolvedValue([{ latest: null, status: { id: 'new', state: 'running' } }]);
  deps.history.mockResolvedValue([]);
  const html = renderToStaticMarkup(await call());
  expect(html).toContain('Not graded yet');
  expect(html).not.toContain('out of 100');
});

test('escaped route id is decoded before authorization', async () => {
  await Grading({
    params: Promise.resolve({ repoId: 'repository%3A1360100266' }),
    searchParams: Promise.resolve({}),
  });
  expect(deps.authorize).toHaveBeenCalledWith('repository:1360100266');
});

test('the permissions fetch is handed the repository id, never the raw row installationId', async () => {
  // Regression for the Critical defect: repo.installationId is an internal
  // row id (`installation:<githubId>`, or the demo literal), never the
  // numeric GitHub id. fetchGrantedPermissions must resolve that itself, so
  // the page must call it with the repository id it already has, not any
  // field plucked off the authorized repository record.
  deps.actEnabled.mockResolvedValue(true);
  await call();
  expect(deps.fetchGrantedPermissions).toHaveBeenCalledWith('repo');
  expect(deps.fetchGrantedPermissions).not.toHaveBeenCalledWith('installation-1');
});

test('the availability line is suppressed for a repository that never opted in', async () => {
  deps.actEnabled.mockResolvedValue(false);
  const html = renderToStaticMarkup(await call());
  expect(deps.fetchGrantedPermissions).not.toHaveBeenCalled();
  expect(html).not.toContain('Opening pull requests is off');
});

test('an opted-in repository still learns why Act cannot proceed', async () => {
  deps.actEnabled.mockResolvedValue(true);
  deps.fetchGrantedPermissions.mockResolvedValue({ contents: 'read', pullRequests: 'read' });
  const html = renderToStaticMarkup(await call());
  expect(html).toContain('fieldnote needs write access');
});

test('a failed permissions fetch is logged before falling back to nothing granted', async () => {
  deps.actEnabled.mockResolvedValue(true);
  deps.fetchGrantedPermissions.mockRejectedValue(new Error('Installation permissions unavailable'));
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const html = renderToStaticMarkup(await call());
  expect(errorSpy).toHaveBeenCalled();
  expect(html).toContain('fieldnote needs write access');
  errorSpy.mockRestore();
});
