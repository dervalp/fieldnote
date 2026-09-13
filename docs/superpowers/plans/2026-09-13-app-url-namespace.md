# The /app URL namespace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the marketing site at `/` to everyone, move the product under `/app`, and 308-redirect every URL that exists today to its new home with its query string intact.

**Architecture:** A dependency-free `src/lib/app-routes.ts` owns every product URL, so the prefix and the `encodeURIComponent` discipline each exist in one place. The five route directories move under `src/app/app/` with a mechanical import fixup that `tsc` proves. Legacy URLs are handled by `redirects()` in `next.config.ts` — declarative, checked before the filesystem, and carrying query values to the destination for free.

**Tech Stack:** Next.js 16.3.4 (App Router), React 19, TypeScript (strict), vitest, pnpm, Drizzle/Postgres for the integration suite.

**Spec:** [`docs/superpowers/specs/2026-09-13-app-url-namespace-design.md`](../specs/2026-09-13-app-url-namespace-design.md)

## Global Constraints

- **Read the Next docs before writing route code.** `AGENTS.md` requires it; this is Next 16.3.4, not the Next in your training data. Relevant: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md`.
- **No visual change.** Every page renders exactly what it renders now. A moved pixel is a migration bug.
- **Every route keeps a skip-link target.** The root layout renders `<a className="skip-link" href="#main-content">`; every page must supply `id="main-content"`. Nothing in this plan changes a `<main>`, so this is a thing to not break, not a thing to add.
- **Redirects are `permanent: true` (308).** Browsers cache 308 indefinitely. A wrong destination cannot be fixed server-side for anyone who already hit it. Task 5's tests are the guard.
- **Test assertions spell paths out as literals.** Never import `app-routes.ts` into a test to build an expected value — a test that uses the same helper as the code under test asserts nothing.
- **Gate for every task:** `pnpm lint && pnpm typecheck && pnpm test`
- **Full gate before the branch is done:** `pnpm lint && pnpm typecheck && pnpm test && DEMO_MODE=false pnpm test:integration`
  - `DEMO_MODE=false` is mandatory — `.env` sets it `true` and `grade-runs.ts` throws on it.
  - Start Postgres first if it is down: `docker compose up -d`
- **`pnpm build` is not part of the gate.** It needs GitHub App and Inngest credentials, fails locally, and CI covers it.
- **Commit messages** end with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LwPfPoY8rRu1B4UPQDwJYw
  ```

---

## File Structure

**Created**
- `src/lib/app-routes.ts` — every product URL, built. Zero imports.
- `src/lib/app-routes.test.ts` — unit tests for the builders.
- `src/lib/legacy-redirects.test.ts` — drives the real `redirects()` table from `next.config.ts` against real URLs.

**Moved** (`git mv`, 37 files) — `src/app/{dashboard,repos,prs,settings,onboarding}` → `src/app/app/`. Colocated tests and `src/app/settings/actions.integration.test.ts` travel with their subjects.

**Modified**
- `next.config.ts` — gains the six-entry redirect table.
- `src/app/page.tsx`, `src/app/page.test.ts` — the redirect comes out.
- `src/components/repository/tabs.ts` — `tabHref` becomes a wrapper over `repoSectionPath`.
- 27 further files holding path literals or importing across the move boundary. Each is named in the task that touches it.

**Not modified, deliberately**
- `src/components/repository/header.tsx` — holds no path literal; its only `href` is `githubRepositoryUrl(repo)`, which is external. Task 3 touches it for its `refreshImport` import, Task 4 never does. The breadcrumb used to live here and now does not.
- `src/components/dashboard/date-range.test.ts` — `DateRange` builds from `usePathname()` and never constructs a prefix. Its pathnames are arbitrary inputs paired with assertions that echo them. It stays green, and that is correct.
- `src/lib/navigation-path.ts` and its test — normalises *incoming* pathnames; `app-routes` constructs *outgoing* ones. Opposite directions, no shared code. The `/repos/...` strings in its test are arbitrary inputs to a normaliser, not route assertions.
- `src/app/{signed-out,invitations,api}` — public surfaces, unchanged.

---

## Task 1: `/` serves the marketing site to everyone

This is the reported bug, and it is independent of everything else. `/dashboard` still works at this point, so nothing is stranded.

**Files:**
- Modify: `src/app/page.tsx:1-2,20-34`
- Test: `src/app/page.test.ts:4-17,28-31`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. `hasCurrentSession` stays exported from `src/auth/session.ts` — the API routes and `src/app/invitations/[token]/page.tsx:25` still use it.

- [ ] **Step 1: Invert the routing-contract test**

In `src/app/page.test.ts`, replace the test at lines 28-31:

```ts
test('a signed-in visitor is redirected to the dashboard, not shown the pitch', async () => {
  deps.signedIn.mockResolvedValue(true);
  await expect(Landing()).rejects.toThrow('/dashboard');
});
```

with:

```ts
// The bug this replaces: a signed-in visitor was bounced to /dashboard and
// could never read the pitch, check a metric definition, or send a colleague
// a link without signing out first.
test('a signed-in visitor gets the page too, not a bounce', async () => {
  deps.signedIn.mockResolvedValue(true);
  const html = renderToStaticMarkup(await Landing());
  expect(html).toContain('Get your ultimate harness.');
});
```

