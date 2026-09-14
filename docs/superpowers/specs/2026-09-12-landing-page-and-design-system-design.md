# The landing page and the shared design system

**Status:** design, approved in conversation 2026-09-12. No implementation yet.

Two things that only make sense together. fieldnote gets a public landing page
at `/`, and the visual language that page needs is extracted out of
`src/app/style.css` into `@fieldnote/design-system`, a workspace package the
product and the marketing page both consume.

The landing page is not the reason for the package. The package is the reason
the landing page can exist without forking the product's appearance — which is
how marketing sites end up showing a product that no longer looks like that.

## What this is

**The design system.** A pnpm workspace package holding the tokens, the base
element styles and nine presentational primitives. Nothing in it fetches data,
reads a session, imports from `src/`, or knows what a pull request is.

**The landing page.** A public route at `/`, replacing today's redirect to
`/dashboard`. It pitches agent readiness as something a repository earns: the
grade card is the hero, the six finishes are a ladder, and both CTAs go to
GitHub sign-in.

Neither exists today. `src/app/page.tsx` is four lines that redirect.

## The visual baseline is not up for redesign

[`docs/design/fieldnote/README.md`](../../design/fieldnote/README.md) records a
direction the user selected on 2026-09-07 and a logo approved the same day: Pine
& Mist palette, Original Ember `#BE421F`, Georgia display type, Arial interface
text, outlined Field Lines seal. Every colour and typeface in this design is
that baseline, unchanged.

What is new is structure, not appearance. Today a component that needs the
accent writes `#be421f`; after this it writes `var(--fn-color-accent)`.

Two different promises, and they must not be confused. **Colour and type are
pixel-identical** — every value is the same hex and the same face, so any visual
difference there is a migration bug. **Spacing is deliberately not**: collapsing
fourteen ad-hoc values onto an eight-step scale moves some edges by a pixel or
two, and that is the point of having a scale.

> **Amended 2026-09-13.** The second promise no longer holds for the
> application shell. Spacing, density and layout structure inside the shell are
> deliberately redesigned by the pass recorded below, and the "pixel or two"
> limit applies only to the page bodies the shell contains. The first promise is
> untouched: no new hue, no new typeface, anywhere.

## Decisions settled in conversation

| Question | Settled | Why |
| --- | --- | --- |
| Where the landing page lives | Same Next.js app, at `/` | One deploy, one token set, and "Try it now" is a same-origin link. A separate site would force the package to exist but buy nothing else. |
| What "Try it now" does | `/api/auth/login` | Both CTAs go to GitHub sign-in. No new public auth surface. The hero carries the proof instead of a demo route. |
| How the system is packaged | `packages/design-system` | A real workspace package, so "shared with the website" survives the website moving. |
| Hero card finish | Gold at 95 | Gold is the look asked for; leaving Prismatic unclaimed at the top of the ladder gives the page something to sell. |
| Headline | "Get your ultimate harness." | Uses *harness* in the sense the codebase already does — the test, CI, runner, quality and package-configuration files. |
| Dark theme | The seam, not the theme | The app is light-only and the paper identity is deliberate. Token indirection makes dark a later swap rather than a rewrite. |
| Migration shape | Tokens repo-wide in one commit, then components one at a time | One pass on tokens keeps the palette from existing twice; incremental components keep each diff reviewable. |

## No `(app)` route group is needed

Worth recording, because the obvious assumption is wrong and would cost a large
pointless diff.

`src/app/layout.tsx` is thin: `<html>`, `<body>`, the skip link, and the
stylesheet import. The app shell is applied *per section* —
`dashboard/layout.tsx`, `repos/layout.tsx`, `prs/layout.tsx`,
`settings/layout.tsx` and `onboarding/layout.tsx` each render `<AppShell>`.
`invitations/layout.tsx` renders the public panel instead.

So a public page at `/` needs no route group and no moved routes. It is
`src/app/page.tsx` with its own `<main id="main-content">`, alongside
`/signed-out` and `/invitations/[token]` as the third public surface. Existing
routes are untouched.

## Amendment 2026-09-13: the application shell density pass

Reviewed against a screenshot of `/repos/[repoId]/settings` and approved in
conversation on 2026-09-13. Seven changes to the shell, folded into this design
rather than landing first on `src/app/style.css`, so the density decisions are
made once in the package and the landing page inherits them.

The complaint is one thing said seven ways: the chrome is set at website
spacing, and the product is an application. Roughly 140 px of vertical chrome
sits above the first repository tab, and 64 px of gutter on each side of the
content column.

### What changes

