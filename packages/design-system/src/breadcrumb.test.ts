import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { Breadcrumb } from './breadcrumb';

const trail = [
  { label: 'Personal workspace', href: '/dashboard' },
  { label: 'All repositories', href: '/repos' },
  { label: 'fieldnote' },
];
const render = () => renderToStaticMarkup(createElement(Breadcrumb, { trail }));

test('the last crumb is where you are, so it is current and not a link', () => {
  const html = render();
  expect(html).toContain('aria-current="page"');
  expect(html).not.toContain('href="/repos/fieldnote"');
  expect(html.match(/<a /g)).toHaveLength(2);
});

test('separators are decorative and never announced', () => {
  const html = render();
  expect(html.match(/aria-hidden="true"/g)).toHaveLength(2);
});

test('it is a labelled landmark', () => {
  expect(render()).toContain('aria-label="Breadcrumb"');
});

test('a one-item trail renders without a separator', () => {
  const html = renderToStaticMarkup(
    createElement(Breadcrumb, { trail: [{ label: 'Overview' }] }),
  );
  expect(html).not.toContain('aria-hidden="true"');
  expect(html).toContain('aria-current="page"');
});

test('a non-last crumb with no href is plain text, not the current page', () => {
  // Only position (last vs. not) may decide aria-current — never whether an
  // href happens to be present. A middle crumb without an href must not be
  // mistaken for "where you are".
  const html = renderToStaticMarkup(
    createElement(Breadcrumb, {
      trail: [{ label: 'Workspace' }, { label: 'All repositories', href: '/repos' }, { label: 'fieldnote' }],
    }),
  );
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).not.toContain('<a href="/repos">fieldnote</a>');
});
