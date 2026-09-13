import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
const navigation = vi.hoisted(() => ({ pathname: '/repos', search: 'days=30' }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
// The switcher reaches server actions; navigation is what this suite covers.
vi.mock('./workspace-switcher', () => ({
  WorkspaceSwitcher: ({ active }: { active: { name: string } }) =>
    createElement('p', null, active.name),
}));
import { Sidebar } from './sidebar';
const active = { id: 'w', name: 'Personal workspace', role: 'owner' as const };
const render = () =>
  renderToStaticMarkup(createElement(Sidebar, { active, workspaces: [active], demo: false }));
test('repositories is a dedicated active destination and navigation retains range only', () => {
  navigation.search = 'days=30&private=ignore';
  const html = render();
  expect(html).toContain('href="/repos?days=30"');
  expect(html).toContain('aria-current="page" href="/repos?days=30"');
  expect(html).toContain('href="/dashboard?days=30"');
  expect(html).not.toContain('private=ignore');
});
test('the active workspace names the records the sidebar navigates', () => {
  navigation.search = '';
  expect(render()).toContain('Personal workspace');
});
test('the active item is marked for styling by aria-current alone', () => {
  navigation.pathname = '/repos';
  navigation.search = '';
  const html = render();
  // The tightened rows drop the 2px left border for a fill plus an inset edge.
  // Both are selected by aria-current, so no class may encode selection —
  // if one appears here, the CSS and the accessibility tree can drift apart.
  expect(html).toContain('aria-current="page"');
  expect(html).not.toContain('class="active"');
  expect(html).not.toContain('nav-active');
});
