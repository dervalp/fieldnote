import { beforeEach, expect, test, vi } from 'vitest';
import { redirect } from 'next/navigation';
const { authorize, request, dispatch, revalidate, available, workspace, link } = vi.hoisted(() => ({
  authorize: vi.fn(),
  available: vi.fn(),
  workspace: vi.fn(),
  link: vi.fn(),
  request: vi.fn(),
  dispatch: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('../../../auth/access', () => ({
  githubAccessibleRepositories: available,
}));
vi.mock('../../../workspaces/access', () => ({
  requireRepository: authorize,
  requireWorkspace: workspace,
  linkRepository: link,
}));
vi.mock('../../../db/queries/repository-imports', () => ({ requestRepositoryImport: request }));
vi.mock('../../../inngest/dispatch-import', () => ({ dispatchImport: dispatch }));
vi.mock('next/cache', () => ({ revalidatePath: revalidate }));
import {
  startFirstAnalysis,
  retryAnalysis,
  refreshAnalysis,
  refreshRepositoryAccess,
} from './actions';
import { ImportRequestError } from '../../../domain/import/types';
const run = {
  id: 'run',
  repositoryId: 'repo:1',
  state: 'queued',
  total: null,
  completed: 0,
  failed: 0,
  message: null,
  createdAt: '2026-09-08T00:00:00.000Z',
  finishedAt: null,
};
function form(id: string) {
  const value = new FormData();
  value.set('repositoryId', id);
  return value;
}
beforeEach(() => {
  vi.resetAllMocks();
  authorize.mockResolvedValue({ id: 'repo:1' });
  workspace.mockResolvedValue({ id: 'workspace', role: 'owner' });
  link.mockResolvedValue(undefined);
  request.mockResolvedValue(run);
});
test('start authorizes administrator before persistence', async () => {
  authorize.mockRejectedValueOnce(new Error('denied'));
  await expect(startFirstAnalysis({}, form('repo:1'))).rejects.toThrow('denied');
  expect(authorize).toHaveBeenCalledWith('repo:1', true);
  expect(link).toHaveBeenCalledWith('workspace', 'repo:1');
  expect(request).not.toHaveBeenCalled();
});
test.each(['', '   '])('invalid repository input is safe: %s', async (id) => {
  expect(await startFirstAnalysis({}, form(id))).toEqual({
    error: 'Choose a repository to continue.',
  });
  expect(authorize).not.toHaveBeenCalled();
});
test('queued import survives dispatch failure without leaking error details', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  dispatch.mockRejectedValueOnce(new Error('secret transport error'));
  expect(await startFirstAnalysis({}, form('repo:1'))).toEqual({ run });
  expect(request).toHaveBeenCalledWith('repo:1', 'start', undefined);
  expect(log).toHaveBeenCalledWith('Import queued for dispatch retry', { runId: 'run' });
  expect(revalidate.mock.calls).toEqual([['/app/dashboard'], ['/app/repos/repo%3A1']]);
  log.mockRestore();
});
test('retry passes repository ownership and previous run to persistence after authorization', async () => {
  expect(await retryAnalysis('repo:1', 'previous')).toEqual({ run });
  expect(authorize).toHaveBeenCalledWith('repo:1', true);
  expect(request).toHaveBeenCalledWith('repo:1', 'retry', 'previous');
  expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0]);
});
test('invalid retry run is rejected before authorization', async () => {
  expect(await retryAnalysis('repo:1', '')).toHaveProperty('error');
  expect(request).not.toHaveBeenCalled();
});
test('expected rejected retry returns safe inline feedback', async () => {
  request.mockRejectedValueOnce(new ImportRequestError('Import cannot be retried'));
  expect(await retryAnalysis('repo:1', 'other-run')).toEqual({
    error: 'This import cannot be requested. Refresh the page and try again.',
  });
  expect(dispatch).not.toHaveBeenCalled();
});
test('navigation exceptions propagate', async () => {
  authorize.mockImplementationOnce(() => redirect('/api/auth/login'));
  await expect(startFirstAnalysis({}, form('repo:1'))).rejects.toThrow('NEXT_REDIRECT');
  expect(request).not.toHaveBeenCalled();
});
test('refresh uses its own intent', async () => {
  expect(await refreshAnalysis('repo:1')).toEqual({ run });
  expect(request).toHaveBeenCalledWith('repo:1', 'refresh', undefined);
});

test('unexpected persistence failures propagate without dispatching', async () => {
  request.mockRejectedValueOnce(new Error('database unavailable'));
  await expect(startFirstAnalysis({}, form('repo:1'))).rejects.toThrow('database unavailable');
  expect(dispatch).not.toHaveBeenCalled();
});

test('retry authorization failure cannot create or dispatch a run', async () => {
  authorize.mockRejectedValueOnce(new Error('denied'));
  await expect(retryAnalysis('repo:1', 'previous')).rejects.toThrow('denied');
  expect(request).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});

test('explicit access refresh reconciles GitHub repositories without starting analysis', async () => {
  await refreshRepositoryAccess();
  expect(available).toHaveBeenCalledWith(true);
  expect(workspace).toHaveBeenCalledWith(undefined, 'owner');
  expect(request).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});
