import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { Brand } from './brand';

const render = (props: Parameters<typeof Brand>[0]) =>
  renderToStaticMarkup(createElement(Brand, props));

test('the sidebar lockup is one row and the marketing lockup is not', () => {
  expect(render({ size: 'compact' })).toContain('brand brand-compact');
  expect(render({ size: 'display' })).not.toContain('brand-compact');
});

test('display is the default, so the landing page nav needs no prop', () => {
  expect(render({})).not.toContain('brand-compact');
});

test('both sizes keep the accessible name and the seal', () => {
  for (const size of ['compact', 'display'] as const) {
    const html = render({ size });
    expect(html).toContain('aria-label="Fieldnote home"');
    expect(html).toContain('fieldnote');
    expect(html).toContain('<svg');
  }
});

test('the phone-width lockup rules do not restack the compact sidebar variant', () => {
  const css = readFileSync('packages/design-system/styles/components.css', 'utf8');

  // Pull out the `@media (max-width: 650px)` block by its unindented closing
  // brace, so we assert against exactly the rules that apply below 650px.
  const media = css.match(/@media \(max-width: 650px\) \{[\s\S]*?\n\}/);
  expect(media).not.toBeNull();
  const block = media![0];

  // None of the phone-width rules may open with a bare `.brand` selector (one
  // not followed by a compound `:not(...)` scope) — a bare selector restacks
  // the compact sidebar lockup too, which is the bug this test guards against.
  expect(block).not.toMatch(/^\s*\.brand(?:-mark|-name|-caption)?\s*[,{]/m);

  // Every phone-width rule must instead be scoped off the compact variant.
  expect(block).toContain('.brand:not(.brand-compact) {');
  expect(block).toContain('.brand:not(.brand-compact) .brand-mark {');
  expect(block).toContain('.brand:not(.brand-compact) .brand-name {');
  expect(block).toContain('.brand:not(.brand-compact) .brand-caption {');
});