Leave the `vi.mock` of `../auth/session` and the `next/navigation` mock at lines 4-10 in place for now — Step 3 removes them.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/app/page.test.ts`
Expected: FAIL. The new test throws `Error: /dashboard` out of the mocked `redirect`, because `page.tsx` still redirects.

- [ ] **Step 3: Remove the redirect**

In `src/app/page.tsx`, delete lines 1-2:

```ts
import { redirect } from 'next/navigation';
import { hasCurrentSession } from '../auth/session';
```

and change line 33-34 from:

```tsx
export default async function Landing() {
  if (await hasCurrentSession()) redirect('/dashboard');
```

to:

```tsx
export default async function Landing() {
```

`Landing` stays `async` — `page.test.ts` awaits it, and an async component is what the App Router expects here.

Then fix the file comment. Lines 20-32 currently describe the old behaviour. Replace the whole comment block with:

```tsx
/**
 * The public landing page, and the third public surface alongside /signed-out
 * and /invitations/[token].
 *
 * It renders for everyone, signed in or not. It used to redirect a visitor
 * holding a session to /dashboard, which made the pitch unreadable to anyone
 * with an account — no way to check a metric definition or link a colleague
 * without signing out. The product now lives under /app, so / is free to be
 * the website unconditionally.
 *
 * No (app) route group is needed for this. The root layout is thin — html,
 * body, the skip link and the stylesheet import — and the app shell is applied
 * per section under src/app/app/. So this page sits at / with its own <main>.
 *
 * That <main id="main-content"> is required rather than decorative: the root
 * layout renders a skip link pointing at it, and this page supplies no
 * AppShell to provide one.
 */
```

- [ ] **Step 4: Drop the now-dead mocks from the test**

In `src/app/page.test.ts`, delete lines 4-10:

```ts
const deps = vi.hoisted(() => ({ signedIn: vi.fn() }));
vi.mock('../auth/session', () => ({ hasCurrentSession: deps.signedIn }));
vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Error(href);
  },
}));
```

and the `beforeEach` at lines 14-17:

```ts
beforeEach(() => {
  vi.clearAllMocks();
  deps.signedIn.mockResolvedValue(false);
});
```

Then rewrite the two session tests as one, since with no session lookup left there is no longer a signed-in case and a signed-out case — there is one page:

```ts
// The routing contract. The page takes no session into account at all: /
// is the website, for everyone.
test('renders the pitch with no session lookup of any kind', async () => {
  const html = renderToStaticMarkup(await Landing());
  expect(html).toContain('Get your ultimate harness.');
  expect(html).toContain('Agent readiness, graded out of 100');
});
```

Trim the now-unused `beforeEach` and `vi` imports from the `vitest` import on line 2 if nothing else in the file uses them.

- [ ] **Step 5: Run the full test file and verify it passes**

Run: `pnpm vitest run src/app/page.test.ts`
Expected: PASS, all tests.

Check specifically that the test at line 42, `'both calls to action go to GitHub sign-in, and no other auth surface'`, still passes. It asserts the page's internal hrefs are exactly `{'/', '/api/auth/login'}`. The marketing page gains no product links in this change, so it must stay green untouched.

- [ ] **Step 6: Run the gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS. Confirm `src/auth/session.ts` did not get an unused-export lint error — `hasCurrentSession` has four other callers.

- [ ] **Step 7: Commit**

```bash
git add src/app/page.tsx src/app/page.test.ts
git commit -m "$(cat <<'EOF'
fix(marketing): the landing page stops hiding from everyone who signed in

A visitor holding a session was redirected to /dashboard before the pitch
rendered, so the page shipped in #21 was invisible to every account holder.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LwPfPoY8rRu1B4UPQDwJYw
EOF
)"
```

---

## Task 2: `src/lib/app-routes.ts`

Additive. Nothing imports it yet, so nothing can break.

**Files:**
- Create: `src/lib/app-routes.ts`
- Test: `src/lib/app-routes.test.ts`

**Interfaces:**
- Consumes: nothing. The module imports nothing, by design — Task 5's drift test reads `appSections` from it, and a module with no imports is safe to read from anywhere.
- Produces, for Tasks 3-5:
  ```ts
  export const appPrefix: '/app';
  export const appSections: readonly ['dashboard', 'repos', 'prs', 'settings', 'onboarding'];
  export function dashboardPath(query?: string): string;
  export function reposPath(query?: string): string;
  export function repoPath(repoId: string, query?: string): string;
  export function repoSectionPath(repoId: string, segment: string, query?: string): string;
  export function actRunPath(repoId: string, runId: string): string;
  export function prPath(prId: string): string;
  export function onboardingPath(query?: string): string;
  export function accountSettingsPath(): string;
  export function workspaceSettingsPath(hash?: string): string;
  ```
  Nine builders, not the eight the spec sketched: `actRunPath` was split out because an act run URL encodes two ids, and `workspaceSettingsPath` takes an optional hash because `workspace-switcher.tsx:60` links to `#new-workspace`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/app-routes.test.ts`:

```ts
import { expect, test } from 'vitest';
import {
  appPrefix,
  appSections,
  dashboardPath,
  reposPath,
  repoPath,
  repoSectionPath,
  actRunPath,
  prPath,
  onboardingPath,
  accountSettingsPath,
  workspaceSettingsPath,
} from './app-routes';

// Paths are spelled out here rather than composed from appPrefix. Building an
// expectation out of the same constant the implementation uses would assert
// nothing; these literals are the point of the suite.

test('every section sits under the prefix', () => {
  expect(appPrefix).toBe('/app');
  expect(dashboardPath()).toBe('/app/dashboard');
  expect(reposPath()).toBe('/app/repos');
  expect(onboardingPath()).toBe('/app/onboarding');
  expect(accountSettingsPath()).toBe('/app/settings/account');
  expect(workspaceSettingsPath()).toBe('/app/settings/workspace');
});

test('appSections names exactly the five directories under src/app/app', () => {
  expect([...appSections]).toEqual(['dashboard', 'repos', 'prs', 'settings', 'onboarding']);
});

// Repository ids carry a colon. Encoding them exactly once, here, is the main
// reason this module exists: the escape was hand-written at ten call sites and
// a missed one is a 404 nobody notices until a colon shows up in an id.
test('ids are percent-encoded exactly once', () => {
  expect(repoPath('repository:1')).toBe('/app/repos/repository%3A1');
  expect(repoSectionPath('repository:1', 'delivery')).toBe(
    '/app/repos/repository%3A1/delivery',
  );
  expect(actRunPath('repository:1', 'run:2')).toBe(
    '/app/repos/repository%3A1/act/run%3A2',
  );
  expect(prPath('pr:9')).toBe('/app/prs/pr%3A9');
});

test('a query is accepted with or without its leading question mark', () => {
  expect(reposPath('?days=30')).toBe('/app/repos?days=30');
  expect(reposPath('days=30')).toBe('/app/repos?days=30');
  expect(repoPath('repo', '?from=2026-08-01&to=2026-08-30')).toBe(
    '/app/repos/repo?from=2026-08-01&to=2026-08-30',
  );
});

// An empty query must not leave a bare `?` on the URL: the sidebar and the tab
// bar both pass '' when no range is selected, and a trailing `?` would make
// pathname comparisons and cache keys differ for the same page.
test('an empty query leaves no trailing question mark', () => {
  expect(reposPath('')).toBe('/app/repos');
  expect(reposPath()).toBe('/app/repos');
  expect(repoSectionPath('repo', 'grading', '')).toBe('/app/repos/repo/grading');
});

test('workspace settings can carry the new-workspace hash', () => {
  expect(workspaceSettingsPath('#new-workspace')).toBe(
    '/app/settings/workspace#new-workspace',
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/app-routes.test.ts`
Expected: FAIL — `Failed to resolve import "./app-routes"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/app-routes.ts`:

