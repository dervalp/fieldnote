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
  schedules: vi.fn(),
  workspace: vi.fn(),
  publicSettings: vi.fn(),
}));
vi.mock('../../../../../workspaces/access', () => ({
  requireRepository: deps.authorize,
  requireWorkspace: deps.workspace,
}));
vi.mock('../../../../../db/queries/grade-runs', () => ({
  gradeSummaries: deps.summaries,
  gradeHistory: deps.history,
  getGrade: deps.get,
}));
vi.mock('../../../../../db/queries/act-settings', () => ({ actEnabled: deps.actEnabled }));
vi.mock('../../../../../github/installation-permissions', () => ({
  fetchGrantedPermissions: deps.fetchGrantedPermissions,
}));
vi.mock('../../../../../db/queries/authoring-runs', () => ({ latestPlan: deps.latestPlan }));
vi.mock('../../../../../db/queries/grade-schedules', () => ({ gradeSchedules: deps.schedules }));
vi.mock('../../../../../components/act/act-entry', () => ({
  ActEntry: ({ availability }: { availability: { available: boolean } }) =>
    createElement('p', null, availability.available ? 'act-available' : 'act-unavailable'),
}));
vi.mock('../../../../../components/grading/report', () => ({
  GradeControls: ({ graderId, initial }: { graderId: string; initial: { state: string } | null }) =>
    createElement('p', null, `controls:${graderId}:${initial?.state ?? 'none'}`),
}));
vi.mock('../../../../../components/grading/report-view', () => ({
  GradeReport: ({
    grade,
    graderTitle,
  }: {
    grade: { rubricVersion: string };
    graderTitle: string;
  }) => createElement('p', null, `${graderTitle}:${grade.rubricVersion}`),
}));
vi.mock('../../../../../components/grading/schedule-toggle', () => ({
  ScheduleToggle: ({ graderId, schedule }: { graderId: string; schedule: unknown }) =>
    createElement('p', null, `schedule:${graderId}:${schedule ? 'on' : 'off'}`),
}));
vi.mock('../../../../../db/queries/public-grade-settings', () => ({
  publicGradeSettings: deps.publicSettings,
}));
vi.mock('../../../../../components/grading/share-toggle', () => ({
  ShareToggle: ({
    graderId,
    shared,
    canShare,
  }: {
    graderId: string;
    shared: boolean;
    canShare: boolean;
  }) => createElement('p', null, `share:${graderId}:${shared ? 'on' : 'off'}:${canShare ? 'owner' : 'member'}`),
}));
import Grading from './page';
import { DELIVERY_HEALTH } from '../../../../../domain/grading/graders/delivery-health';
const completed = {
  id: 'old',
  score: 60,
  sha: 'a'.repeat(40),
  rubricVersion: '0.1.0',
  evaluatorVersion: '1.0.0',
  computedAt: new Date('2026-09-08'),
  checks: [],
};
const call = (run?: string, grader?: string) =>
  Grading({
    params: Promise.resolve({ repoId: 'repo' }),
    searchParams: Promise.resolve({ run, grader }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  deps.authorize.mockResolvedValue({
    id: 'repo',
    owner: 'owner',
    name: 'repo',
    isDemo: false,
    isPrivate: false,
  });
  deps.summaries.mockResolvedValue([
    {
      graderId: 'fieldnote/agent-readiness',
      latest: completed,
      status: { id: 'new', state: 'failed' },
    },
    { graderId: DELIVERY_HEALTH, latest: null, status: null },
  ]);
  deps.history.mockResolvedValue([completed]);
  deps.get.mockResolvedValue(null);
  deps.actEnabled.mockResolvedValue(false);
  deps.fetchGrantedPermissions.mockResolvedValue({ contents: null, pullRequests: null });
  deps.latestPlan.mockResolvedValue(null);
  deps.schedules.mockResolvedValue({});
  deps.workspace.mockResolvedValue({ id: 'workspace', name: 'W', role: 'owner' });
  deps.publicSettings.mockResolvedValue({});
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
  deps.summaries.mockResolvedValue([
    {
      graderId: 'fieldnote/agent-readiness',
      latest: null,
      status: { id: 'new', state: 'running' },
    },
    { graderId: DELIVERY_HEALTH, latest: null, status: null },
  ]);
  deps.history.mockResolvedValue([]);
  const html = renderToStaticMarkup(await call());
  expect(html).toContain('Not graded yet');
  expect(html).not.toContain('out of 100');
});

test('both graders render a card region', async () => {
  const html = renderToStaticMarkup(await call());
  // Agent Readiness has a completed grade and renders the real GradeCard;
  // Delivery Health has never run and renders its own ungraded tile — both
  // rows come from listGraders(), not from a hardcoded pair.
  expect(html).toContain('Agent Readiness');
  expect(html).toContain('Delivery Health');
  expect(html).toContain('Not graded yet');
});

test('?grader= selects which report is shown', async () => {
  deps.summaries.mockResolvedValue([
    { graderId: 'fieldnote/agent-readiness', latest: completed, status: null },
    {
      graderId: DELIVERY_HEALTH,
      latest: { ...completed, id: 'delivery-run', rubricVersion: '9.9.9' },
      status: null,
    },
  ]);
  const html = renderToStaticMarkup(await call(undefined, DELIVERY_HEALTH));
  expect(deps.history).toHaveBeenCalledWith('repo', DELIVERY_HEALTH);
  expect(html).toContain(`controls:${DELIVERY_HEALTH}:`);
  expect(html).toContain('Delivery Health:9.9.9');
});

test('the Act entry appears under the readiness card and disappears under a different one', async () => {
  // Presence alone would still pass if the isReadiness gate were removed
  // (grade truthy is enough on its own); asserting absence under a different
  // card is what actually exercises the gate. Both graders carry a completed
  // grade here so that "no Act marker" cannot be explained by "no grade".
  deps.summaries.mockResolvedValue([
    { graderId: 'fieldnote/agent-readiness', latest: completed, status: null },
    { graderId: DELIVERY_HEALTH, latest: completed, status: null },
  ]);
  const readinessSelected = renderToStaticMarkup(await call());
  expect(readinessSelected).toMatch(/act-(un)?available/);
  const deliverySelected = renderToStaticMarkup(await call(undefined, DELIVERY_HEALTH));
  expect(deliverySelected).not.toMatch(/act-(un)?available/);
});

test('Agent Readiness renders before Delivery Health, in listGraders() registration order', async () => {
  const html = renderToStaticMarkup(await call());
  const readinessIndex = html.indexOf('Agent Readiness');
  const deliveryIndex = html.indexOf('Delivery Health');
  expect(readinessIndex).toBeGreaterThanOrEqual(0);
  expect(deliveryIndex).toBeGreaterThanOrEqual(0);
  expect(readinessIndex).toBeLessThan(deliveryIndex);
});

test('an unregistered ?grader= is a 404', async () => {
  await expect(call(undefined, 'fieldnote/does-not-exist')).rejects.toThrow(
    'NEXT_HTTP_ERROR_FALLBACK;404',
  );
  expect(deps.summaries).not.toHaveBeenCalled();
});

test('a grader that has never run renders its tile and its Run button', async () => {
  const html = renderToStaticMarkup(await call(undefined, DELIVERY_HEALTH));
  expect(html).toContain('Not graded yet');
  // The mocked GradeControls stands in for the real Run button; asserting it
  // is parameterised with the selected grader's id is what proves the button
  // targets that grader rather than whichever one was on screen before.
  expect(html).toContain(`controls:${DELIVERY_HEALTH}:none`);
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

test('an owner gets the sharing switch for the selected grader', async () => {
  deps.publicSettings.mockResolvedValue({ 'fieldnote/agent-readiness': { shared: true } });
  const html = renderToStaticMarkup(await call());
  expect(html).toContain('share:fieldnote/agent-readiness:on:owner');
});

test('a member gets the state without the control', async () => {
  deps.workspace.mockResolvedValue({ id: 'workspace', name: 'W', role: 'member' });
  const html = renderToStaticMarkup(await call());
  expect(html).toContain('share:fieldnote/agent-readiness:off:member');
});
