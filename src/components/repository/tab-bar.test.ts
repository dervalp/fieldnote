import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

// next/link and next/navigation both need a Next request context that does not
// exist in a plain vitest run; the same createElement + renderToStaticMarkup
// pattern the other component tests in this repo use.
const nav = vi.hoisted(() => ({ segment: null as string | null, search: '' }));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => createElement('a', { href, ...rest }, children),
}));
vi.mock('next/navigation', () => ({
  useSelectedLayoutSegment: () => nav.segment,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { TabBar } from './tab-bar';

function hrefs(segment: string | null, search: string): string[] {
  nav.segment = segment;
  nav.search = search;
  const html = renderToStaticMarkup(createElement(TabBar, { repoId: 'repository:1' }));
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replaceAll('&#x27;', "'"));
}

test('every tab keeps the date range the reader arrived with', () => {
  // Regression: tabHref used to return a bare path, so the tab bar — the
  // primary navigation control of this redesign — silently reset the range
  // that /repos and the in-body links both preserve.
  const links = hrefs(null, 'from=2025-01-01&to=2025-01-07');
  expect(links).toHaveLength(5);
  for (const href of links) {
    expect(href).toContain('from=2025-01-01');
    expect(href).toContain('to=2025-01-07');
  }
  expect(links[0]).toBe('/app/repos/repository%3A1?from=2025-01-01&amp;to=2025-01-07');
  expect(links[3]).toBe('/app/repos/repository%3A1/delivery?from=2025-01-01&amp;to=2025-01-07');
});

test('tabs stay bare paths when there is no query string', () => {
  expect(hrefs('delivery', '')).toEqual([
    '/app/repos/repository%3A1',
    '/app/repos/repository%3A1/grading',
    '/app/repos/repository%3A1/ai-involvement',
    '/app/repos/repository%3A1/delivery',
    '/app/repos/repository%3A1/settings',
  ]);
});

test('a Delivery-only param rides along rather than being dropped on the way back', () => {
  // Same defect class as Task 7's DateRange fix: a control that rewrites the
  // URL must not decide which of the reader's params deserve to survive.
  const links = hrefs('delivery', 'days=30&projection=gate-policy');
  for (const href of links) {
    expect(href).toContain('days=30');
    expect(href).toContain('projection=gate-policy');
  }
});

test('the selected tab is still marked and still holds the single tab stop', () => {
  nav.segment = 'grading';
  nav.search = 'days=30';
  const html = renderToStaticMarkup(createElement(TabBar, { repoId: 'repository:1' }));
  expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
  expect(html.match(/tabindex="0"/g)).toHaveLength(1);
  expect(html.indexOf('aria-selected="true"')).toBeGreaterThan(html.indexOf('Agents'));
});