```ts
// The one place the /app prefix is spelled, and the one place a route id is
// percent-encoded. Moving the product again is an edit to `appPrefix` plus a
// regenerated redirect table in next.config.ts.
//
// Deliberately dependency-free. next.config.ts is checked against
// `appSections` by src/lib/legacy-redirects.test.ts rather than importing this
// module, so nothing here may ever grow an import.
//
// Not for tests. A test that builds its expected href from these functions
// asserts nothing at all; test files spell their paths out.
//
// Kept apart from navigation-path.ts on purpose: that normalises an *incoming*
// pathname so it can be compared, this constructs *outgoing* ones.

export const appPrefix = '/app';

/** The five product sections. The legacy redirect table covers exactly these. */
export const appSections = ['dashboard', 'repos', 'prs', 'settings', 'onboarding'] as const;

/**
 * Accepts a search string with or without its leading `?` — callers read it
 * from useSearchParams() (no `?`) or from a helper that includes one — and
 * drops an empty one, so a page with no range selected does not get a bare
 * trailing `?` that makes two URLs for the same view.
 */
function withQuery(path: string, query: string): string {
  const search = query.startsWith('?') ? query.slice(1) : query;
  return search ? `${path}?${search}` : path;
}

export function dashboardPath(query = ''): string {
  return withQuery(`${appPrefix}/dashboard`, query);
}

export function reposPath(query = ''): string {
  return withQuery(`${appPrefix}/repos`, query);
}

// Repository ids look like `repository:1`. pageRouteId() decodes this back on
// the way in; the two are a pair and must stay one encode to one decode.
export function repoPath(repoId: string, query = ''): string {
  return withQuery(`${appPrefix}/repos/${encodeURIComponent(repoId)}`, query);
}

/** `segment` is a static route segment — grading, ai-involvement, delivery, settings. */
export function repoSectionPath(repoId: string, segment: string, query = ''): string {
  return withQuery(`${appPrefix}/repos/${encodeURIComponent(repoId)}/${segment}`, query);
}

/** Two ids, both encoded: the repository and the authoring run. */
export function actRunPath(repoId: string, runId: string): string {
  return `${appPrefix}/repos/${encodeURIComponent(repoId)}/act/${encodeURIComponent(runId)}`;
}

export function prPath(prId: string): string {
  return `${appPrefix}/prs/${encodeURIComponent(prId)}`;
}

export function onboardingPath(query = ''): string {
  return withQuery(`${appPrefix}/onboarding`, query);
}

export function accountSettingsPath(): string {
  return `${appPrefix}/settings/account`;
}

/** `hash` carries the `#new-workspace` deep link from the workspace switcher. */
export function workspaceSettingsPath(hash = ''): string {
  return `${appPrefix}/settings/workspace${hash}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/app-routes.test.ts`
Expected: PASS, six tests.

- [ ] **Step 5: Run the gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS, with no change to any existing test's result — nothing imports this module yet.

- [ ] **Step 6: Commit**

```bash
git add src/lib/app-routes.ts src/lib/app-routes.test.ts
git commit -m "$(cat <<'EOF'
feat(routing): one module owns every product URL

The prefix is the smaller reason. encodeURIComponent was hand-written at ten
call sites against ids that contain a colon, and revalidatePath naming a stale
route fails silently — both become unrepresentable when the path is built.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LwPfPoY8rRu1B4UPQDwJYw
EOF
)"
```

---

## Task 3: Move the five directories under `src/app/app/`

Pure relocation. **No path literal changes in this task** — every link still points at `/dashboard`, `/repos` and friends, so the app's links 404 at the end of this commit and Task 4 fixes them. Splitting it this way is what makes the move mechanically verifiable: `tsc` proves the imports and the existing tests prove nothing else moved.

**Files:**
- Move: 37 files, listed by the command in Step 1.
- Modify: 181 relative imports inside the moved files (the codemod in Step 3), plus 11 imports from outside the moved tree (Step 5).

**Interfaces:**
- Consumes: nothing.
- Produces: the route tree Task 4 links to and Task 5 redirects to. Server actions keep their exported names; only their module paths change — e.g. `refreshImport` moves from `src/app/repos/[repoId]/actions` to `src/app/app/repos/[repoId]/actions`.

- [ ] **Step 1: Move the directories**

```bash
mkdir -p src/app/app
git mv src/app/dashboard src/app/repos src/app/prs src/app/settings src/app/onboarding src/app/app/
find src/app/app -type f | sort
```

Expected: 37 files, all under `src/app/app/`. Confirm `src/app/app/settings/actions.integration.test.ts` is among them — it travels with its subject.

Confirm what did *not* move: `src/app/{page.tsx,page.test.ts,layout.tsx,not-found.tsx,style.css,style.test.ts,signed-out,invitations,api}`.

- [ ] **Step 2: Run typecheck to see the damage**

Run: `pnpm typecheck`
Expected: FAIL, with a large number of `Cannot find module '../../...'` errors. This is the signal the codemod exists to clear — read a couple to confirm they are all module-resolution errors and nothing else.

- [ ] **Step 3: Fix the relative imports inside the moved files**

Every moved file sits exactly one level deeper. An import that resolves to somewhere *outside* the five moved directories needs one more `../`; an import that stays *inside* the moved tree keeps its spelling, because the moved files kept their relationship to each other. There are 181 of the first kind and 5 of the second, so this must be decided per-import rather than by a blanket find-and-replace.

Write the codemod to the scratchpad (it is a one-shot tool, not project code):

```bash
cat > /tmp/claude-501/-Users-pid-dervalp-fieldnote/d5d872f7-96fa-487b-baa4-94fe50238a41/scratchpad/fix-imports.mjs <<'EOF'
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// The five directories as they are spelled AFTER the move.
const moved = ['dashboard', 'repos', 'prs', 'settings', 'onboarding'].map(
  (d) => `src/app/app/${d}`,
);
const files = execSync(`find ${moved.join(' ')} -type f`).toString().trim().split('\n');

let changed = 0;
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  // Matches the module specifier in `from '...'`, `import('...')` and
  // `vi.mock('...')` — the three forms this codebase uses.
  const after = before.replace(
    /(from\s+'|import\('|vi\.mock\(')(\.\.\/[^']*)'/g,
    (whole, prefix, spec) => {
      const resolved = path.normalize(path.join(path.dirname(file), spec));
      const inside = moved.some((d) => resolved === d || resolved.startsWith(`${d}/`));
      // Inside the moved tree: the relationship is unchanged, leave it alone.
      // Outside: the file went one level deeper, so the escape needs one more.
      return inside ? whole : `${prefix}../${spec}'`;
    },
  );
  if (after !== before) {
    writeFileSync(file, after);
    changed++;
  }
}
console.log(`rewrote imports in ${changed} of ${files.length} files`);
EOF
node /tmp/claude-501/-Users-pid-dervalp-fieldnote/d5d872f7-96fa-487b-baa4-94fe50238a41/scratchpad/fix-imports.mjs
```

Note the regex only touches specifiers starting `../`. A `./something` import points at a sibling that moved too, so it is already correct and must be left alone.

- [ ] **Step 4: Typecheck again**

Run: `pnpm typecheck`
Expected: the "Cannot find module" errors from *inside* `src/app/app/` are gone. What remains is the 11 imports from *outside* the moved tree, which Step 5 fixes. If any error inside `src/app/app/` survives, the codemod missed an import form — read the error, fix that one import by hand, and note which form it was.

- [ ] **Step 5: Fix the 11 imports that point into the moved tree from outside**

These are components importing server actions out of route directories, plus one integration test. Each gains `app/` after `app/`:

```bash
grep -rln "\.\./app/dashboard\|\.\./app/repos\|\.\./app/prs\|\.\./app/settings\|\.\./app/onboarding" src --include="*.ts" --include="*.tsx" \
  | xargs sed -i '' -E "s#(\.\./)app/(dashboard|repos|prs|settings|onboarding)/#\1app/app/\2/#g"