| # | Change | Today | Amended |
| --- | --- | --- | --- |
| 1 | Brand lockup | 48 px mark stacked over a 34 px wordmark, 48 px margin below | 26 px mark beside a 21 px wordmark, one row |
| 2 | Sidebar rhythm | `padding: 35px 24px`, nav `gap: 10px`, items `padding: 13px 10px` | `padding: 16px 12px`, nav `gap: 4px`, items `padding: 7px 10px` |
| 3 | Active nav state | 2 px left border only | Mist fill plus an inset accent edge |
| 4 | Page header | `.page-topline` at 71 px, then a separate breadcrumb repeating it | One 48 px sticky `TopBar` with three named slots |
| 5 | Breadcrumb | Broken — stacked onto three rows | One row, and it absorbs the workspace line |
| 6 | Buttons | Flat fill, flat darker hover | Two-stop gradient, optical top highlight, hue-tinted shadow, press state |
| 7 | Content column | `padding: 34px clamp(24px, 4vw, 64px) 64px` plus a left fade | `padding: 0`, body inset 24 px, fade removed |

Colour and typeface are unchanged by every one of them. The ember is still
`#be421f` at the button's midpoint; the gradient is a lighting cue, not a new
hue, and its stops are tokens derived from the accent rather than new palette
entries.

### The breadcrumb is a bug, not a preference

`src/app/style.css` carries a bare element selector written for the sidebar:

```css
nav { display: grid; gap: 10px; }
```

`.crumb` in `src/components/repository/header.tsx` is also a `<nav>`, so it
becomes a one-column grid and its three children — the link, the separator and
the repository name — each take a row. The fix is to scope the selector to
`.sidebar nav`. The same class of collision is waiting in the file's other bare
selectors (`button`, `input`, `label`, `section`), which is what the `fn.base`
layer exists to prevent: element defaults only, never layout.

### Half the gutter is a gradient

`main`'s first background layer paints the sidebar's `#e6ece7` across the first
48 % of the content column. Removing the padding without removing that layer
leaves the inset look in place. Both go; the two radial atmosphere layers stay.

### The topbar is a contract, not a bar

The point of the restructure is extensibility, so the slots are named and each
carries a rule about what belongs in it:

| Slot | Position | Holds |
| --- | --- | --- |
| `TopBar.Context` | Left, grows | Where you are. The breadcrumb, and nothing else. |
| `TopBar.Utility` | Right, intrinsic | Global stateless controls — search, then notifications. Empty in this design. |
| `TopBar.Identity` | Far right, past a divider | The account menu. Permanently last. |

Search and notifications are **reserved, not built**. This design defines where
they land and adds no control.

**The breadcrumb comes from the route.** `AppShell` renders above the route
segment and cannot read a repository name, so each section layout renders its
own `<Breadcrumb>` into the slot the topbar reserves. The alternative — a client
context the page publishes into — was declined: it adds client state to a server
shell for a string the layout already holds.

### What this costs the rest of the design

- **Two tasks in the prior plan change.** The token task writes the amended
  spacing and the new control tokens directly, rather than today's values
  followed by a second pass. The primitives task builds `Button` to the gradient
  spec and `Brand` with a `size` prop.
- **`Brand` gains a variant.** `compact` (row) for the sidebar, `display`
  (stacked) for the landing page nav and the signed-out panel. The stacked
  lockup is not deleted; it stops being the sidebar's problem.
- **The screenshot reference weakens.** `docs/screenshots/` no longer proves the
  shell is unchanged, because the shell is deliberately changed. It still proves
  the page bodies are.

### New tokens this requires

Semantic tier gains `--fn-color-surface-selected` (the active nav fill),
`--fn-color-accent-edge` (the button border, one step darker than the fill), and
`--fn-elevation-control` / `--fn-elevation-control-press`. Three gradient tokens
carry the button finish: `--fn-gradient-accent`, `--fn-gradient-accent-hover`,
`--fn-gradient-accent-press`. Every stop is derived from the approved ember;
none is a new palette colour.

### Out of scope for the amendment

A search control, a notification centre, a command palette, a collapsible
sidebar, and any change to the five repository views below the tab bar. The
amendment restructures the shell and the button; it changes no behaviour and
adds no route.

## The package

`pnpm-workspace.yaml` today carries only `onlyBuiltDependencies`. It gains a
`packages:` key. The app stays at the repository root and depends on
`@fieldnote/design-system` with `workspace:*`. Next transpiles the package
source directly; there is no build step and no published artifact.

### Cascade layers

`styles/index.css` declares the order once:

```css
@layer fn.reset, fn.tokens, fn.base, fn.components;
```

