import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { GraderStateLine } from './grader-state';

const render = (verifiedAt: Date | null, withdrawnAt: Date | null) =>
  renderToStaticMarkup(createElement(GraderStateLine, { verifiedAt, withdrawnAt }));

test('a verified version names fieldnote and the date it was read, not that it is correct', () => {
  const html = render(new Date('2026-09-15'), null);
  expect(html).toContain('Read by fieldnote on 2026-09-15');
  expect(html).not.toContain('Not reviewed');
  expect(html).not.toContain('Withdrawn');
});

test('a withdrawn, never-verified version says so', () => {
  const html = render(null, new Date('2026-09-10'));
  expect(html).toContain('Withdrawn');
  expect(html).not.toContain('Read by fieldnote');
  expect(html).not.toContain('Not reviewed');
});

test('neither verified nor withdrawn says not reviewed', () => {
  const html = render(null, null);
  expect(html).toContain('Not reviewed');
  expect(html).not.toContain('Read by fieldnote');
  expect(html).not.toContain('Withdrawn');
});

// The two facts are not mutually exclusive: a person having read it stays
// true even after a later withdrawal, and a workspace still running that
// version needs both — that it was reviewed, and that it is withdrawn now.
test('a version that is both verified and withdrawn says both', () => {
  const html = render(new Date('2026-09-01'), new Date('2026-09-10'));
  expect(html).toContain('Read by fieldnote on 2026-09-01');
  expect(html).toContain('Withdrawn');
  expect(html).not.toContain('Not reviewed');
});