```

The exact 11 sites this must fix, so you can verify the count:

| File | Import |
| --- | --- |
| `src/components/repository/header.tsx:2` | `refreshImport` from `repos/[repoId]/actions` |
| `src/components/grading/report.tsx:6` | `runGrade` from `repos/[repoId]/grading/actions` |
| `src/components/grading/report.test.ts:7` | `vi.mock` of the same |
| `src/components/act/act-entry.tsx:3` | `requestPlanRun` from `repos/[repoId]/grading/actions` |
| `src/components/act/act-entry.test.ts:5` | `vi.mock` of the same |
| `src/components/dashboard/history-interest.tsx:8` | `dashboard/history-actions` |
| `src/components/onboarding/import-progress.tsx:6` | `retryAnalysis` from `onboarding/actions` |
| `src/components/onboarding/repository-picker.tsx:8` | `startFirstAnalysis`, `refreshRepositoryAccess` from `onboarding/actions` |
| `src/components/onboarding/rendering.test.ts:4` | `vi.mock` of `onboarding/actions` |
| `src/components/workspace-switcher.tsx:5` | `switchWorkspace` from `settings/actions` |
| `src/db/history-interest.integration.test.ts:11` | `dashboard/history-actions` |

Verify none were missed:

```bash
grep -rn "\.\./app/dashboard/\|\.\./app/repos/\|\.\./app/prs/\|\.\./app/settings/\|\.\./app/onboarding/" src --include="*.ts" --include="*.tsx"
```

Expected: no output. (Every remaining hit should read `../app/app/...`.)

- [ ] **Step 6: Typecheck must now be clean**

Run: `pnpm typecheck`
Expected: PASS, no errors. This is the whole proof of the move — a relative import that is off by one level cannot compile, so a clean typecheck means all 181 were resolved correctly.

- [ ] **Step 7: Run the tests — they must all still pass**

Run: `pnpm test`
Expected: PASS, every test, with **nothing changed in any assertion**.

This is the point of doing the move without touching literals. The tests assert on rendered HTML that still contains `/dashboard` and `/repos`, because no link has been repointed yet. If a test fails here, the move broke something real — a mock path, a colocated fixture — and it is not a literal problem. Do not "fix" it by editing a path assertion; find what actually broke.

- [ ] **Step 8: Run the integration suite**

Start Postgres if it is down, then run the suite — `src/app/app/settings/actions.integration.test.ts` and `src/db/history-interest.integration.test.ts` both moved or were repointed in this task.

```bash
docker compose up -d
DEMO_MODE=false pnpm test:integration
```

Expected: PASS. `DEMO_MODE=false` is mandatory; `.env` sets it true and `grade-runs.ts` throws on it.

- [ ] **Step 9: Lint and commit**

```bash
pnpm lint
git add -A src
git commit -m "$(cat <<'EOF'
refactor(routing): the product moves under src/app/app

