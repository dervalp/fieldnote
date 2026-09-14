# Application Shell Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The fieldnote application shell reads as an application rather than a website — a one-row brand lockup, a dense sidebar, a 48 px topbar with named slots that search and notifications can later fill, a breadcrumb that is not broken, buttons with a considered finish, and a content column that runs edge to edge.

**Architecture:** Every change lands in `@fieldnote/design-system` or in the shell components that consume it, never as a local override. The shell keeps its structure in `src/components/` — `AppShell`, `Sidebar`, `Brand` — and takes all of its spacing, colour and elevation from the package's semantic tokens. The topbar replaces `.page-topline` with three named compound slots, and the breadcrumb is rendered by each section layout into the slot the topbar reserves, because `AppShell` sits above the route segment and cannot read a repository name.

**Tech Stack:** TypeScript, Next.js 16 (App Router), React 19, plain CSS with `@layer` (no Tailwind, no CSS-in-JS), Vitest with `renderToStaticMarkup`.

**Spec:** `docs/superpowers/specs/2026-09-12-landing-page-and-design-system-design.md` — specifically the section **"Amendment 2026-09-13: the application shell density pass"**. Read the amendment and the sections it references before starting.

**Approved visual baseline:** `docs/design/fieldnote/README.md`

**Design review artifact (before/after, seven tabs):** https://claude.ai/code/artifact/67761d7d-a1b3-4161-8732-d1e0ec38801e

**Prerequisite plan:** `docs/superpowers/plans/2026-09-12-landing-page-and-design-system.md`. Its **Tasks 1–3** must be complete and merged before Task 1 here begins. This plan consumes `@fieldnote/design-system`, its tokens, and its `Button` and `Brand` primitives.

---

## Global Constraints

- **No new hue and no new typeface.** Pine & Mist, Original Ember `#BE421F`, Georgia display, Arial interface. Every gradient stop is derived from the approved ember and lives in the token layer. Introducing a palette colour is a review rejection.
- **Spacing and layout structure inside the shell are deliberately redesigned.** The prior plan's "pixel or two" constraint applies to page *bodies* only. Do not treat a shell spacing change as a migration bug.
- **Page bodies below the tab bar do not change.** This plan touches the shell and the button. If a diff reaches into one of the five repository views, the boundary was drawn wrong.
- **The package imports nothing from `src/`.** No data fetching, no `next/navigation`, no session, no database, no domain types.
- **Search and notifications are reserved, not built.** `TopBar.Utility` renders its children and this plan passes it none. Do not add a search input or a bell.
- **No local override.** A shell rule that wants a colour, a radius, a shadow or a space step reads a token. A hex literal outside `tokens.css` is a review rejection — `src/app/style.test.ts` from the prior plan enforces it.
- **No new dependency.**
- **`pnpm check` must pass before the final commit of each task.**
- End every commit message with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## Vocabulary you must not get wrong

- The **shell** is `AppShell`, `Sidebar`, `Brand`, `WorkspaceSwitcher`, `AccountMenu` and the new `TopBar`. Everything a route renders inside it is a **page body**.
- A **slot** is one of `TopBar.Context`, `TopBar.Utility`, `TopBar.Identity`. Slots are compound components, not props.
- The **crumb** is the breadcrumb. Today's `.crumb` in `src/components/repository/header.tsx` is being removed, not restyled — the topbar takes over the job.
- **Reserved** means the slot exists and is empty. It does not mean a disabled control is rendered.
- A **finish** is a grade-card foil. Nothing in this plan touches finishes. Do not confuse "button finish" with a grade finish; say "button treatment" if it helps.

---

## Amendments to the prior plan

These change tasks in `2026-09-12-landing-page-and-design-system.md`. Apply them **while executing that plan**, so today's values are never written and then immediately replaced. If that plan has already been executed as written, Task 1 below repairs the difference.

**Prior Task 1 (tokens)** — write these values rather than today's:

| Token | Prior value | Amended value |
| --- | --- | --- |
| `--fn-space-4` | `16px` | `16px` (unchanged; the sidebar now uses it) |

and **add** these to the semantic tier:

```css
--fn-color-surface-selected: #dbe5dc;
--fn-color-accent-edge: #9e3518;
--fn-elevation-control:
  inset 0 1px 0 rgb(255 255 255 / 0.22),
  0 1px 1px rgb(32 63 54 / 0.14),
  0 2px 7px rgb(190 66 31 / 0.22);
--fn-elevation-control-press:
  inset 0 1px 2px rgb(90 26 10 / 0.4),
  0 1px 0 rgb(255 255 255 / 0.3);
--fn-elevation-control-quiet:
  inset 0 1px 0 #fff,
  0 1px 1px rgb(32 63 54 / 0.07),
  0 2px 5px rgb(32 63 54 / 0.06);
--fn-gradient-accent: linear-gradient(180deg, #cb4a26 0%, #be421f 52%, #ad3a1a 100%);
--fn-gradient-accent-hover: linear-gradient(180deg, #d4522c 0%, #c5471f 52%, #b23d1a 100%);
--fn-gradient-accent-press: linear-gradient(180deg, #ad3a1a 0%, #b83f1d 100%);
--fn-gradient-quiet: linear-gradient(180deg, #fdfefc 0%, #eef3ec 100%);
--fn-color-quiet-edge: #b9cabe;
--fn-color-on-accent: #fff;
```

