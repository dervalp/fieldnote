import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import Landing from './page';

// The routing contract. The page takes no session into account at all: /
// is the website, for everyone.
test('renders the pitch with no session lookup of any kind', async () => {
  const html = renderToStaticMarkup(await Landing());
  expect(html).toContain('Get your ultimate harness.');
  expect(html).toContain('Agent readiness, graded out of 100');
});

// layout.tsx renders a skip link pointing at #main-content, and this page
// supplies no AppShell to provide one. Without this the skip link is a link to
// nowhere on the site's front door.
test('supplies the <main id="main-content"> the root layout skip link targets', async () => {
  const html = renderToStaticMarkup(await Landing());
  expect(html).toContain('id="main-content"');
  expect(html).toMatch(/<main[^>]*id="main-content"/);
});

test('both calls to action go to GitHub sign-in, and no other auth surface', async () => {
  const html = renderToStaticMarkup(await Landing());
  expect(html).toContain('href="/api/auth/login"');
  const hrefs = [...html.matchAll(/href="(\/[^"]*)"/g)].map((match) => match[1]);
  const internal = hrefs.filter((href) => !href.startsWith('/#'));
  expect(new Set(internal)).toEqual(new Set(['/', '/api/auth/login']));
});

test('renders every section, in the order the design settled on', async () => {
  const html = renderToStaticMarkup(await Landing());
  const order = ['ladder', 'rubric', 'how', 'measures', 'guarantees', 'self-host'].map((id) =>
    html.indexOf(`id="${id}"`),
  );
  expect(order.every((position) => position > -1)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

// Everything meant to be read is visible at rest. A section parked at
// opacity: 0 waiting on a scroll observer is invisible to anything that does
// not run the observer, which includes a reader who has disabled JavaScript.
test('parks no content behind a scroll observer', async () => {
  const html = renderToStaticMarkup(await Landing());
  expect(html).not.toMatch(/opacity:\s*0\b/);
});

// The hero animates, and the rest of this block is about what that costs when
// the animation never runs. The server renders the frame HeroClimb starts on,
// and every one of these assertions describes that frame.

test('keeps the tagline as the headline, whether or not the climb ever plays', async () => {
  const html = renderToStaticMarkup(await Landing());
  expect(html).toMatch(/<h1[^>]*>Get your ultimate harness\.<\/h1>/);
});

test('names all three beats at rest, not just the one the climb starts on', async () => {
  const html = renderToStaticMarkup(await Landing());
  for (const beat of ['Self-monitor.', 'Self-act.', 'Self-train.']) {
    expect(html).toContain(beat);
  }
});

// A hero whose card is blank until JavaScript fills it in is a hero that is
// blank to a crawler. It rests on a real grade, with a real tier on it.
test('rests the hero card on a grade the rubric can actually issue', async () => {
  const html = renderToStaticMarkup(await Landing());
  expect(html).toContain('data-finish="shimmer"');
  expect(html).toContain('Improving');
  expect(html).toContain('Shimmer · Light holo');
});