Relocation only — every link still points at the old paths and will 404 until
the next commit repoints them. Splitting it this way is what lets tsc prove the
181 relative imports and lets the untouched test suite prove nothing else moved.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LwPfPoY8rRu1B4UPQDwJYw
EOF
)"
```

---

## Task 4: Point every link through `app-routes.ts`

The links start working again here. 27 non-test files and 14 test files.

**Files:** listed in the steps below.

**Interfaces:**
- Consumes: all nine builders from Task 2.
- Produces: an app whose every internal link is `/app`-prefixed. Task 5 redirects the old URLs to these.

- [ ] **Step 1: Update the test assertions first, and watch them fail**

These are the literals that describe what the app must produce. Edit them before the source, so the suite is red for the right reason.

**Constructed-path assertions** — the href a component builds. Each gains the `/app` prefix:

| File:line | Now | After |
| --- | --- | --- |
| `src/components/sidebar.test.ts:21` | `href="/repos?days=30"` | `href="/app/repos?days=30"` |
| `src/components/sidebar.test.ts:22` | `aria-current="page" href="/repos?days=30"` | `aria-current="page" href="/app/repos?days=30"` |
| `src/components/sidebar.test.ts:23` | `href="/dashboard?days=30"` | `href="/app/dashboard?days=30"` |
| `src/components/repository/tabs.test.ts:26,27,28` | `/repos/repository%3A1[/grading\|/settings]` | prefix each with `/app` |
| `src/components/repository/tabs.test.ts:36,39,44,45,49,50` | `/repos/...` | prefix each with `/app` |
| `src/components/repository/tab-bar.test.ts:45,46,51,52,53,54,55` | `/repos/repository%3A1...` | prefix each with `/app` |
| `src/components/agents/agents-involved.test.ts:95` | `href="/repos/repository%3A1/ai-involvement"` | `href="/app/repos/repository%3A1/ai-involvement"` |
| `src/components/act/act-entry.test.ts:39` | `/repos/repo/act/run-1` | `/app/repos/repo/act/run-1` |
| `src/app/app/dashboard/page.test.ts:43` | `rejects.toThrow('/onboarding')` | `rejects.toThrow('/app/onboarding')` |
| `src/app/app/dashboard/page.test.ts:54` | `href="/repos?days=30"` | `href="/app/repos?days=30"` |
| `src/app/app/repos/pages.test.ts:81` | `href="/repos/repository%3A1?days=90"` | `href="/app/repos/repository%3A1?days=90"` |
| `src/app/app/repos/[repoId]/page.test.ts:110` | `href="/repos/repo/delivery?from=...&amp;to=..."` | prefix with `/app` |
| `src/app/app/repos/[repoId]/delivery/page.test.ts:212,215` | `href="/repos/repo/delivery?..."` | prefix each with `/app` |
| `src/app/app/onboarding/actions.test.ts:72` | `[['/dashboard'], ['/repos/repo%3A1']]` | `[['/app/dashboard'], ['/app/repos/repo%3A1']]` |
| `src/auth/invitation-routes.test.ts:82` | `expired ? '/dashboard' : ...` | `expired ? '/app/dashboard' : ...` |
| `src/app/invitations/[token]/actions.test.ts:47` | `rejects.toThrow('redirect:/dashboard')` | `rejects.toThrow('redirect:/app/dashboard')` |

Leave the `/invitations/${'a'.repeat(43)}` half of `invitation-routes.test.ts:82` alone — invitations are a public surface and do not move.

**Fixture pathnames that describe where the page under test lives** — these must change too, and one of them is load-bearing:

| File:line | Now | After |
| --- | --- | --- |
| `src/components/sidebar.test.ts:4` | `pathname: '/repos'` | `pathname: '/app/repos'` |
| `src/components/sidebar.test.ts:31` | `navigation.pathname = '/repos'` | `navigation.pathname = '/app/repos'` |
| `src/components/app-shell.test.ts:22` | `{ label: 'Personal workspace', href: '/dashboard' }` | `href: '/app/dashboard'` |
| `src/app/app/dashboard/page.test.ts:12` | `usePathname: () => '/dashboard'` | `usePathname: () => '/app/dashboard'` |
| `src/components/dashboard/dashboard.test.ts:11` | `usePathname: () => '/dashboard'` | `usePathname: () => '/app/dashboard'` |
| `src/app/app/repos/[repoId]/delivery/page.test.ts:25` | `usePathname: () => '/repos/repo/delivery'` | `usePathname: () => '/app/repos/repo/delivery'` |

**Both `sidebar.test.ts` fixtures are load-bearing.** The sidebar compares `usePathname()` against `reposPath()`, so a fixture still claiming `/repos` silently drops the `aria-current="page"` that lines 22 and 31's test both assert. Line 31 sits inside a separate test about selection being carried by `aria-current` alone — miss it and that test fails for a reason that looks unrelated.

`app-shell.test.ts:22` is a crumb passed *into* `AppShell` as a test input, not an assertion on rendered output, so it will stay green either way. Update it anyway: it stands for what a real layout passes down, and a fixture showing the pre-move URL is the kind of thing that gets copied into the next test.

`dashboard/page.test.ts:12`, `dashboard.test.ts:11` and `delivery/page.test.ts:25` are not load-bearing either, but a fixture that lies about where its page lives will mislead the next reader.

**Do not touch `src/components/dashboard/date-range.test.ts`.** Its pathnames are arbitrary inputs to a component that echoes whatever pathname it is given, paired with assertions that echo them back. It is self-consistent at any prefix and stays green. That is the one place in this task where an untouched, still-passing test is correct rather than a missed edit.

**Do not touch `src/lib/navigation-path.test.ts`.** Its `/repos/...` strings are inputs to a percent-encoding normaliser, not route assertions.

- [ ] **Step 2: Run the tests and confirm they fail — and count them**

Run: `pnpm test`
Expected: FAIL, in the 13 files edited above.

Then check the inverse, which is the more informative half:

```bash
pnpm test 2>&1 | tail -5
```

If a file you edited is *passing*, something is wrong — either the assertion never ran, or the path you changed was not the one the component builds. Chase it before continuing.

- [ ] **Step 3: Repoint the shared components**

`src/components/sidebar.tsx` — lines 40, 44-45, 50-52. Add the import and rewrite the four sites:

```tsx
import { dashboardPath, reposPath } from '../lib/app-routes';
```

```tsx
      <Brand as={Link} href={dashboardPath()} size="compact" />
```

```tsx
        <Link
          href={dashboardPath(query)}
          aria-current={pathname === dashboardPath() ? 'page' : undefined}
        >
          <span className="nav-number">01</span> Overview
        </Link>
        <Link
          href={reposPath(query)}
          aria-current={
            pathname === reposPath() || pathname.startsWith(`${reposPath()}/`) ? 'page' : undefined
          }
        >
          <span className="nav-number">02</span> Repositories
        </Link>
```

Keep the two-part shape of the repositories check. `pathname.startsWith(reposPath())` alone would also match a hypothetical `/app/reposXYZ`; the trailing slash is what makes it a subtree test.

`src/components/repository/tabs.ts:35-40` — `tabHref` becomes a wrapper, keeping its signature and its whole doc comment:

```ts
import { repoPath, repoSectionPath } from '../../lib/app-routes';
```

```ts
export function tabHref(repoId: string, tab: RepositoryTab, search = ''): string {
  return tab.segment
    ? repoSectionPath(repoId, tab.segment, search)
    : repoPath(repoId, search);
}
```

The `?`-normalisation this function used to do now lives in `withQuery`, so it comes out of here.

`src/components/account-menu.tsx:35,39`:

```tsx
import { accountSettingsPath, workspaceSettingsPath } from '../lib/app-routes';
```
```tsx
        <Link role="menuitem" href={accountSettingsPath()}>