| Layer | Holds |
| --- | --- |
| `fn.reset` | Box sizing, `body` margin, inherited control fonts, the `:focus-visible` ring. What `style.css` does in its first 40 lines. |
| `fn.tokens` | Every custom property, on `:root`. The only layer permitted a literal colour, with one exception recorded below. |
| `fn.base` | Element defaults: headings on the display face, body copy, links, table chrome, the type scale. |
| `fn.components` | The nine primitives. Each class references semantic tokens only. |

Explicit layers matter here beyond tidiness. `style.css` has already accumulated
selectors that fight each other — the comment above `.bigcard` in that file
records `.v` and `.s` migrating between files to stop them desyncing. Layered
CSS means app and marketing rules written outside the package always win without
specificity escalation.

### Tokens, in three tiers

**Reference tier** names the palette: `--fn-pine-900` `#203f36`, `--fn-pine-600`
`#526b60`, `--fn-mist-300` `#bfcfc4`, `--fn-mist-200` `#e6ece7`, `--fn-paper-50`
`#f4f7f3`, `--fn-ember-600` `#be421f`, `--fn-ember-700` `#a6381a`,
`--fn-moss-700` `#2f6b52`, `--fn-amber-700` `#986817`, `--fn-amber-100`
`#f3e8ca`.

**Finish tier** names one colour per grade band, lifted from
`gradePresentation()`: `--fn-grade-common` `#b54740`, `--fn-grade-shimmer`
`#548eae`, `--fn-grade-bronze` `#895333`, `--fn-grade-silver` `#697e8d`,
`--fn-grade-gold` `#a77a13`, `--fn-grade-prismatic` `#7359a3`.

**Semantic tier** is what components actually reference: `--fn-color-ink`,
`--fn-color-ink-muted`, `--fn-color-ground`, `--fn-color-surface`,
`--fn-color-surface-glass`, `--fn-color-border`, `--fn-color-hairline`,
`--fn-color-accent`, `--fn-color-accent-hover`, `--fn-color-positive`,
`--fn-color-caution`, `--fn-color-caution-surface`.

Type keeps both approved faces and adds a mono role for the things fieldnote is
made of — SHAs, paths, check ids: `--fn-font-display` Georgia,
`--fn-font-ui` Arial, `--fn-font-mono` `ui-monospace`. Sizes:
`--fn-text-display` `clamp(32px, 3.3vw, 48px)`, `--fn-text-title` `27px`,
`--fn-text-subtitle` `22px`, `--fn-text-figure` `30px`, `--fn-text-body` `14px`,
`--fn-text-detail` `12.5px`, `--fn-text-label` `10px`.

Space collapses fourteen ad-hoc values to eight steps: `--fn-space-1` through
`--fn-space-8` at 4, 8, 12, 16, 24, 32, 48, 64. Radii carry role rather than
decoration: `--fn-radius-sm` `5px` for inputs, `--fn-radius-md` `8px` for
grouped content, `--fn-radius-lg` `12px` for a separate object,
`--fn-radius-card` `16px` for the grade card, `--fn-radius-pill` `999px`. One
elevation: `--fn-elevation-card`.

**The one exception.** Each grade finish is an eight-to-nine stop gradient that
only means anything whole. Naming twenty-odd stops as tokens would be
bookkeeping, not a system, so the foil gradients stay in `grade-card.css`
selected by `data-finish`, exactly as today. The card continues to expose a
single `--grade` custom property.

### The nine primitives

Admission test: the app renders it *and* the landing page renders it.

`Brand`, `Button` (accent / secondary / quiet), `Badge` (positive / caution /
neutral), `Surface`, `StatCard`, `Notice`, `Field`, `DataTable`, `GradeCard`.
`GradeBanner` travels with `GradeCard` — it shares the tier vocabulary and
cannot sit on the other side of the boundary from it.

That test excludes, deliberately: charts, the PR table, the repository picker,
import progress, cohort comparison, the grading report, the sidebar, the
workspace switcher, the account menu. Product surfaces, not system parts.

## Moving the grade card

The consequential part of this design, and the reason the package is worth
building rather than a `src/design-system/` directory.

`src/components/grading/grade-card.tsx` is the dashboard's centrepiece and now
the marketing hero. Two consumers means it moves into the package — but it moves
**presentational only**.

**What moves:** `grade-card.tsx`, `grade-card.css`, `grade-banner.tsx`,
`grade-banner.css`. Markup and foils unchanged.

**What does not move:** all of `src/domain/grading`. `gradePresentation()`,
`flavourLine()`, `finishNames`, `nextTier()` and `checkTitles` stay where they
are, tested where they are. They encode the rubric's thresholds, and a rubric is
domain knowledge, not presentation.