**Prior Task 3 (primitives)** — three interface changes:

- `Button` is built to the treatment in Task 5 below, not to today's flat fill.
- `Button` gains `as?: 'button' | 'a'`, defaulting to `'button'`. The repository header's "GitHub ↗" is genuinely a link and must not be a `<button>`; with `as="a"` the component spreads `AnchorHTMLAttributes` instead. Without this the call site in Task 5 cannot be written.
- `Brand` takes `size?: 'compact' | 'display'`, defaulting to `'display'`.

**The package does not import `next/link`.** The prior plan settled this for `Brand`: package components render a plain `<a>`, and callers that need client navigation wrap them. `Breadcrumb` in Task 4 follows that precedent — a full navigation on a breadcrumb click is the accepted cost of the boundary, and changing the rule for one component would leave the package with two link policies.

**Prior Task 1, a defect to fix while you are there:** `vitest.config.ts` includes only `src/**/*.test.ts`, so `packages/design-system/boundary.test.ts` would never run. Widen the include to `['src/**/*.test.ts', 'packages/**/*.test.ts']`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/design-system/styles/tokens.css` *(modify)* | The control and gradient tokens above. |
| `packages/design-system/src/brand.tsx` *(modify)* | `size` prop; `compact` is the sidebar row. |
| `packages/design-system/styles/components.css` *(modify)* | `.fn-brand--compact`, `.fn-button` treatment. |
| `packages/design-system/src/top-bar.tsx` | `TopBar` plus its three slot components. Presentational, no routing. |
| `packages/design-system/styles/components/top-bar.css` | The 48 px bar and its slots. |
| `packages/design-system/src/breadcrumb.tsx` | `Breadcrumb` — takes a trail, renders one row. |
| `packages/design-system/src/top-bar.test.ts` | Slot order and the 48 px contract. |
| `packages/design-system/src/breadcrumb.test.ts` | One row; last item is current and unlinked. |
| `src/components/app-shell.tsx` *(modify)* | Renders `TopBar`; takes a `context` node from the section layout. |
| `src/components/app-shell.test.ts` | Shell renders the crumb it is handed, into the context slot. |
| `src/components/sidebar.tsx` *(modify)* | `Brand size="compact"`; markup otherwise unchanged. |
| `src/components/repository/header.tsx` *(modify)* | The `.crumb` nav is removed. |
| `src/app/repos/[repoId]/layout.tsx` *(modify)* | Supplies the repository crumb trail. |
| `src/app/{dashboard,repos,prs,settings,onboarding}/layout.tsx` *(modify)* | Each supplies its own trail. |
| `src/app/style.css` *(modify)* | Scope `nav`; strip `main` padding and the left fade; delete `.page-topline`. |
| `src/app/style.test.ts` *(modify)* | Add the bare-selector guard. |

---

### Task 1: Control tokens and the bare-selector guard

The tokens every later task reads, and the test that stops the breadcrumb bug recurring. Nothing looks different yet.

**Files:**
- Modify: `packages/design-system/styles/tokens.css`, `vitest.config.ts`
- Modify: `src/app/style.test.ts`

**Interfaces:**
- Produces: the ten tokens listed under "Amendments to the prior plan" — `--fn-color-surface-selected`, `--fn-color-accent-edge`, `--fn-elevation-control`, `--fn-elevation-control-press`, `--fn-elevation-control-quiet`, `--fn-gradient-accent`, `--fn-gradient-accent-hover`, `--fn-gradient-accent-press`, `--fn-gradient-quiet`, `--fn-color-quiet-edge`.

Background you need: `src/app/style.test.ts` already exists from the prior plan and asserts `style.css` contains no colour literal. It reads the file as text — it does not parse CSS, and it does not need to. Follow that shape.

- [ ] **Step 1: Write the failing guard test**

Append to `src/app/style.test.ts`:

```ts
test('no bare element selector in style.css sets layout', () => {
  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
  // A bare element selector at the start of a line, e.g. `nav {` or `section {`.
  // These land on every matching element in the app: the `nav { display: grid }`
  // written for the sidebar is what stacked the repository breadcrumb onto
  // three rows. Element defaults belong in the package's fn.base layer.
  const bare = [...css.matchAll(/^(nav|section|button|input|label|main)\s*\{/gm)].map(
    (match) => match[1],
  );
  expect(bare).toEqual([]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/app/style.test.ts`
Expected: FAIL. The received array lists the bare selectors still in the file — `nav`, `section`, `button`, `input`, `label` and `main` at the time of writing. Task 6 and Task 7 are what empty it; leaving it red here is deliberate and you will not commit it red.

- [ ] **Step 3: Skip the guard until its tasks land**

Change `test(` to `test.skip(` and add the line above it:

```ts
// Unskipped by Task 7 of docs/superpowers/plans/2026-09-13-application-shell-density.md,
// once `main` and `nav` are scoped and the shell rules move into the package.
```

- [ ] **Step 4: Add the control tokens**

Append to the semantic tier in `packages/design-system/styles/tokens.css` the ten declarations given verbatim under "Amendments to the prior plan". Add this comment above them:

```css
/* Control finish. Every stop is the approved ember lit from above — a lighting
   cue, not a second hue. #be421f remains the midpoint of the resting gradient,
   which is what keeps the amended buttons the same colour as the old flat ones. */
```

- [ ] **Step 5: Widen the vitest include so package tests run**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'packages/**/*.test.ts'], testTimeout: 15000 },
});
```

- [ ] **Step 6: Prove the package suite now runs**

Run: `pnpm vitest run packages/design-system/boundary.test.ts`
Expected: PASS, and the reporter names the file rather than reporting "No test files found".

- [ ] **Step 7: `pnpm check`, then commit**

```bash
git add packages/design-system/styles/tokens.css vitest.config.ts src/app/style.test.ts
git commit -m "feat(design-system): control finish tokens and a bare-selector guard"
```

---

### Task 2: The compact brand lockup

**Files:**
- Modify: `packages/design-system/src/brand.tsx`, `packages/design-system/styles/components.css`
- Modify: `src/components/sidebar.tsx`
- Test: `packages/design-system/src/brand.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `Brand({ href?: string; size?: 'compact' | 'display' })`. `size` defaults to `'display'`. `compact` emits `class="fn-brand fn-brand--compact"`; `display` emits `class="fn-brand"`.

Background you need: `Brand` renders a `<Link>` wrapping an inline SVG (the Field Lines seal, three stroked paths) and a `<span class="brand-name">`. The landing page nav and `/signed-out` want the stacked lockup — that is why this is a variant and not a replacement.

- [ ] **Step 1: Write the failing test**

`packages/design-system/src/brand.test.ts`:

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { Brand } from './brand';

const render = (props: Parameters<typeof Brand>[0]) =>
  renderToStaticMarkup(createElement(Brand, props));

test('the sidebar lockup is one row and the marketing lockup is not', () => {
  expect(render({ size: 'compact' })).toContain('fn-brand fn-brand--compact');
  expect(render({ size: 'display' })).not.toContain('fn-brand--compact');
});

test('display is the default, so the landing page nav needs no prop', () => {
  expect(render({})).not.toContain('fn-brand--compact');
});

test('both sizes keep the accessible name and the seal', () => {
  for (const size of ['compact', 'display'] as const) {
    const html = render({ size });
    expect(html).toContain('aria-label="Fieldnote home"');
    expect(html).toContain('fieldnote');
    expect(html).toContain('<svg');
  }
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm vitest run packages/design-system/src/brand.test.ts`
Expected: FAIL — `Brand` does not accept `size`, so `fn-brand--compact` never appears.

- [ ] **Step 3: Add the variant**

In `packages/design-system/src/brand.tsx`, change the signature and the className only. Leave the SVG untouched:

```tsx
export function Brand({
  href = '/dashboard',
  size = 'display',
}: {
  href?: string;
  size?: 'compact' | 'display';
}) {
  return (
    <a
      className={size === 'compact' ? 'fn-brand fn-brand--compact' : 'fn-brand'}
      href={href}
      aria-label="Fieldnote home"
    >
      {/* seal unchanged */}
    </a>
  );
}
```

The plain `<a>` is not a regression introduced here — the prior plan's Task 3 already moved `Brand` off `next/link` when it entered the package.

- [ ] **Step 4: Style the variant**

In `packages/design-system/styles/components.css`, under the existing `.fn-brand` rules:

```css
/* The stacked lockup is a marketing lockup: correct for the landing page nav,
   and 94px of vertical space in a sidebar that has two navigation items. */
.fn-brand--compact {
  flex-direction: row;
  align-items: center;
  gap: var(--fn-space-2);
  margin-bottom: var(--fn-space-4);
  padding: var(--fn-space-1) var(--fn-space-2);
}
.fn-brand--compact .fn-brand__mark {
  width: 26px;
  height: 26px;
  margin-bottom: 0;
}
.fn-brand--compact .fn-brand__word {
  font-size: 21px;
  letter-spacing: -0.7px;
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `pnpm vitest run packages/design-system/src/brand.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Point the sidebar at it**

In `src/components/sidebar.tsx`, change `<Brand />` to `<Brand size="compact" />`. Nothing else in that file changes in this task.

- [ ] **Step 7: `pnpm check`, then commit**

```bash
git add packages/design-system/src/brand.tsx packages/design-system/src/brand.test.ts \
        packages/design-system/styles/components.css src/components/sidebar.tsx
git commit -m "feat(design-system): a compact brand lockup for the sidebar"
```

---

### Task 3: Sidebar density

**Files:**
- Modify: `packages/design-system/styles/components.css` (or the shell stylesheet the prior plan created for `.sidebar`)
- Test: `src/components/sidebar.test.ts` (existing — add one case)

**Interfaces:**
- Consumes: `--fn-color-surface-selected` and `--fn-space-1`/`--fn-space-3`/`--fn-space-4` from Task 1.
- Produces: no new export. The active navigation item is identified by `aria-current="page"`, as it already is.

Background you need: `src/components/sidebar.test.ts` exists and asserts navigation hrefs and the retained date range. It mocks `next/navigation` and `./workspace-switcher`. Extend it; do not rewrite it.

- [ ] **Step 1: Write the failing test**

Append to `src/components/sidebar.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and verify it passes for the right reason**

Run: `pnpm vitest run src/components/sidebar.test.ts`
Expected: PASS. This one is a characterisation test — it passes now and its job is to *stay* passing while you change the CSS. Confirm it fails if you add `className="active"` to the active `<Link>`, then remove that.

- [ ] **Step 3: Tighten the rhythm**

Replace the `.sidebar`, `.sidebar nav` and nav-item rules:

```css
.sidebar {
  padding: var(--fn-space-4) var(--fn-space-3);
}
.sidebar nav {
  display: grid;
  gap: var(--fn-space-1);
}
.sidebar nav a {
  display: flex;
  align-items: baseline;
  gap: var(--fn-space-2);
  padding: 7px var(--fn-space-3);
  border-radius: var(--fn-radius-md);
  text-decoration: none;
  font-size: 13px;
}
/* At 30px rows a 2px rule is no longer enough signal on its own. */
.sidebar nav a[aria-current='page'] {
  background: var(--fn-color-surface-selected);
  box-shadow: inset 2px 0 0 var(--fn-color-accent);
  font-weight: 700;
}
```

- [ ] **Step 4: Lift the switcher and settle the footer**

```css
.workspace-switcher {
  margin-bottom: var(--fn-space-3);
}
.workspace-switcher > .eyebrow {
  display: block;
  margin-bottom: 6px;
  padding-left: var(--fn-space-2);
}
.shell-menu > button {
  min-height: 36px;
  padding: 6px var(--fn-space-2);
  border-radius: var(--fn-radius-md);
}
.sidebar-footer {
  padding-top: var(--fn-space-5);
  font-size: 10.5px;
}
```

Note the `.shell-menu > button` rule is shared with the account menu trigger, which is intended — both are shell menu triggers and should keep one height.

- [ ] **Step 5: Verify the target**

Run `pnpm dev:demo`, open `/dashboard`, and measure in the browser's element inspector: the top of `.workspace-switcher` sits **within 70 px** of the top of `.sidebar`. Record the measured number in the commit body.

- [ ] **Step 6: `pnpm check`, then commit**

```bash
git add packages/design-system/styles/components.css src/components/sidebar.test.ts
git commit -m "feat(shell): application spacing in the sidebar"
```

---

### Task 4: The topbar and its three slots

The structural change. Build the primitive and its slots against tests, with no consumer yet — Task 6 wires it in.

**Files:**
- Create: `packages/design-system/src/top-bar.tsx`, `packages/design-system/styles/components/top-bar.css`
- Create: `packages/design-system/src/breadcrumb.tsx`
- Modify: `packages/design-system/src/index.ts`, `packages/design-system/styles/components.css`
- Test: `packages/design-system/src/top-bar.test.ts`, `packages/design-system/src/breadcrumb.test.ts`

**Interfaces:**
- Produces:
  - `TopBar({ children }: { children: React.ReactNode })`
  - `TopBar.Context({ children })`, `TopBar.Utility({ children })`, `TopBar.Identity({ children })`
  - `Breadcrumb({ trail }: { trail: Crumb[] })` where `type Crumb = { label: string; href?: string }`
- Later tasks rely on exactly these names. `AppShell` imports `TopBar` and each section layout imports `Breadcrumb` and the `Crumb` type.

- [ ] **Step 1: Write the failing breadcrumb test**

`packages/design-system/src/breadcrumb.test.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing topbar test**

`packages/design-system/src/top-bar.test.ts`:

```ts
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

test('the bar is a banner landmark', () => {
  expect(render()).toContain('role="banner"');
});
```

- [ ] **Step 3: Run both and verify they fail**

Run: `pnpm vitest run packages/design-system/src/breadcrumb.test.ts packages/design-system/src/top-bar.test.ts`
Expected: FAIL with "Failed to resolve import './breadcrumb'" and the same for `./top-bar`.

- [ ] **Step 4: Write the breadcrumb**

`packages/design-system/src/breadcrumb.tsx`:

```tsx
export type Crumb = { label: string; href?: string };

// Presentational, and — like every component in this package — it renders a
// plain <a> rather than importing next/link. The trail comes from the section
// layout, which is the only place that knows the repository's name: AppShell
// renders above the route segment and cannot read it.
export function Breadcrumb({ trail }: { trail: Crumb[] }) {
  return (
    <nav className="fn-crumb" aria-label="Breadcrumb">
      {trail.map((crumb, index) => (
        <span key={`${crumb.label}-${index}`} className="fn-crumb__item">
          {index > 0 && (
            <span className="fn-crumb__sep" aria-hidden="true">
              /
            </span>
          )}
          {crumb.href && index < trail.length - 1 ? (
            <a href={crumb.href}>{crumb.label}</a>
          ) : (
            <span aria-current="page">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
```

- [ ] **Step 5: Write the topbar**

`packages/design-system/src/top-bar.tsx`:

```tsx
// Three named slots, each with a rule about what belongs in it. A control added
// later is a child of one slot, not an append to a flex row — which is the
// difference between this and the .page-topline it replaces.
function Context({ children }: { children?: React.ReactNode }) {
  return <div className="fn-topbar__context">{children}</div>;
}
function Utility({ children }: { children?: React.ReactNode }) {
  return <div className="fn-topbar__utility">{children}</div>;
}
function Identity({ children }: { children?: React.ReactNode }) {
  return <div className="fn-topbar__identity">{children}</div>;
}

export function TopBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fn-topbar" role="banner">
      {children}
    </div>
  );
}
TopBar.Context = Context;
TopBar.Utility = Utility;
TopBar.Identity = Identity;
```

- [ ] **Step 6: Style them**

`packages/design-system/styles/components/top-bar.css`:

```css
.fn-topbar {
  position: sticky;
  top: 0;
  z-index: 30;
  height: 48px;
  display: flex;
  align-items: center;
  gap: var(--fn-space-3);
  padding: 0 var(--fn-space-4) 0 var(--fn-space-5);
  background: var(--fn-color-surface-glass);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--fn-color-border);
}
.fn-topbar__context {
  min-width: 0;
  flex: 1;
}
/* Reserved for search, then notifications. Empty by design. */
.fn-topbar__utility {
  display: flex;
  align-items: center;
  gap: var(--fn-space-2);
}
.fn-topbar__identity {
  display: flex;
  align-items: center;
  flex: none;
}
.fn-topbar__utility:not(:empty) + .fn-topbar__identity {
  border-left: 1px solid var(--fn-color-border);
  margin-left: var(--fn-space-1);
  padding-left: var(--fn-space-3);
}
.fn-crumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0 var(--fn-space-2);
  font-size: var(--fn-text-detail);
  color: var(--fn-color-ink-muted);
}
.fn-crumb__item {
  display: inline-flex;
  align-items: center;
  gap: var(--fn-space-2);
  min-width: 0;
}
.fn-crumb__sep {
  opacity: 0.5;
}
.fn-crumb [aria-current='page'] {
  color: var(--fn-color-ink);
  font-weight: 700;
}
```

Import it from `components.css`, in the file's existing import order.

- [ ] **Step 7: Export both**

In `packages/design-system/src/index.ts`:

```ts
export { TopBar } from './top-bar';
export { Breadcrumb, type Crumb } from './breadcrumb';
```

- [ ] **Step 8: Run both suites and verify they pass**

Run: `pnpm vitest run packages/design-system/src/breadcrumb.test.ts packages/design-system/src/top-bar.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 9: `pnpm check`, then commit**

```bash
git add packages/design-system/src/top-bar.tsx packages/design-system/src/breadcrumb.tsx \
        packages/design-system/src/top-bar.test.ts packages/design-system/src/breadcrumb.test.ts \
        packages/design-system/styles/components/top-bar.css \
        packages/design-system/styles/components.css packages/design-system/src/index.ts
git commit -m "feat(design-system): a topbar with three named slots"
```

---

### Task 5: The button treatment

**Files:**
- Modify: `packages/design-system/styles/components.css`
- Modify: `src/components/repository/header.css`, `src/app/style.css`
- Test: `packages/design-system/src/button.test.ts` (existing from prior Task 3 — add cases)

**Interfaces:**
- Consumes: the gradient and elevation tokens from Task 1.
- Produces: no signature change. `Button` keeps its `variant` prop from the prior plan — `accent` (default), `secondary`, `quiet`.

Background you need: buttons are defined in roughly ten places today — a bare `button` rule in `style.css`, `.btn` and `.btn.ghost` in `header.css`, plus local overrides under `.onboarding-panel`, `.metrics-page`, `.settings-form` and `.member-controls`, and the two shell-menu surfaces. The prior plan's `Button` primitive is what collapses them. This task gives that primitive its treatment and deletes the overrides it makes redundant.

- [ ] **Step 1: Write the failing test**

Append to `packages/design-system/src/button.test.ts`:

```ts
test('every variant takes its finish from tokens, never a literal', () => {
  const css = readFileSync(
    new URL('../styles/components.css', import.meta.url),
    'utf8',
  );
  const button = css.slice(css.indexOf('.fn-button'));
  // A hex in a component rule is how ten button definitions happened the
  // first time. The finish lives in tokens.css or it drifts.
  expect(button).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  expect(button).toContain('var(--fn-gradient-accent)');
  expect(button).toContain('var(--fn-elevation-control)');
});

test('the press state is not animated for readers who asked for stillness', () => {
  const css = readFileSync(
    new URL('../styles/components.css', import.meta.url),
    'utf8',
  );
  expect(css).toContain('prefers-reduced-motion: reduce');
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm vitest run packages/design-system/src/button.test.ts`
Expected: FAIL — the flat `.fn-button` rule contains no `--fn-gradient-accent`.

- [ ] **Step 3: Write the treatment**

Replace the `.fn-button` rules in `packages/design-system/styles/components.css`:

```css
/* The gradient spans 18% lightness, not 40%: one hue lit from above, with no
   glow and no saturation shift across the stops. The press state inverting the
   highlight into an inset shadow is the part that reads as quality. */
.fn-button {
  display: inline-flex;
  align-items: center;
  gap: var(--fn-space-2);
  padding: 8px var(--fn-space-4);
  border: 1px solid var(--fn-color-accent-edge);
  border-radius: var(--fn-radius-md);
  background: var(--fn-gradient-accent);
  box-shadow: var(--fn-elevation-control);
  color: var(--fn-color-on-accent);
  font: var(--fn-text-detail) var(--fn-font-ui);
  line-height: 1.4;
  text-decoration: none;
  text-shadow: 0 1px 0 rgb(90 26 10 / 0.28);
  cursor: pointer;
  transition:
    box-shadow 0.14s ease,
    translate 0.14s ease;
}
.fn-button:hover {
  background: var(--fn-gradient-accent-hover);
}
.fn-button:active {
  background: var(--fn-gradient-accent-press);
  box-shadow: var(--fn-elevation-control-press);
  translate: 0 1px;
}
.fn-button--secondary {
  background: var(--fn-gradient-quiet);
  border-color: var(--fn-color-quiet-edge);
  box-shadow: var(--fn-elevation-control-quiet);
  color: var(--fn-color-ink);
  text-shadow: none;
}
.fn-button--secondary:hover {
  border-color: var(--fn-color-accent);
  color: var(--fn-color-accent);
}
/* A text action does not gain a surface. */
.fn-button--quiet {
  background: none;
  border: 0;
  box-shadow: none;
  padding: 0;
  color: var(--fn-color-ink-muted);
  text-decoration: underline;
  text-underline-offset: 4px;
  text-shadow: none;
}
.fn-button--quiet:hover {
  color: var(--fn-color-accent);
}
@media (prefers-reduced-motion: reduce) {
  .fn-button {
    transition: none;
  }
  .fn-button:active {
    translate: none;
  }
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm vitest run packages/design-system/src/button.test.ts`
Expected: PASS.

- [ ] **Step 5: Delete the redundant definitions**

Remove from `src/components/repository/header.css`: the `.btn`, `.btn.ghost` and `.btn.ghost:hover` rules. Replace their two call sites in `src/components/repository/header.tsx`:

```tsx
<Button as="a" variant="secondary" href={githubRepositoryUrl(repo)}>
  GitHub ↗
</Button>
…
<Button>Refresh data</Button>
```

Remove the bare `button` and `.quiet-button` rules from `src/app/style.css`, and the local overrides under `.onboarding-panel button:disabled`, `.metrics-page button`, `.settings-form button`, `.settings-form button:hover`, `.settings-form button:disabled` and `.member-controls button`. Replace each call site with `<Button>`, carrying `disabled` through as it already is.

Leave `.shell-menu button` and `.shell-menu-options button` alone: those are menu rows, not buttons with a surface, and they are shell chrome rather than actions.

- [ ] **Step 6: Walk every call site**

Run `pnpm dev:demo` and visit, in order: `/dashboard`, `/repos`, a repository's Settings tab, `/settings/workspace`, `/onboarding`. Every action button shows the gradient; every menu row still looks like a menu row; no button lost its disabled state. Tab through each page and confirm the focus ring is still visible against the gradient.

- [ ] **Step 7: `pnpm check`, then commit**

```bash
git add packages/design-system/styles/components.css packages/design-system/styles/tokens.css \
        packages/design-system/src/button.test.ts src/components/repository/header.css \
        src/components/repository/header.tsx src/app/style.css
git commit -m "feat(design-system): one button treatment, replacing ten definitions"
```

---

### Task 6: Wire the topbar into the shell and fix the breadcrumb

**Files:**
- Modify: `src/components/app-shell.tsx`, `src/components/repository/header.tsx`, `src/app/style.css`
- Modify: `src/app/dashboard/layout.tsx`, `src/app/repos/layout.tsx`, `src/app/repos/[repoId]/layout.tsx`, `src/app/prs/layout.tsx`, `src/app/settings/layout.tsx`, `src/app/onboarding/layout.tsx`
- Test: `src/components/app-shell.test.ts`

**Interfaces:**
- Consumes: `TopBar`, `Breadcrumb` and `Crumb` from Task 4.
- Produces: `AppShell({ children, crumbs }: { children: React.ReactNode; crumbs?: Crumb[] })`. Every section layout passes `crumbs`; a layout that passes none gets the workspace name alone.

Background you need: `AppShell` is an async server component rendering `<Sidebar>` and `<main id="main-content" tabIndex={-1}>`. It is rendered by six section layouts. `layout.tsx` renders a skip link targeting `#main-content`, so that id and `tabIndex` must survive.

- [ ] **Step 1: Write the failing test**

`src/components/app-shell.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm vitest run src/components/app-shell.test.ts`
Expected: FAIL — `AppShell` takes no `crumbs` and renders `.page-topline`, so `fn-topbar__context` is absent.

- [ ] **Step 3: Rewrite the shell**

```tsx
import { TopBar, Breadcrumb, type Crumb } from '@fieldnote/design-system';
import { currentUser } from '../auth/session';
import { requireWorkspace } from '../workspaces/access';
import { listWorkspaces } from '../workspaces/store';
import { env } from '../lib/env';
import { Sidebar } from './sidebar';
import { AccountMenu } from './account-menu';

export async function AppShell({
  children,
  crumbs = [],
}: {
  children: React.ReactNode;
  crumbs?: Crumb[];
}) {
  const active = await requireWorkspace();
  const demo = env().DEMO_MODE === 'true';
  const user = demo ? { displayName: 'Demo visitor', login: 'demo' } : await currentUser();
  const choices = demo ? [active] : await listWorkspaces((await currentUser()).id);
  // The workspace is always the root of the trail; the section layout supplies
  // the rest, because it is the only thing that knows the repository's name.
  const trail: Crumb[] = [{ label: active.name, href: '/dashboard' }, ...crumbs];
  return (
    <div className="app-shell">
      <Sidebar active={active} workspaces={choices} demo={demo} />
      <main id="main-content" tabIndex={-1}>
        <TopBar>
          <TopBar.Context>
            <Breadcrumb trail={trail} />
          </TopBar.Context>
          <TopBar.Utility />
          <TopBar.Identity>
            <AccountMenu
              name={user.displayName ?? user.login}
              workspace={active.name}
              role={active.role}
              demo={demo}
            />
          </TopBar.Identity>
        </TopBar>
        <div className="page-body">{children}</div>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm vitest run src/components/app-shell.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Supply a trail from each layout**

`src/app/repos/layout.tsx` renders the `AppShell` for **both** `repos/page.tsx` and everything under `repos/[repoId]/`, so the repository layout currently sits *inside* a shell it cannot pass props to. Resolve that first, in this order:

1. Delete `src/app/repos/layout.tsx` entirely. It is three lines and does nothing but wrap.
2. In `src/app/repos/page.tsx`, wrap the returned markup in `<AppShell crumbs={[{ label: 'All repositories' }]}>`.
3. In `src/app/repos/[repoId]/layout.tsx`, wrap the existing `<div className="repo-layout">` in `<AppShell crumbs={…}>` using the trail below. That layout already loads `repo`, so it has the name.

A page rendering `AppShell` around its own content is the same composition the other four sections use from a layout; nothing about App Router requires the shell to live in a `layout.tsx`. The trails:

| Layout | `crumbs` |
| --- | --- |
| `dashboard/layout.tsx` | `[{ label: 'Overview' }]` |
| `repos/page.tsx` | `[{ label: 'All repositories' }]` |
| `repos/[repoId]/layout.tsx` | `[{ label: 'All repositories', href: '/repos' }, { label: repo.name }]` |
| `prs/layout.tsx` | `[{ label: 'Pull requests' }]` |
| `settings/layout.tsx` | `[{ label: 'Settings' }]` |
| `onboarding/layout.tsx` | `[{ label: 'Set up' }]` |

A client context that the page publishes a trail into was considered and declined: it adds client state to a server shell for a string the layout already holds.

- [ ] **Step 6: Remove the old crumb and topline**

Delete the `<nav className="crumb">` block from `src/components/repository/header.tsx`, and the `.crumb` and `.crumb a` rules from `src/components/repository/header.css`. Delete the `.page-topline` rule from `src/app/style.css`.

- [ ] **Step 7: Scope the sidebar's nav selector**

In `src/app/style.css`, the bare rule that broke the breadcrumb:

```css
/* Scoped: this was written for the sidebar and was landing on every nav in the
   app, including the repository breadcrumb, which it stacked onto three rows. */
.sidebar nav {
  display: grid;
  gap: var(--fn-space-1);
}
```

- [ ] **Step 8: See it**

Run `pnpm dev:demo`, open a repository page. The breadcrumb reads `Personal workspace / All repositories / fieldnote` on **one line**, inside the topbar. There is no second context line below it.

- [ ] **Step 9: `pnpm check`, then commit**

```bash
git rm src/app/repos/layout.tsx
git add src/components/app-shell.tsx src/components/app-shell.test.ts \
        src/components/repository/header.tsx src/components/repository/header.css \
        src/app/style.css src/app/*/layout.tsx src/app/repos/page.tsx \
        'src/app/repos/[repoId]/layout.tsx'
git commit -m "feat(shell): a topbar that owns the breadcrumb, fixing its stacking"
```

---

### Task 7: Full width, and close the guard

**Files:**
- Modify: `src/app/style.css`, `src/components/repository/header.css`, `src/components/repository/tab-bar.css`
- Modify: `src/app/style.test.ts`

**Interfaces:**
- Consumes: `.page-body`, rendered by `AppShell` in Task 6.

- [ ] **Step 1: Unskip the guard and watch it fail**

Remove `.skip` from the bare-selector test added in Task 1.

Run: `pnpm vitest run src/app/style.test.ts`
Expected: FAIL, listing whichever bare selectors remain — `main`, `section`, `input`, `label` at minimum.

- [ ] **Step 2: Take the padding and the fade off `main`**

```css
.app-shell main {
  min-width: 0;
  padding: 0 0 var(--fn-space-7);
  background:
    /* The removed first layer painted the sidebar's colour 48% of the way
       across this column. It was most of the gutter, and no amount of padding
       removal would have fixed it. */
    radial-gradient(ellipse at 8% 30%, var(--fn-color-atmosphere-cool) 0%, transparent 58%),
    radial-gradient(ellipse at 100% 78%, var(--fn-color-atmosphere-warm) 0%, transparent 57%),
    var(--fn-color-ground);
}
.page-body {
  padding: var(--fn-space-4) var(--fn-space-5) 0;
}
```

Add `--fn-color-atmosphere-cool: #c8ddce;` and `--fn-color-atmosphere-warm: #ecd3c3;` to the reference tier — both are existing values from `style.css`, not new colours.

- [ ] **Step 3: Scope the remaining bare selectors**

Each of the three is a different case. Do all three:

**`section`** — its rule sets `background`, `border-radius`, `padding`, `margin` and `box-shadow`. That is a card, not an element default. The prior plan's Task 3 already moved these declarations into `.fn-surface` and shipped a `Surface` primitive, so this step only deletes the bare rule and replaces the call sites:

```bash
grep -rn '<section' src/ --include='*.tsx'
```

Every hit becomes `<Surface>`, which renders `<section className="fn-surface">` by default. The `@supports (backdrop-filter: blur(16px))` block that follows the `section` rule moves with it, rewritten against `.fn-surface`.

**`input` and `label`** — these are genuine element defaults and belong in the package's `fn.base` layer, which the guard does not scan. Move them verbatim from `src/app/style.css` into `packages/design-system/styles/base.css`, swapping literals for tokens:

```css
input {
  padding: 9px;
  border: 1px solid var(--fn-color-border);
  border-radius: var(--fn-radius-sm);
  background: var(--fn-color-surface);
  accent-color: var(--fn-color-accent);
}
label {
  display: block;
}
```

The guard's job is to keep layout out of bare selectors in the *app* stylesheet. Element defaults in `fn.base` are the sanctioned home for exactly this, and the cascade layer is what stops them outranking a component rule the way the old `nav` rule did.

- [ ] **Step 4: Tighten the header rhythm**

In `src/components/repository/header.css`:

```css
.rhead {
  gap: var(--fn-space-3);
  margin-top: var(--fn-space-1);
}
.rhead-id h1 {
  font: 400 clamp(24px, 2.4vw, 30px) var(--fn-font-display);
  letter-spacing: -0.9px;
}
```

In `src/components/repository/tab-bar.css`:

```css
.tabs {
  margin-top: var(--fn-space-3);
}
.tab {
  padding: 8px 13px 9px;
}
```

- [ ] **Step 5: Run the guard and verify it passes**

Run: `pnpm vitest run src/app/style.test.ts`
Expected: PASS. The received array is empty.

- [ ] **Step 6: Check the three breakpoints**

`style.css` has media queries at 1050 px, 700 px and 650 px written against the old padding. At each, and at 400 px: no horizontal body scroll, the side gutter never drops below 16 px, and the sidebar collapses as it does today. Fix what the removal broke; add no new breakpoint.

- [ ] **Step 7: `pnpm check`, then commit**

```bash
git add src/app/style.css src/app/style.test.ts src/components/repository/header.css \
        src/components/repository/tab-bar.css packages/design-system/styles/tokens.css
git commit -m "feat(shell): a content column that runs edge to edge"
```

---

## Final verification

Prove each of these and paste the output into the pull-request body.

- [ ] **No bare element selector sets layout** — `pnpm vitest run src/app/style.test.ts`
- [ ] **`style.css` still holds no colour literal** — the same suite, the prior plan's test
- [ ] **The package imports nothing from the app** — `pnpm vitest run packages/design-system/boundary.test.ts`, and confirm the reporter names the file rather than finding none
- [ ] **The shell renders the trail it is handed** — `pnpm vitest run src/components/app-shell.test.ts`
- [ ] **The topbar's slot order and empty utility hold** — `pnpm vitest run packages/design-system/src/top-bar.test.ts`
- [ ] **The breadcrumb is one row with one current item** — `pnpm vitest run packages/design-system/src/breadcrumb.test.ts`
- [ ] **Page bodies were not touched** — `git diff --stat main -- src/components/dashboard/ src/components/agents/ src/components/grading/ src/components/ai-involvement/` shows no change
- [ ] **The grading domain was not touched** — `git diff --stat main -- src/domain/grading/` shows no change
- [ ] **Everything passes together** — `pnpm check`
- [ ] **The measured targets** — run `pnpm dev:demo`, open a repository page, and record in the PR body: the workspace switcher's top offset within the sidebar (target ≤ 70 px), the topbar's height (48 px), and the distance from the top of `main` to the top of `.tabs` (target ≈ 220 px, from ≈ 360 px today)
- [ ] **It holds at 400 px** — no horizontal body scroll, gutter ≥ 16 px, skip link still reaches `<main>`, and every action button shows a visible focus ring against the gradient

## Not in this plan

A search control, a notification centre, a command palette, a collapsible sidebar, a dark theme, and any change to the five repository views below the tab bar. The landing page itself remains Task 6 of the prior plan. This plan restructures the shell and the button; it changes no behaviour and adds no route.
