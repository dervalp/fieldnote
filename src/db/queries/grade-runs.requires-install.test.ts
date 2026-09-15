import { expect, test, vi } from 'vitest';

// requestGrade resolves a workspace's installed grader by id, through
// installedGrader(workspace, graderId), and refuses one it has not installed
// before touching anything else. This test proves that refusal without
// touching the database's grade tables at all: installedGrader is mocked to
// report nothing installed, so a real database would never see an insert
// attempt for a grader the workspace never installed.
const installed = vi.hoisted(() => vi.fn());
vi.mock('../../auth/session', () => ({ currentUser: async () => ({ id: 'user-fixture' }) }));
vi.mock('../../workspaces/access', () => ({
  requireRepository: async (id: string) => ({ id, isDemo: false }),
  requireWorkspace: async () => ({ id: 'workspace-fixture' }),
  accessibleRepositories: async () => [],
}));
vi.mock('./graders', () => ({
  installedGrader: installed,
  graderVersion: vi.fn(),
}));

import { requestGrade } from './grade-runs';

test('requestGrade refuses a grader the workspace has not installed', async () => {
  installed.mockResolvedValueOnce(null);
  await expect(requestGrade('repo-fixture', 'nobody/unknown-grader')).rejects.toThrow(
    "No grader 'nobody/unknown-grader' is installed.",
  );
  expect(installed).toHaveBeenCalledWith('workspace-fixture', 'nobody/unknown-grader');
});
