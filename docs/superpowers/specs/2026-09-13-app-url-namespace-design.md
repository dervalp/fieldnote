# The /app prefix, and giving `/` back to the marketing site

**Status:** design, approved in conversation 2026-09-13. No implementation yet.

Two problems with one shape. The landing page shipped in PR #21 is unreachable
to anyone holding a session, because `src/app/page.tsx:34` redirects them away
before it renders. And the product and the public site share a flat URL
namespace, so nothing about a path tells you which of the two you are in.

The fix for the second is what makes the first safe. `/` can only serve the
pitch unconditionally once the dashboard lives somewhere that is not adjacent to
it. So: the application moves under `/app`, `/` becomes the marketing site for
everybody, and every URL that exists today keeps resolving.

## What this is not

It is not a redesign. Every page renders exactly what it renders now. If a
pixel moves, that is a migration bug, not a decision. The only user-visible
change is the address bar — and, for a signed-in visitor, that `/` is a page
rather than a bounce.

It is not an auth change. `requireWorkspace()` and `requireSession()` keep
gating exactly what they gate, from exactly where they gate it. Moving a
directory does not move a guard.

## The shape

```
/                       marketing            public
/signed-out             sign-in              public
/invitations/[token]    invitation           public
/api/*                  handlers             unchanged

/app/dashboard          ┐
/app/repos              │
/app/repos/[repoId]/…   ├ the product, behind the prefix
/app/prs                │
/app/settings           │
/app/onboarding         ┘
```

The prefix carries the meaning. Inside `/app` you are unambiguously in the
product; outside it you are on the website. A future public page cannot
collide with a product route by accident, because the two namespaces no longer
touch.

Five directories move under `src/app/app/`. The five section layouts move with
them unchanged — each still wraps `AppShell` for its own subtree. Hoisting them
into one `src/app/app/layout.tsx` would render identically and delete four
files, and it is deliberately **not** part of this change: it is a second,
arguable edit riding along on a mechanical one. `/app` itself gets no
`page.tsx`; it is served by a redirect (below).

## Old URLs: `redirects()` in next.config.ts

Six entries. Five sections plus bare `/app`:

```ts
{ source: '/dashboard/:path*',  destination: '/app/dashboard/:path*',  permanent: true },
{ source: '/repos/:path*',      destination: '/app/repos/:path*',      permanent: true },
{ source: '/prs/:path*',        destination: '/app/prs/:path*',        permanent: true },
{ source: '/settings/:path*',   destination: '/app/settings/:path*',   permanent: true },
{ source: '/onboarding/:path*', destination: '/app/onboarding/:path*', permanent: true },
{ source: '/app',               destination: '/app/dashboard',         permanent: true },
```

`*` is zero-or-more, so `/repos/:path*` covers bare `/repos` and
`/repos/x/delivery` in one entry. Redirects are checked before the filesystem,
so no route file is consulted for a legacy path.

**Why config and not middleware or leaf pages.** Leaf redirect pages at the old
locations would each have to re-assemble the query string by hand — which is
precisely the silent range-reset this design is trying to avoid — and they would
leave the old directories in the tree to rot. Middleware is real code executing
on every request to accomplish what six declarative lines accomplish for free.
The config redirects pass query values through to the destination on their own;
that behaviour is specified, not incidental.

**308, and what that costs.** These are permanent moves, so they are announced
as permanent. The price is that a browser caches a 308 indefinitely: a wrong
destination cannot be corrected server-side for anyone who already hit it. That
makes the redirect table the one part of this change that must be right before
it merges, which is why it gets a test that exercises it rather than a test that
inspects it.

### Testing the table, not the shape

`next/experimental/testing/server` ships in this install and exposes
`unstable_getResponseFromNextConfig`, which runs the real `redirects()` against
a real URL and returns the response. So the test asserts the behaviour we
actually care about:

- `/repos/repository%3A1/delivery?days=90&projection=gate-policy`
  → `/app/repos/repository%3A1/delivery?days=90&projection=gate-policy`,
  status 308. Path, dynamic segment, its percent-encoding, and both query
  parameters, in one assertion.
- Bare `/repos` → `/app/repos`.
- `/dashboard?from=2026-08-01&to=2026-08-30` → the `/app` equivalent, both
  params intact.
