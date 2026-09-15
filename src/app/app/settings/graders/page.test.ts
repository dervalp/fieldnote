import { beforeEach, expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { agentReadinessManifest } from '../../../../domain/grading/graders/agent-readiness';
const deps = vi.hoisted(() => ({
  workspace: vi.fn(),
  workspaceGraders: vi.fn(),
  browsableGraders: vi.fn(),
  installedGraders: vi.fn(),
  installGraderVersion: vi.fn(),
  updateGraderInstall: vi.fn(),
  uninstallGraderVersion: vi.fn(),
}));
vi.mock('../../../../workspaces/access', () => ({
  requireWorkspace: deps.workspace,
}));
vi.mock('../../../../db/queries/grader-publishing', () => ({
  workspaceGraders: deps.workspaceGraders,
}));
vi.mock('../../../../db/queries/graders', () => ({
  browsableGraders: deps.browsableGraders,
  installedGraders: deps.installedGraders,
}));
vi.mock('./actions', () => ({
  publishGraderVersion: vi.fn(),
  withdrawGraderVersion: vi.fn(),
  installGraderVersion: deps.installGraderVersion,
  updateGraderInstall: deps.updateGraderInstall,
  uninstallGraderVersion: deps.uninstallGraderVersion,
}));
import Graders from './page';

// Every test renders the page, which now unconditionally calls
// installedGraders() to find installs that fell out of the browse list (a
// fully-withdrawn grader). Most tests don't care about that path, so this
// default keeps them from having to say so; the withdrawn-install test below
// overrides it.
beforeEach(() => {
  deps.installedGraders.mockResolvedValue([]);
});

test('an owner with a handle is offered the publish form', async () => {
  deps.workspace.mockResolvedValue({ id: 'w', name: 'W', role: 'owner', handle: 'acme' });
  deps.workspaceGraders.mockResolvedValue([]);
  deps.browsableGraders.mockResolvedValue([]);
  const html = renderToStaticMarkup(await Graders());
  expect(html).toContain('Publish a grader');
  expect(html).toContain('name="manifest"');
});

test('an owner with no handle is told to claim one, and gets no form', async () => {
  deps.workspace.mockResolvedValue({ id: 'w', name: 'W', role: 'owner', handle: null });
  deps.workspaceGraders.mockResolvedValue([]);
  deps.browsableGraders.mockResolvedValue([]);
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
  deps.browsableGraders.mockResolvedValue([]);
  const html = renderToStaticMarkup(await Graders());
  expect(html).toContain('Test Coverage');
  expect(html).toContain('Not reviewed');
  expect(html).not.toContain('name="manifest"');
});

test('an owner sees an install link for a grader it has not installed', async () => {
  deps.workspace.mockResolvedValue({ id: 'w', name: 'W', role: 'owner', handle: 'acme' });
  deps.workspaceGraders.mockResolvedValue([]);
  deps.browsableGraders.mockResolvedValue([
    {
      id: agentReadinessManifest.id,
      manifest: agentReadinessManifest,
      version: agentReadinessManifest.version,
      verifiedAt: new Date('2026-09-01'),
      author: 'fieldnote',
      installed: null,
    },
  ]);
  const html = renderToStaticMarkup(await Graders());
  expect(html).toContain('Agent Readiness');
  expect(html).toContain(
    `install=${encodeURIComponent(`${agentReadinessManifest.id}@${agentReadinessManifest.version}`)}`,
  );
});

test('an already-installed grader offers no install link', async () => {
  deps.workspace.mockResolvedValue({ id: 'w', name: 'W', role: 'owner', handle: 'acme' });
  deps.workspaceGraders.mockResolvedValue([]);
  deps.browsableGraders.mockResolvedValue([
    {
      id: agentReadinessManifest.id,
      manifest: agentReadinessManifest,
      version: agentReadinessManifest.version,
      verifiedAt: new Date('2026-09-01'),
      author: 'fieldnote',
      installed: {
        manifest: agentReadinessManifest,
        version: agentReadinessManifest.version,
        consentedNeeds: 'hash',
        verifiedAt: new Date('2026-09-01'),
        withdrawnAt: null,
        latestVersion: agentReadinessManifest.version,
      },
    },
  ]);
  const html = renderToStaticMarkup(await Graders());
  expect(html).toContain('Installed');
  expect(html).not.toContain('install=');
});

test('an owner sees the update line, the update link and the uninstall sentence when a newer version exists', async () => {
  deps.workspace.mockResolvedValue({ id: 'w', name: 'W', role: 'owner', handle: 'acme' });
  deps.workspaceGraders.mockResolvedValue([]);
  deps.browsableGraders.mockResolvedValue([
    {
      id: agentReadinessManifest.id,
      manifest: agentReadinessManifest,
      version: '0.2.0',
      verifiedAt: new Date('2026-09-01'),
      author: 'fieldnote',
      installed: {
        manifest: agentReadinessManifest,
        version: '0.1.0',
        consentedNeeds: 'hash',
        verifiedAt: new Date('2026-09-01'),
        withdrawnAt: null,
        latestVersion: '0.2.0',
      },
    },
  ]);
  const html = renderToStaticMarkup(await Graders());
  expect(html).toContain('Update available — version 0.2.0');
  expect(html).toContain(
    `install=${encodeURIComponent(`${agentReadinessManifest.id}@0.2.0`)}`,
  );
  expect(html).toContain('Grades already produced stay.');
  expect(html).toContain('name="graderId" value="' + agentReadinessManifest.id + '"');
});

test('a member sees neither an update link nor an uninstall form for an installed grader', async () => {
  deps.workspace.mockResolvedValue({ id: 'w', name: 'W', role: 'member', handle: 'acme' });
  deps.workspaceGraders.mockResolvedValue([]);
  deps.browsableGraders.mockResolvedValue([
    {
      id: agentReadinessManifest.id,
      manifest: agentReadinessManifest,
      version: '0.2.0',
      verifiedAt: new Date('2026-09-01'),
      author: 'fieldnote',
      installed: {
        manifest: agentReadinessManifest,
        version: '0.1.0',
        consentedNeeds: 'hash',
        verifiedAt: new Date('2026-09-01'),
        withdrawnAt: null,
        latestVersion: '0.2.0',
      },
    },
  ]);
  const html = renderToStaticMarkup(await Graders());
  expect(html).not.toContain('install=');
  expect(html).not.toContain('Uninstall');
  expect(html).not.toContain('Grades already produced stay.');
});

test('a grader withdrawn in every version stays reachable through its own install entry', async () => {
  deps.workspace.mockResolvedValue({ id: 'w', name: 'W', role: 'owner', handle: 'acme' });
  deps.workspaceGraders.mockResolvedValue([]);
  // browsableGraders() filters out a grader with no non-withdrawn version —
  // it never carries this grader at all, which is exactly the bug: nothing
  // here comes from the browse list.
  deps.browsableGraders.mockResolvedValue([]);
  deps.installedGraders.mockResolvedValue([
    {
      manifest: agentReadinessManifest,
      version: '0.1.0',
      consentedNeeds: 'hash',
      verifiedAt: new Date('2026-09-01'),
      withdrawnAt: new Date('2026-09-10'),
      latestVersion: '0.1.0',
    },
  ]);
  const html = renderToStaticMarkup(await Graders());
  expect(html).toContain('Installed, no longer offered');
  expect(html).toContain(agentReadinessManifest.card.title);
  expect(html).toContain('Uninstall');
  expect(html).toContain(
    'name="graderId" value="' + agentReadinessManifest.id + '"',
  );
});

test('a member sees no install link, even for a grader it has not installed', async () => {
  deps.workspace.mockResolvedValue({ id: 'w', name: 'W', role: 'member', handle: 'acme' });
  deps.workspaceGraders.mockResolvedValue([]);
  deps.browsableGraders.mockResolvedValue([
    {
      id: agentReadinessManifest.id,
      manifest: agentReadinessManifest,
      version: agentReadinessManifest.version,
      verifiedAt: new Date('2026-09-01'),
      author: 'fieldnote',
      installed: null,
    },
  ]);
  const html = renderToStaticMarkup(await Graders());
  expect(html).toContain('Agent Readiness');
  expect(html).not.toContain('install=');
});

test('a member who visits the install query lands on the browse list, not the consent screen', async () => {
  deps.workspace.mockResolvedValue({ id: 'w', name: 'W', role: 'member', handle: 'acme' });
  deps.workspaceGraders.mockResolvedValue([]);
  deps.browsableGraders.mockResolvedValue([
    {
      id: agentReadinessManifest.id,
      manifest: agentReadinessManifest,
      version: agentReadinessManifest.version,
      verifiedAt: new Date('2026-09-01'),
      author: 'fieldnote',
      installed: null,
    },
  ]);
  const html = renderToStaticMarkup(
    await Graders({
      searchParams: Promise.resolve({
        install: `${agentReadinessManifest.id}@${agentReadinessManifest.version}`,
      }),
    }),
  );
  expect(html).toContain('Browse graders');
  expect(html).not.toContain(`Install ${agentReadinessManifest.card.title}`);
});

test('a bogus ?install= value falls back to the browse list', async () => {
  deps.workspace.mockResolvedValue({ id: 'w', name: 'W', role: 'owner', handle: 'acme' });
  deps.workspaceGraders.mockResolvedValue([]);
  deps.browsableGraders.mockResolvedValue([
    {
      id: agentReadinessManifest.id,
      manifest: agentReadinessManifest,
      version: agentReadinessManifest.version,
      verifiedAt: new Date('2026-09-01'),
      author: 'fieldnote',
      installed: null,
    },
  ]);
  const html = renderToStaticMarkup(
    await Graders({ searchParams: Promise.resolve({ install: 'nobody/nothing@9.9.9' }) }),
  );
  expect(html).toContain('Browse graders');
  expect(html).not.toContain(`Install ${agentReadinessManifest.card.title}`);
});

test('an install query renders the consent screen instead of the browse list', async () => {
  deps.workspace.mockResolvedValue({ id: 'w', name: 'W', role: 'owner', handle: 'acme' });
  deps.workspaceGraders.mockResolvedValue([]);
  deps.browsableGraders.mockResolvedValue([
    {
      id: agentReadinessManifest.id,
      manifest: agentReadinessManifest,
      version: agentReadinessManifest.version,
      verifiedAt: new Date('2026-09-01'),
      author: 'fieldnote',
      installed: null,
    },
  ]);
  const html = renderToStaticMarkup(
    await Graders({
      searchParams: Promise.resolve({
        install: `${agentReadinessManifest.id}@${agentReadinessManifest.version}`,
      }),
    }),
  );
  expect(html).toContain(`Install ${agentReadinessManifest.card.title}`);
  expect(html).not.toContain('Browse graders');
});
