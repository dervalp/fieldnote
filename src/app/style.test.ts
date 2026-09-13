import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The palette exists in exactly one place: the token tier in
// @fieldnote/design-system. A hex here means a colour the marketing page and
// the product can disagree about, which is the drift this whole extraction
// exists to prevent — and it is the kind of drift review misses, because a
// duplicated hex looks right until someone changes one of the two.
describe('src/app/style.css', () => {
  it('holds no colour literal, so the palette exists in exactly one place', () => {
    const css = readFileSync('src/app/style.css', 'utf8');
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });

  it('names no colour function either, which is the same duplication spelled differently', () => {
    const css = readFileSync('src/app/style.css', 'utf8');
    expect(css.match(/\b(?:rgba?|hsla?|oklch|lab)\(/g) ?? []).toEqual([]);
  });

  // `color: white` is a colour literal wearing a friendlier name, and it is the
  // one the hex guard above would wave straight through. `transparent` and
  // `currentColor` are not colours in this sense — they name a relationship.
  it('names no bare colour keyword, which the hex guard would let through', () => {
    const css = readFileSync('src/app/style.css', 'utf8');
    const keywords =
      /(?:^|[:\s,(])(white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|brown|pink)(?=[;\s,)])/gi;
    expect([...css.matchAll(keywords)].map((match) => match[1])).toEqual([]);
  });

  it('no bare element selector in style.css sets layout', () => {
    const css = readFileSync('src/app/style.css', 'utf8');
    // A bare element selector at the start of a line, e.g. `nav {` or `section {`
    // — at any indent, and whether alone or as the first of a grouped selector
    // list (`section, .foo {`). These land on every matching element in the
    // app: the `nav { display: grid }` written for the sidebar is what
    // stacked the repository breadcrumb onto three rows. An anchor at column
    // 0 alone would miss the ones tucked inside a `@media`/`@supports` block —
    // that's a false pass, not a clean stylesheet. Element defaults belong in
    // the package's fn.base layer.
    const bare = [...css.matchAll(/^\s*(nav|section|button|input|label|main)\s*(,[^{]*)?\{/gm)].map(
      (match) => match[1],
    );
    expect(bare).toEqual([]);
  });
});