- `/` is **not** redirected — the regression test for the bug this fixes.
- `/signed-out`, `/invitations/abc`, `/api/auth/login` are not redirected.

The API is experimental and its docs note it considers only config fields, not
filesystem routes. That is exactly the scope we want to test here, and the
narrowness is acceptable for a table this small.

## Route construction: `src/lib/app-routes.ts`

A new module owns app path construction. Eight named builders and one constant:

```ts
export const appPrefix = '/app';
export const appSections = ['dashboard', 'repos', 'prs', 'settings', 'onboarding'] as const;

dashboardPath(query?)                      onboardingPath(query?)
reposPath(query?)                          accountSettingsPath()
repoPath(repoId, query?)                   workspaceSettingsPath()
repoSectionPath(repoId, segment, query?)   prPath(prId)
```

`query` accepts a search string with or without its leading `?` and is omitted
when empty — the normalisation `tabHref` already does, moved down a level.
Every builder that takes an id applies `encodeURIComponent` exactly once.

**The prefix is the weaker argument for this module.** It is real — a future
move becomes one edit and a regenerated table — but it is not the main one.

**The main argument is the encoding.** Repository ids look like `repository:1`.
`encodeURIComponent` is hand-written at roughly ten call sites today, and
`src/lib/page-route-id.ts` exists specifically to undo it on the way back in.
One call site that forgets produces a 404 that nobody notices until somebody
links a repo whose id contains a colon. A `repoPath(id)` that encodes once
removes the class.

**The second argument is `revalidatePath`.** `repos/[repoId]/actions.ts` and
`onboarding/actions.ts` revalidate four paths between them. A `revalidatePath`
naming a route that no longer exists does not throw — it revalidates nothing.
That is an invisible failure, and a builder makes it unrepresentable.

**Against, honestly:** `href={repoPath(id)}` reads less plainly than a literal
when you meet a component cold, and indirection is a real cost. The judgement
is that one greppable symbol beats a string spelled 62 times, and the guard
against the cost compounding is keeping the module dumb: eight concrete
functions, no generic `buildPath(segments)` machinery, no options objects, no
type-level route algebra. If a ninth route wants a builder, it gets a ninth
function.

**Where it does not go.** Test assertions stay literal strings. A test that
builds its expectation from the same helper the code under test uses asserts
nothing at all; the literals in `sidebar.test.ts`, `tabs.test.ts` and the rest
are the point of those tests, and they get hand-edited to the new paths.

**`next.config.ts` imports nothing from `src/`.** Config module resolution is
not a thing worth betting a build on. Instead a vitest imports both the config
and `app-routes.ts` and asserts the redirect table's sources are exactly
`appSections` and its destinations are exactly those prefixed. Drift is caught
by a test rather than prevented by an import, which is the same guarantee
without the risk.

**Relationship to `navigation-path.ts`.** Adjacent, and deliberately separate.
`canonicalPathname` normalises an *incoming* pathname so it can be compared;
`app-routes` constructs *outgoing* ones. Opposite directions, no shared code.
`tabHref` in `components/repository/tabs.ts` keeps its signature and its tests
and becomes a thin call to `repoSectionPath`.

## What actually changes

**Moved** (`git mv`, 38 files, 14 of them colocated tests): `src/app/{dashboard,
repos,prs,settings,onboarding}` → `src/app/app/`. Every relative import inside
those files gains one `../`. Mechanical, and `pnpm typecheck` is the proof.
`src/app/settings/actions.integration.test.ts` moves with its subject.

**`src/app/page.tsx`** loses the redirect, the `hasCurrentSession` import, and
the paragraph of the file comment describing the old behaviour.
`hasCurrentSession` itself stays — the API routes and the invitations page use
it.

**Path literals outside the moved tree** — roughly 27 non-test files in total.
Beyond the moved pages and actions:

| File | What |
| --- | --- |
| `api/auth/callback/route.ts` | post-sign-in destination |
| `not-found.tsx` | "Return to overview" |
| `invitations/[token]/actions.ts` | post-accept destination |
| `components/sidebar.tsx` | brand href, two nav hrefs, two `aria-current` comparisons |
| `components/workspace-switcher.tsx` | `router.push`, new-workspace link |
| `components/account-menu.tsx` | both settings links |
| `components/pr-table.tsx` | PR links |
| `components/repository/header.tsx` | the breadcrumb's "All repositories" |
| `components/repository/tabs.ts` | `tabHref` base |
| `components/repository/coverage-strip.tsx` | repo settings link |
| `components/agents/agents-involved.tsx` | involvement link |
| `components/act/act-entry.tsx` | act run link |
| `components/onboarding/repository-picker.tsx` | "View overview" |
| `components/onboarding/import-progress.tsx` | pathname guard, repo link, overview link |

`components/app-shell.tsx` is **not** on this list. Its topline is
`<span>{active.name} / Engineering records</span>` — text, not a link. It
contains no path literal and needs no edit.

### Three places that fail silently

Everything else in this change fails loudly — a wrong path is a 404 you see
immediately. These three do not:

1. **`revalidatePath` calls** (`repos/[repoId]/actions.ts:16,17,35,36`,
   `onboarding/actions.ts:29,30`). A stale path is a no-op, not an error. The
   builder covers them; `onboarding/actions.test.ts:72` asserts the exact call
   arguments and will go red if one is missed.
2. **`import-progress.tsx:66`**, which gates a `history.replaceState` on
   `window.location.pathname === '/onboarding'`. Miss it and the `?repo=&run=`
   resume parameters quietly stop being written, with no error anywhere.
3. **Sidebar `aria-current`** (`sidebar.tsx:45,52`). A comparison against a
   path that can never match drops the current-page indicator for screen
   readers without changing a single pixel. `sidebar.test.ts` asserts on the
   rendered `aria-current`, so it holds the line.

## The date range

`?days=`, `?from=`/`?to=` and `?projection=` thread through the whole product.
Four mechanisms carry them, and this change touches two:

- **Legacy redirects** — carried by Next automatically, and asserted by the
  config test above.
- **Sidebar** — already rebuilds a `retained` query from `days`/`from`/`to`
  and appends it. Correct once the base paths are prefixed.
- **Repository tabs** — `tabHref` already forwards the whole search string
  unfiltered. Correct once its base is prefixed.
- **`DateRange`** — builds from `usePathname()` and never constructs a prefix.
  **Requires no edit.**

That last one matters for reading the test run: `components/dashboard/
date-range.test.ts` will keep passing, and that is correct rather than
suspicious. It feeds pathnames in as fixtures. It is the one place where a
still-green test is not a missed edit.

## Verification

Roughly 14 test files assert on literal paths and must go red. A green run
before any test file is touched means the move did not take.

Named expectations, so a surprise is legible:

- `src/auth/invitation-routes.test.ts:82` drives the real OAuth callback with a
  mocked token exchange and asserts the redirect pathname. It covers the
  riskiest file in this change and needs no GitHub credentials.
- `src/app/page.test.ts:28` — "a signed-in visitor is redirected to the
  dashboard" — is inverted to assert the visitor gets the page. That test is
  the bug.
- `page.test.ts:47`, which asserts the landing page's internal hrefs are
  exactly `{'/', '/api/auth/login'}`, must keep passing untouched. The
  marketing page gains no product links here.
- `src/lib/navigation-path.test.ts` fixtures contain `/repos/...` strings.
  They are arbitrary inputs to a normaliser, not route assertions, and stay as
  they are.

Gate: `pnpm lint && pnpm typecheck && pnpm test && DEMO_MODE=false pnpm
test:integration`, with `docker compose up -d` first if the database is down.
`DEMO_MODE=false` is required because `.env` sets it true and `grade-runs.ts`
throws on it. `pnpm build` needs GitHub App and Inngest credentials and is left
to CI.

## Deliberately out of scope

**The landing page gains no route into the product.** A signed-in visitor on
`/` sees the same "Continue with GitHub" call to action a stranger sees, and
their only way in is typing a URL. That is a visual change to `SiteNav`, and
this change is routing only. `/app` redirecting to `/app/dashboard` at least
leaves them something short to type. Worth doing next; not here.

**`not-found.tsx` supplies no `<main id="main-content">`**, so the root
layout's skip link points at nothing on the not-found page. This predates the
change and is not caused by it, but the change makes it reachable more often —
a mistyped `/app/…` lands there. Flagged, not fixed.

**Hoisting the five section layouts** into one `src/app/app/layout.tsx`, as
above.