```
```tsx
      <Link role="menuitem" href={workspaceSettingsPath()}>
```

`src/components/workspace-switcher.tsx:46,60`:

```tsx
import { dashboardPath, workspaceSettingsPath } from '../lib/app-routes';
```
```tsx
                  router.push(dashboardPath());
```
```tsx
            <Link role="menuitem" href={workspaceSettingsPath('#new-workspace')}>
```

`src/components/pr-table.tsx:67`:

```tsx
import { prPath } from '../lib/app-routes';
```
```tsx
                <Link href={prPath(pr.id)}>
```

Leave line 91 alone — `${githubUrl}/pull/...` is an external GitHub URL.

`src/components/app-shell.tsx:22` — **the breadcrumb's root half.** The trail is
built in two places: `AppShell` prepends the workspace crumb, and each section
layout supplies the rest, because only the layout knows the repository's name.
Both halves need the prefix or the trail carries a dead link.

```tsx
import { dashboardPath } from '../lib/app-routes';
```
```tsx
  const trail: Crumb[] = [{ label: active.name, href: dashboardPath() }, ...crumbs];
```

`src/components/repository/header.tsx` needs **no** edit in this task — its only
`href` is the external `githubRepositoryUrl(repo)`.

`src/components/repository/coverage-strip.tsx:67`:

```tsx
import { repoSectionPath } from '../../lib/app-routes';
```
```tsx
      <Link className="cov-link" href={repoSectionPath(repo.id, 'settings')}>
```

`src/components/agents/agents-involved.tsx:81`:

```tsx
import { repoSectionPath } from '../../lib/app-routes';
```
```tsx
  const href = repoSectionPath(repoId, 'ai-involvement');
```

`src/components/act/act-entry.tsx:19`:

```tsx
import { actRunPath } from '../../lib/app-routes';
```
```tsx
  const href = actRunPath(repositoryId, latest?.id ?? '');
```

`src/components/onboarding/repository-picker.tsx:48`:

```tsx
import { dashboardPath } from '../../lib/app-routes';
```
```tsx
              <Link href={dashboardPath()}>View overview</Link>
