import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { TopBar } from './top-bar';

const render = () =>
  renderToStaticMarkup(
    h(
      TopBar,
      null,
      h(TopBar.Context, null, 'where you are'),
      h(TopBar.Utility, null),
      h(TopBar.Identity, null, 'account'),
    ),
  );

test('identity is last in the DOM, so it is last to the keyboard too', () => {
  const html = render();
  expect(html.indexOf('fn-topbar__context')).toBeLessThan(html.indexOf('fn-topbar__utility'));
  expect(html.indexOf('fn-topbar__utility')).toBeLessThan(html.indexOf('fn-topbar__identity'));
});

test('an empty utility slot renders no control', () => {
  // Search and notifications are reserved, not built. The slot holds the
  // position; it must not ship a placeholder, a disabled button or an icon.
  const html = render();
  expect(html).not.toContain('<button');
  expect(html).not.toContain('<input');
});

test('the bar is a header element with no landmark role', () => {
  // <header> nested inside <main> (as app-shell.tsx places it) is correctly
  // generic and carries no implicit or explicit landmark role. An explicit
  // role="banner" here would violate landmark structure (axe rule
  // landmark-banner-is-top-level), since banner must be top-level.
  const html = render();
  const openTag = html.match(/^<header[^>]*>/);
  expect(openTag).not.toBeNull();
  expect(openTag![0]).not.toContain('role=');
});