**The seam:** `GradeCard` takes the resolved presentation as props — `score`,
`finish`, `label`, `color`, `symbol`, `count`, `finishName`, `flavour`, `next`,
plus repository name, rubric version and SHA. It derives nothing. The dashboard
passes the output of `gradePresentation(score)`; the landing page passes a
literal of the same shape.

That shared type is what stops the marketing card drifting from the product
card. A change to the foil, the scale or the layout lands in both at once, and a
marketing card that claims an impossible tier fails to typecheck.

## The landing page

`src/app/page.tsx`, replacing the redirect. A server component that calls
`hasCurrentSession()` and redirects to `/dashboard` when a session exists, so
returning users are not shown the pitch. Signed-out visitors get the page.

Sections, in order:

1. **Nav** — Field Lines mark and wordmark, links to the rubric, how it works,
   metrics, self-host. "Sign in" quiet, "Try it now" accent.
2. **Hero** — eyebrow "Agent readiness, graded out of 100", headline "Get your
   ultimate harness.", the argument that agents are only as good as the
   repository they are handed. Both CTAs to `/api/auth/login`. Beside it the
   Gold card at 95, with a sheen crossing the foil and a pointer tilt, both
   disabled under `prefers-reduced-motion`. Four proof figures: 5 checks, 6
   finishes, 100 perfect score, 0 LLM judges.
3. **The ladder** — all six finishes as cards, Common 32 through Prismatic 100,
   each with its band and rating. The card is reissued on every graded commit,
   which is the honest difference between this and a compliance badge.
4. **The rubric** — the five readiness checks at 20 points each, titled from
   `checkTitles`. Every failing check records paths and line ranges; no model
   decides the score.
5. **Monitor · Act · Train** — three stages with honest status badges (shipped /
   scoring shipped / designed), and `demo-pr-4` from `src/demo/fixtures.ts` as
   supporting evidence: failed CI, changed a test file, turned green, therefore
   not clean green.
6. **What it measures** — the metric table, condensed to five rows.
7. **The guarantees** — no LLM judges, recomputed not stored, replays
   identically, unknown stays unknown.
8. **Sign up** — "Continue with GitHub", plus the AGPL-3.0 self-host path.
9. **Footer.**

Marketing compositions live in `src/components/marketing/` and own no tokens. A
marketing piece that wants a new colour is a signal to add a semantic token, not
a local hex.

### Copy holds to what ships

Act is "scoring shipped", Train is "designed". The README says so and the page
must not say otherwise. Every metric definition is the README's own wording, and
every tier name, flavour line and threshold is read from
`src/domain/grading/`, not rewritten for marketing.

## How we will know it works

- `pnpm check` passes: lint, typecheck, unit, integration, build.
- The dashboard, repository, PR, settings and onboarding page **bodies** keep
  their colours and type exactly, and their spacing within the pixel-or-two the
  scale normalization allows. The screenshots under `docs/screenshots/` are the
  reference for the bodies only — the shell around them is deliberately changed
  by the 2026-09-13 amendment.
- The shell changes land as specified: the brand is one row, the workspace
  switcher sits within 70 px of the top of the sidebar, the breadcrumb renders
  on one line, the topbar is 48 px with its three slots present, and `main`
  carries no side padding above the 24 px body inset.
- No bare element selector in `style.css` sets layout. `nav`, `button`, `input`,
  `label` and `section` are either scoped to a class or reduced to element
  defaults in `fn.base`. Lint- or test-enforceable, and the fix for the
  breadcrumb bug is only durable if this is.
- `src/app/style.css` contains no hex literal once extraction is done. This is
  lint-enforceable and is how drift gets caught by CI rather than by review.
- `packages/design-system` imports nothing from `src/`. Also lint-enforceable.
- The grade card renders identically on the dashboard after the move, at all six
  finishes. `gradePresentation`, `flavour`, `next-tier` and `presentation` tests
  continue to pass unmodified — they test domain logic the move does not touch.
- `/` serves the landing page to a signed-out visitor and redirects a signed-in
  one to `/dashboard`.
- The page holds at 400px wide with no horizontal scroll, and the skip link
  reaches its `<main>`.

## Out of scope

- **A public share page or README badge for the card.** The obvious next move
  for a card people want to show off, and real marketing leverage — but it is
  new public surface with caching, and a decision about whether a low grade may
  be shared. Its own design.
- **A dark theme.** The seam only.
- **A demo workspace requiring no account.** Considered and declined; "Try it
  now" goes to sign-in.
- **Restructuring the repository into `apps/*`.** Not needed, as recorded above.
- **Any change to grading, metrics, import, or the Act leg.** This design moves
  presentation and adds a page. It changes no behaviour.