```

Leave line 118 alone — `installUrl` is a GitHub App URL.

`src/components/onboarding/import-progress.tsx` — lines 67, 74 and 151, and **line 67 is one of the three silent failures**:

```tsx
import { dashboardPath, onboardingPath, repoPath } from '../../lib/app-routes';
```
```tsx
    if (window.location.pathname === onboardingPath()) {
```
```tsx
  const href = repoPath(repository.id);
```
```tsx
          This repository is no longer available. <Link href={dashboardPath()}>Back to overview</Link>
```

If line 66 is missed, the `history.replaceState` that writes `?repo=&run=` simply stops firing. No error, no failing test — the import just loses its resume parameters. Check it by hand.

- [ ] **Step 4: Repoint the pages and actions**

`src/app/not-found.tsx:7`:

```tsx
import { dashboardPath } from '../lib/app-routes';
```
```tsx
      <Link href={dashboardPath()}>Return to overview →</Link>
```

`src/app/api/auth/callback/route.ts:53` — **the one that sends every new sign-in somewhere**:

```ts
import { dashboardPath } from '../../../../lib/app-routes';
```
```ts
    return NextResponse.redirect(
      new URL(invitation ? `/invitations/${invitation}` : dashboardPath(), integrationEnv().APP_URL),
    );
```

The invitation branch is unchanged — `/invitations/[token]` is public and does not move.

`src/app/invitations/[token]/actions.ts:30`:

```ts
import { dashboardPath } from '../../../lib/app-routes';
```
```ts
  redirect(dashboardPath());
```

Leave lines 10, 20 and 27 alone — `/signed-out` and `/invitations/${token}` are public.

`src/app/app/dashboard/page.tsx:13,22,35`:

```tsx
import { dashboardPath, onboardingPath, reposPath } from '../../../lib/app-routes';
```
```tsx
  if (needsOnboarding(available, demo)) redirect(onboardingPath());
```
```tsx
    return <InvalidRange message={(error as Error).message} href={dashboardPath()} />;
```
```tsx
      <Link href={reposPath(rangeQuery(range, search))}>View repositories ↗</Link>
```

`src/app/app/repos/page.tsx:27,42,43,49`. This page wraps itself in `AppShell`
rather than getting one from a `repos/layout.tsx`, because the list page's
breadcrumb differs from the repository pages':

```tsx
import { dashboardPath, onboardingPath, repoPath, reposPath } from '../../../lib/app-routes';
```
```tsx
        <InvalidRange message={(error as Error).message} href={reposPath()} />
```
```tsx
          <Link href={dashboardPath(query)}>← Overview</Link>
          <Link href={onboardingPath()}>Add repository ↗</Link>
```
```tsx
                <Link href={repoPath(repo.id, query)}>
```

Its two `<AppShell crumbs={[{ label: 'All repositories' }]}>` wrappers carry no
`href`, so they need no edit — the label alone is the last crumb.

`src/app/app/repos/[repoId]/layout.tsx:32` — **the breadcrumb's other half.**
This is the crumb `AppShell` appends to the workspace root, and it is the one
that actually carries a link:

```tsx
import { reposPath } from '../../../../lib/app-routes';
```
```tsx
    <AppShell crumbs={[{ label: 'All repositories', href: reposPath() }, { label: repo.name }]}>
```

`src/app/app/repos/[repoId]/page.tsx:50,68,98`:

```tsx
import { repoPath, repoSectionPath } from '../../../../lib/app-routes';
```
```tsx
        href={repoPath(repoId)}
```
```tsx
        <Link href={repoSectionPath(repoId, 'delivery', query)}>Delivery</Link>.
```
```tsx
              <Link href={repoSectionPath(repoId, 'grading')}>Readiness</Link>.
```

`src/app/app/repos/[repoId]/grading/page.tsx:38`:

```tsx
import { repoSectionPath } from '../../../../../lib/app-routes';
```
```tsx
  const href = repoSectionPath(repoId, 'grading');
```

`src/app/app/repos/[repoId]/delivery/page.tsx:55,70`:

```tsx
import { repoSectionPath } from '../../../../../lib/app-routes';
```
```tsx
        href={repoSectionPath(repoId, 'delivery')}
```
```tsx
  const basePath = repoSectionPath(repoId, 'delivery');
```

`src/app/app/repos/[repoId]/act/[runId]/page.tsx:29`:

```tsx
import { repoSectionPath } from '../../../../../../lib/app-routes';
```
```tsx
        <Link href={repoSectionPath(repoId, 'grading')}>Back to readiness</Link>
```

`src/app/app/prs/[prId]/page.tsx:33`:

```tsx
import { repoPath } from '../../../../lib/app-routes';
```
```tsx
        <Link href={repoPath(repo.id)}>
```

`src/app/app/settings/account/page.tsx:17,20`:

```tsx
import { accountSettingsPath, workspaceSettingsPath } from '../../../../lib/app-routes';
```
```tsx
        <Link aria-current="page" href={accountSettingsPath()}>
```
```tsx
        <Link href={workspaceSettingsPath()}>Workspace</Link>
```

`src/app/app/settings/workspace/page.tsx:72,73,109,121`:

```tsx
import {
  accountSettingsPath,
  onboardingPath,
  repoPath,
  workspaceSettingsPath,
} from '../../../../lib/app-routes';
```
```tsx
        <Link href={accountSettingsPath()}>Account</Link>
        <Link aria-current="page" href={workspaceSettingsPath()}>
```
```tsx
                <Link href={repoPath(repo.id)}>
```
```tsx
              <Link className="settings-link" href={onboardingPath()}>
```

`src/app/app/onboarding/page.tsx:49,61`:

```tsx
import { dashboardPath, onboardingPath } from '../../../lib/app-routes';
```
```tsx
      {hasTracked && <Link href={dashboardPath()}>Back to overview</Link>}
```
```tsx
          <Link href={onboardingPath()}>Connect another repository</Link>
```

**The two `revalidatePath` files — silent failures two and three.** A `revalidatePath` naming a route that no longer exists does not throw; it revalidates nothing.

`src/app/app/repos/[repoId]/actions.ts:16,17,35,36`:

```ts
import { dashboardPath, repoPath, repoSectionPath } from '../../../../lib/app-routes';
```
```ts
  revalidatePath(dashboardPath());
  revalidatePath(repoPath(repositoryId));
```
```ts
  revalidatePath(repoSectionPath(repositoryId, 'settings'));
  revalidatePath(repoSectionPath(repositoryId, 'grading'));
```

`src/app/app/onboarding/actions.ts:29,30`:

```ts
import { dashboardPath, repoPath } from '../../../lib/app-routes';
```
```ts
  revalidatePath(dashboardPath());
  revalidatePath(repoPath(repositoryId));
```

Every import depth above is counted from the file's post-move location. If one is off, `pnpm typecheck` names it — a relative import that is off by a level cannot compile.

- [ ] **Step 5: Run the tests**

Run: `pnpm test`
Expected: PASS, everything.

Then confirm no literal survived anywhere it shouldn't:

```bash
grep -rn "'/dashboard\|\"/dashboard\|'/repos\|\"/repos\|'/prs\|\"/prs\|'/settings\|\"/settings\|'/onboarding\|\"/onboarding\|\`/dashboard\|\`/repos\|\`/prs\|\`/settings\|\`/onboarding" src --include="*.ts" --include="*.tsx" | grep -v "\.test\.ts"
```

Expected: no output. Every remaining unprefixed literal should be in a test file, where it belongs.

- [ ] **Step 6: Run the full gate including integration**

```bash
pnpm lint && pnpm typecheck && pnpm test
docker compose up -d
DEMO_MODE=false pnpm test:integration
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src
git commit -m "$(cat <<'EOF'
feat(routing): every internal link goes through app-routes

Three of these fail silently rather than 404: the six revalidatePath calls
no-op on a stale path, import-progress's pathname guard quietly stops writing
the ?repo=&run= resume params, and the sidebar's aria-current comparison drops
the current-page indicator without moving a pixel.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LwPfPoY8rRu1B4UPQDwJYw
EOF
)"
```

---

## Task 5: The legacy redirect table

**Files:**
- Modify: `next.config.ts`
- Create: `src/lib/legacy-redirects.test.ts`

**Interfaces:**
- Consumes: `appSections` and `appPrefix` from Task 2, read by the test only. `next.config.ts` itself imports nothing from `src/`.
- Produces: nothing downstream.

- [ ] **Step 1: Read the redirects doc**

Read `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md`. The three facts this task rests on: redirects are checked before the filesystem; query values provided in the request are passed through to the destination; `:path*` is zero-or-more, so `/blog/:slug*` matches `/blog` as well as `/blog/a/b/c`.

- [ ] **Step 2: Write the failing test**

The test lives under `src/` because `vitest.config.ts` includes only `src/**/*.test.ts` — a root-level `next.config.test.ts` would silently never run.

Create `src/lib/legacy-redirects.test.ts`:

```ts
import { expect, test } from 'vitest';
import {
  getRedirectUrl,
  unstable_getResponseFromNextConfig,
} from 'next/experimental/testing/server';
import nextConfig from '../../next.config';
import { appPrefix, appSections } from './app-routes';

// These drive the real redirect table from next.config.ts, not a copy of it.
// Paths are spelled out rather than built from appPrefix: the point is to
// assert what a browser actually receives.

const follow = async (pathAndQuery: string) => {
  const response = await unstable_getResponseFromNextConfig({
    url: `https://fieldnote.test${pathAndQuery}`,
    nextConfig,
  });
  return {
    status: response.status,
    location: getRedirectUrl(response),
  };
};

// The whole reason this is 308 rather than 307 is that the move is permanent.
// The cost is that browsers cache it forever and a wrong destination cannot be
// withdrawn, which is why the table is tested by exercise and not by shape.
test('a legacy deep link keeps its dynamic segment, its encoding and every query param', async () => {
  const { status, location } = await follow(
    '/repos/repository%3A1/delivery?days=90&projection=gate-policy',
  );
  expect(status).toBe(308);
  expect(location).toBe(
    'https://fieldnote.test/app/repos/repository%3A1/delivery?days=90&projection=gate-policy',
  );
});

// ?days= threads through the sidebar, the repo tab bar and the body links. A
// redirect that dropped it would silently reset every reader's date range.
test('an explicit from/to range survives the redirect', async () => {
  const { location } = await follow('/dashboard?from=2026-08-01&to=2026-08-30');
  expect(location).toBe(
    'https://fieldnote.test/app/dashboard?from=2026-08-01&to=2026-08-30',
  );
});

