import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

vi.mock('../auth/session', () => ({
  currentUser: async () => ({ id: 'u1', displayName: 'Pierre', login: 'pierre' }),
}));
vi.mock('../workspaces/access', () => ({
  requireWorkspace: async () => ({ id: 'w1', name: 'Personal workspace', role: 'owner' }),
}));
vi.mock('../workspaces/store', () => ({ listWorkspaces: async () => [] }));
vi.mock('../lib/env', () => ({ env: () => ({ DEMO_MODE: 'false' }) }));
vi.mock('./sidebar', () => ({ Sidebar: () => createElement('aside') }));

import { AppShell } from './app-shell';

const render = async (crumbs?: { label: string; href?: string }[]) =>
  renderToStaticMarkup(await AppShell({ children: null, crumbs }));

test('the trail the layout supplies lands in the context slot', async () => {
  const html = await render([
    { label: 'Personal workspace', href: '/dashboard' },
    { label: 'fieldnote' },
  ]);
  const slot = html.indexOf('fn-topbar__context');
  expect(slot).toBeGreaterThan(-1);
  expect(html.indexOf('fieldnote')).toBeGreaterThan(slot);
  expect(html.indexOf('fieldnote')).toBeLessThan(html.indexOf('fn-topbar__identity'));
});

test('a layout that supplies no trail still names the workspace', async () => {
  expect(await render()).toContain('Personal workspace');
});

test('the skip link target survives the restructure', async () => {
  const html = await render();
  expect(html).toContain('id="main-content"');
});

test('the utility slot ships no control', async () => {
  const html = await render();
  const utility = html.slice(html.indexOf('fn-topbar__utility'));
  expect(utility.slice(0, utility.indexOf('fn-topbar__identity'))).not.toContain('<button');
});
