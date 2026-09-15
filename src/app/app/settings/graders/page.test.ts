import { expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const deps = vi.hoisted(() => ({
  workspace: vi.fn(),
  workspaceGraders: vi.fn(),
}));
vi.mock('../../../../workspaces/access', () => ({
  requireWorkspace: deps.workspace,
}));
vi.mock('../../../../db/queries/grader-publishing', () => ({
  workspaceGraders: deps.workspaceGraders,
}));
import Graders from './page';

test('an owner with a handle is offered the publish form', async () => {
  deps.workspace.mockResolvedValue({ id: 'w', name: 'W', role: 'owner', handle: 'acme' });
  deps.workspaceGraders.mockResolvedValue([]);
  const html = renderToStaticMarkup(await Graders());
  expect(html).toContain('Publish a grader');
  expect(html).toContain('name="manifest"');
});

test('an owner with no handle is told to claim one, and gets no form', async () => {
  deps.workspace.mockResolvedValue({ id: 'w', name: 'W', role: 'owner', handle: null });
  deps.workspaceGraders.mockResolvedValue([]);
  const html = renderToStaticMarkup(await Graders());
  expect(html).toContain('Claim a publishing handle');
  expect(html).not.toContain('name="manifest"');
});

test('a member sees what the workspace published and no publish form', async () => {
  deps.workspace.mockResolvedValue({ id: 'w', name: 'W', role: 'member', handle: 'acme' });
  deps.workspaceGraders.mockResolvedValue([
    {
      graderId: 'acme/test-coverage',
      version: '0.1.0',
      title: 'Test Coverage',
      publishedAt: new Date('2026-09-15'),
      verifiedAt: null,
      withdrawnAt: null,
    },
  ]);
  const html = renderToStaticMarkup(await Graders());
  expect(html).toContain('Test Coverage');
  expect(html).toContain('Not reviewed');
  expect(html).not.toContain('name="manifest"');
});