test('a bare section root redirects as well as a deep path', async () => {
  expect((await follow('/repos')).location).toBe('https://fieldnote.test/app/repos');
  expect((await follow('/prs')).location).toBe('https://fieldnote.test/app/prs');
  expect((await follow('/onboarding')).location).toBe('https://fieldnote.test/app/onboarding');
  expect((await follow('/settings/account')).location).toBe(
    'https://fieldnote.test/app/settings/account',
  );
});

test('bare /app lands on the overview', async () => {
  expect((await follow('/app')).location).toBe('https://fieldnote.test/app/dashboard');
});

// The regression test for the bug this whole change exists to fix. If / ever
// redirects again, the marketing site is invisible again.
//
// Asserted on the status rather than on getRedirectUrl() returning null: a
// non-match is defined by not being a redirect, and that holds whatever the
// helper hands back for a response with no Location.
test('/ is not redirected anywhere', async () => {
  expect([307, 308]).not.toContain((await follow('/')).status);
});

test('the public surfaces are left alone', async () => {
  for (const path of ['/signed-out', '/invitations/abc123', '/api/auth/login']) {
    expect([307, 308]).not.toContain((await follow(path)).status);
  }
});

// next.config.ts deliberately imports nothing from src/, so this is what keeps
// the table and the route module from drifting apart.
test('the table covers exactly the five sections app-routes names', async () => {
  const redirects = await nextConfig.redirects!();
  const sectionEntries = redirects.filter((entry) => entry.source !== appPrefix);
  expect(sectionEntries.map((entry) => entry.source).sort()).toEqual(
    [...appSections].map((section) => `/${section}/:path*`).sort(),
  );
  for (const entry of sectionEntries) {
    expect(entry.destination).toBe(`${appPrefix}${entry.source}`);
    expect(entry.permanent).toBe(true);
  }
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/legacy-redirects.test.ts`
Expected: FAIL. `nextConfig.redirects` is undefined, so the drift test throws and every `follow` returns no redirect.

If instead it fails on the import of `next/experimental/testing/server`, confirm the module is present — `ls node_modules/next/experimental/testing/` should list `server.js` and `server.d.ts`.

- [ ] **Step 4: Write the redirect table**

Replace `next.config.ts` entirely:

```ts
import type { NextConfig } from 'next';

// The product moved from the URL root to /app so that / could become the
// marketing site. These keep every link, bookmark and pasted URL from before
// the move working.
//
// `:path*` is zero-or-more, so one entry per section covers both the bare
// section root and any depth beneath it. Query values are carried to the
// destination by Next itself — which is what keeps ?days=, ?from=/?to= and
// ?projection= alive through a redirect, and is the main reason this is a
// config table rather than a redirect() in a page.
//
// 308, because the move is permanent. The cost is that a browser caches it
// indefinitely and a wrong destination cannot be withdrawn from anyone who
// already followed it, so src/lib/legacy-redirects.test.ts exercises every
// entry against a real URL rather than inspecting the table's shape.
//
// This file imports nothing from src/ on purpose. The same test asserts these
// sources match src/lib/app-routes.ts's `appSections`, so the two cannot drift
// without a build-time dependency from the config into application code.
const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  redirects: async () => [
    { source: '/dashboard/:path*', destination: '/app/dashboard/:path*', permanent: true },
    { source: '/repos/:path*', destination: '/app/repos/:path*', permanent: true },
    { source: '/prs/:path*', destination: '/app/prs/:path*', permanent: true },
    { source: '/settings/:path*', destination: '/app/settings/:path*', permanent: true },
    { source: '/onboarding/:path*', destination: '/app/onboarding/:path*', permanent: true },
    { source: '/app', destination: '/app/dashboard', permanent: true },
  ],
};
export default config;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/legacy-redirects.test.ts`
Expected: PASS, seven tests.

- [ ] **Step 6: Run the full gate**

```bash
pnpm lint && pnpm typecheck && pnpm test
docker compose up -d
DEMO_MODE=false pnpm test:integration
```

Expected: PASS. This is the branch's complete gate.

- [ ] **Step 7: Commit**

```bash
git add next.config.ts src/lib/legacy-redirects.test.ts
git commit -m "$(cat <<'EOF'
feat(routing): old URLs 308 to their /app equivalent

Path, dynamic segment, percent-encoding and query string all survive, so a
bookmarked ?days=90 does not silently reset anyone's date range. Tested by
driving the real table through unstable_getResponseFromNextConfig rather than
by inspecting its shape — a wrong 308 cannot be withdrawn from a browser cache.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LwPfPoY8rRu1B4UPQDwJYw
EOF
)"
```

---

## Manual verification before the branch is handed over

The suite cannot see a rendered page. Run the app and click:

```bash
docker compose up -d
pnpm dev:demo
```

1. `/` renders the marketing page. Open it again with a session — still the marketing page, no bounce. **This is the reported bug.**
2. `/dashboard?days=90` in the address bar lands on `/app/dashboard?days=90`, and the range is 90 days, not the default.
3. `/repos/<some-repo-id>/delivery?days=7` lands on the `/app` equivalent with the range intact, and the repo tab bar carries `?days=7` across all five tabs.
4. The sidebar shows Repositories as the current page (`aria-current`) while on `/app/repos`.
5. `/app` alone lands on the overview.
6. Tab to the first element on `/app/dashboard` — "Skip to content" appears and moves focus into the page.

The sign-in callback is covered by `src/auth/invitation-routes.test.ts:82`, which drives the real route with a mocked token exchange and needs no GitHub credentials — so it does not need a manual pass, but a real sign-in on a deploy preview is worth doing before this reaches users, because a wrong 308 cannot be withdrawn.

## Known gaps this branch does not close

Both are named in the spec as out of scope. Neither is a regression.

- **The landing page offers a signed-in visitor no way into the product.** They see the same "Continue with GitHub" a stranger sees. That is a `SiteNav` change, and this branch is routing only. `/app` redirecting to the overview at least leaves a short URL to type.
- **`src/app/not-found.tsx` supplies no `<main id="main-content">`,** so the root layout's skip link points at nothing there. Predates this change, but a mistyped `/app/…` now lands on it more often.
