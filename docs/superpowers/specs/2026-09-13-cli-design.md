# The fieldnote CLI

**Status:** design, approved in conversation 2026-09-13. No implementation yet.

fieldnote is a web application with a GitHub App behind it. Everything a
developer can learn about their repository, they learn by opening a browser and
leaving the place they were working.

This design adds a second surface. The binding rule, from which the rest
follows:

> The CLI and the web app are two renderings of one engine. Neither is the
> real one, and neither gets a code path the other cannot use.

That rule is what forces the execution decision below, and it is the reason
this document exists before any code does.

A [visual companion to this design](https://claude.ai/code/artifact/7f412105-082b-41a3-be68-1205d6b93921)
carries the architecture diagram, the launch banner and every command flow as
an animated replay. It is a conversation artifact, not an authority; where the
two disagree, this document wins.

## What was decided in conversation

Four questions were settled before this document was written. Each one closes
off alternatives a reader would otherwise reasonably propose.

| # | Question | Decision |
| --- | --- | --- |
| 1 | Where a grader executes when invoked from the CLI | **Server-side.** The CLI resolves a commit, requests a run, polls, and renders. It holds no grading logic. One engine, no drift — at the cost, named and accepted, that uncommitted work cannot be graded. |
| 2 | What `publish` / `add` / `update` target | **A fieldnote-hosted registry**, for review, revocation and a `verified` badge that means something. Specified here and in its own issue; **not built in this design.** |
| 3 | How the CLI ships | **An npm package, Node 24+**, from this pnpm workspace as `packages/cli`, importing the manifest schema and the domain rather than reimplementing either. |
| 4 | What the CLI says about itself on launch | **A banner carrying three checkable claims**, the Field Lines seal redrawn on the character grid, shown once per version and never to a pipe. |

## Scope

This design covers the whole CLI. It is built in two slices, each its own
implementation plan, each producing software that works on its own.

**Slice A — identity.** The package, the launch banner, `--help`, exit codes,
and `login` / `logout` / `whoami`. Ends with a CLI a developer can install and
sign in to. Ships nothing that grades.

**Slice B — `fieldnote run`.** The CLI grade endpoints, git resolution and the
uncommitted-work guard, the poll loop, and the result renderer. Ends with the
adoption hook: a score in the terminal you were already in.

**Out of scope, named so they are not smuggled in:**

- **The registry.** `publish`, `add` and `update` are designed in the visual
  companion and specified in their own issue. No registry endpoint, no
  marketplace, no install flow is built here. `add` and friends are not
  registered as commands at all — a command that exists and fails is worse
  than one that does not exist.
- **MCP.** `fieldnote mcp` ships as a placeholder subcommand that prints what
  it will do and exits `0`. Nothing behind it is built. It is in the command
  tree because a roadmap a user can read from the terminal is worth more than
  a hidden one, and because the placeholder is three lines.
- **Local grading.** Decision 1 forecloses it for now. The seam is recorded
  below so that if it ever arrives it arrives as `fieldnote run --local` and
  breaks no published grader.

## What this depends on

The grader factory's slice 1 has landed on `feat/grader-factory`:
`grade_runs.grader_id`, `grading_rubrics.manifest`, `registerGrader()`,
`getGrader()` and `runDeclarative()` all exist. **Slice B cannot be built
against `main` until that branch merges.** Slice A does not touch grading and
has no such dependency.

## The crux: a CLI token is not a session

This is the single piece of architecture that costs anything, and it is worth
stating plainly because every naive approach to it is wrong.

fieldnote's entire authorization stack reads cookies directly.
[`currentUser()`](../../../src/auth/session.ts) reads `cookies()`.
[`requireWorkspace()`](../../../src/workspaces/access.ts) reads `cookies()` for
the user *and* for the workspace preference. `requestGrade()` calls both. A
bearer token cannot reach any of it.

Three ways out, and why two are rejected:

- **Rejected — duplicate the authorization logic for `/api/cli/*`.** Two
  implementations of "may this principal grade this repository" is two places
  for a security bug to live, and they will diverge the first time one is
  fixed.
- **Rejected — have the CLI endpoint set a session cookie on itself.** It
  works, and it means a CLI token is silently promoted to a browser session
  with a browser session's blast radius. The token is the thing we are trying
  to keep small.
- **Chosen — make the principal explicit and request-scoped.** A new
  `src/auth/principal.ts` holds an `AsyncLocalStorage` carrying
  `{ userId, workspaceId, source: 'session' | 'cli' }`. `currentUser()` and
  `requireWorkspace()` consult it first and fall back to cookies when it is
  empty.

Every existing call site is untouched, because an empty store means the
cookie path, which is exactly today's behaviour. The CLI route handlers wrap
their body in `withPrincipal(...)` and the whole authorization stack —
`requireRepository`, membership checks, the demo-workspace guard, the advisory
locks in `requestGrade` — works unchanged and unduplicated.

`source` is carried because it is the field an audit log and a rate limit both
need, and adding it later means a migration.

### The token itself

A new `cli_tokens` table. Not a row in `sessions`: a session is a browser
credential with a seven-day life and a cookie's semantics, and conflating them
is how a revoked CLI token keeps working.

| Column | Why |
| --- | --- |
| `id` | `tokenHash(token)`, reusing [`crypto.ts`](../../../src/auth/crypto.ts). The plaintext is never stored, exactly as sessions already do it. |
| `user_id` | Who it acts as. |
| `workspace_id` | Pinned at issue. A token that follows a cookie preference is a token whose blast radius changes without anyone touching it. |
| `scope` | `grade` for now. The column exists so slice B and the registry do not need a migration. |
| `label` | What the user sees in the revocation list — hostname at issue, editable. |
| `created_at`, `last_used_at` | `last_used_at` is what makes a revocation list usable. Written at most once a minute, not per request. |
| `revoked_at` | Soft delete. A revoked token must be distinguishable from one that never existed, so the error can say which. |

**The token does not expire.** A CLI that logs you out weekly is a CLI people
stop using, and the failure mode of an expiring credential in CI is a broken
pipeline at 3am. The price is that revocation has to be real: a token list in
settings, `last_used_at` shown, and one-click revoke. That is scoped work in
slice A, not a footnote.

## Sign-in

The loopback-plus-PKCE handshake `vercel login` and `claude login` both use.
fieldnote runs no second identity provider: the browser leg reuses the existing
GitHub OAuth in [`oauth.ts`](../../../src/auth/oauth.ts) when there is no web
session already.

1. The CLI binds a loopback listener on an ephemeral port and generates a PKCE
   verifier and challenge. Nothing has been sent.
2. It opens the browser at `/cli/auth?challenge=…&redirect=http://127.0.0.1:<port>&code=<user code>`
   and prints the URL and the user code, so a machine with no browser is not a
   special case.
3. `/cli/auth` signs the user in through the existing flow if needed, then
   shows an approval screen naming **the workspace and the scope** before
   anything is granted.
4. On approval, fieldnote redirects to the loopback with a single-use code.
5. The CLI `POST`s the code and the verifier to `/api/cli/token`, receives the
   token once, and writes `~/.fieldnote/auth.json` at mode `0600`.

**The listener binds `127.0.0.1`, never `0.0.0.0`.** It accepts exactly one
request, enforces a 5-minute timeout, and verifies the `state` parameter. A
loopback listener that outlives its exchange is an open port on a laptop.

**Config precedence**, highest first: `FIELDNOTE_TOKEN` (the CI path — a token
in an environment variable never touches disk), then `~/.fieldnote/auth.json`,
then signed out.

## The launch banner

```
   ╭──────────
   │  ╭───────   ┌─┐┬┌─┐┬  ┌┬┐┌┐┌┌─┐┌┬┐┌─┐
   │  │  ╭────   ├─ │├─ │   ││││││ │ │ ├─
   │  │  │       └  ┴└─┘┴─┘─┴┘┘└┘└─┘ ┴ └─┘
   │  │  │       0.1.0 · AGPL-3.0-only
```

The seal is [`field-lines.svg`](../../design/fieldnote/field-lines.svg) on a
character grid: three concentric corners sharing one centre, verticals two
columns apart, horizontals one row apart, flush right and flush bottom — the
same geometry as the vector, at 8 units to 2 columns or 1 row. The wordmark is
drawn in the same box-drawing stroke so the lockup reads as one object. A block
figlet was considered and rejected: it fights a brand built on hairlines.

### The disclaimer

Three claims, and the design constraint is that **each one must be checkable**:

> fieldnote grades the repository you are standing in. Nothing on this machine
> is uploaded — fieldnote fetches the commit from GitHub, through the App you
> already installed.
>
> Every score is recomputed from that commit and replays the same way twice.
> Where a grader calls a model it has to declare it, and this terminal prints
> the declaration above the score — including for the graders we wrote
> ourselves.

Claim one is true because of decision 1. Claim two is true for a
`deterministic` grader. Claim three is enforced by the manifest's `mode`, not
by an author's manners.

**The final clause is load-bearing.** A disclosure rule that exempts the house
is a marketing line. It does not exempt the house, which is the same commitment
the grader factory already made: a built-in grader is an ordinary grader.

### When it renders

Shown on a bare `fieldnote`, on `--help`, and once after a version change
(tracked in `~/.fieldnote/state.json`). Not on every invocation: a banner a
user learns to scroll past is noise wearing a logo.

Never rendered when `process.stdout.isTTY` is false, when `--json` is passed,
when `CI` is set, or when `FIELDNOTE_NO_BANNER` is set.

### Degradation

Width comes from `process.stdout.columns` at render time, never assumed.

| Condition | Result |
| --- | --- |
| ≥ 46 columns | Full lockup. |
| < 46 columns | Seal kept, box wordmark dropped, name set in plain letters beside it. |
| < 30 columns | Seal dropped. `fieldnote 0.1.0` and the licence on two lines. |
| `NO_COLOR` | The ember goes; nothing else changes. The mark is legible as pure geometry. |
| `TERM=dumb` | No box drawing, no multibyte. ASCII only. |

The disclaimer re-wraps to the measured width. It is never truncated — a trust
claim cut off mid-sentence is worse than no claim.

## Output discipline

One check governs all of it: `process.stdout.isTTY`.

- **`--json`** prints the `GradeResult` and nothing else. Warnings go to
  stderr. A consumer piping to `jq` gets a parseable document or a non-zero
  exit, never a document with a banner glued to the front.
- **`CI` set** swaps the spinner for one append-only line per state
  transition. No carriage returns, no escape codes, no spinner frames: a CI log
  is read six weeks later by someone who was not there.
- **Colour** is a separate axis from layout, and respects `NO_COLOR`.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success. For `run`, the grader met its threshold. |
| `1` | Graded, below threshold. The evidence is on stdout. |
| `2` | Could not grade — no commit, no network, no permission. |
| `3` | Not signed in. Always recoverable by `fieldnote login`. |

The split between `1` and `2` is the whole reason `fieldnote run` is usable as
a CI gate with no wrapper script, and it is why the codes are specified here
rather than chosen during implementation.

## Package layout

`packages/cli`, a workspace package alongside `@fieldnote/design-system`.

| Path | Responsibility |
| --- | --- |
| `src/bin.ts` | The entry point. Argument parsing, dispatch, exit codes. Nothing else. |
| `src/brand.ts` | The seal, the wordmark, the disclaimer, and the width breakpoints. Pure: takes a width and a capability set, returns lines. |
| `src/render.ts` | TTY detection, colour, the spinner, the CI line writer. Every other module writes through it and none of them check `isTTY` themselves. |
| `src/config.ts` | `~/.fieldnote/auth.json` and `state.json`. Reads, writes, and the `FIELDNOTE_TOKEN` precedence. |
| `src/auth/login.ts` | The loopback listener, PKCE, the browser open, the exchange. |
| `src/api.ts` | The typed client for `/api/cli/*`. The only module that makes a network request. |

`brand.ts` being pure — width and capabilities in, lines out — is what makes
the degradation table testable without a terminal.

On the server side, `/api/cli/token` and `/api/cli/revoke` in slice A;
`/api/cli/grades` and `/api/cli/grades/[runId]` in slice B. They follow the
existing route-handler shape in
[`grades/[runId]/route.ts`](../../../src/app/api/repos/[repoId]/grades/[runId]/route.ts):
`private, no-store`, `unstable_rethrow`, and a 503 that says to try again.

## Testing

- **`brand.ts` is a table test.** Every row of the degradation table, asserted
  on exact output. The lockup's columns are checked by assertion, not by eye:
  each seal segment is 17 characters and each wordmark row is 25, and a test
  that fails when those drift is the only thing standing between this design
  and a wrapped logo.
- **The principal seam gets its own suite.** With an empty store,
  `currentUser()` and `requireWorkspace()` must behave exactly as they do
  today — the existing session tests must pass unchanged, which is the
  acceptance test for the refactor. With a store, they must not read cookies
  at all.
- **Token lifecycle.** Issue, use, revoke, use again. A revoked token returns a
  distinguishable error from an unknown one.
- **The loopback listener** binds `127.0.0.1`, accepts one request, rejects a
  mismatched `state`, and closes on timeout.
- **Output discipline** is tested by capturing stdout with `isTTY` forced both
  ways, asserting the banner is absent in one and present in the other.

## Open questions

Each blocks something later; none blocks slice A.

1. **Whether `--push` should exist.** Server-side grading needs a reachable
   commit. Offering to push is convenient and is also a CLI writing to someone's
   remote. *Blocks slice B's error copy, and nothing else.*
2. **Per-agent or per-repository for MCP.** Reporting a coding session means
   attributing it to an agent, and attribution is unbuilt work designed on
   `design/repository-ai-involvement`. Per-repository is the honest first
   version. *Blocks MCP.*
3. **What `verified` asserts in the registry** — that a human read the grader,
   or that a machine confirmed it declares no code and touches only approved
   primitives. *Blocks the registry.*
4. **Rate limiting `/api/cli/*`.** A poll loop is a well-behaved client; a
   broken one is a denial of service against our own Inngest quota. The
   `source: 'cli'` field exists so this can be answered without a migration.
   *Blocks slice B going public.*

## Risks

**The principal seam is a security refactor wearing a convenience hat.** It
touches the function every authorization check in the product calls. The
defence is that the empty-store path is byte-identical to today and the
existing suites prove it — which only works if those suites are run unchanged,
not adapted.

**A CLI that can only sign in is easy to ship and easy to stop at.** Slice A
produces no grade, and the adoption argument for this whole design lives in
slice B. The split exists to give a reviewer a real boundary, not to give the
roadmap a resting place.

**The banner is the most fun part of this design and the least important.** It
is specified in detail because getting it wrong is visible in the first thirty
characters a new user sees — not because it should be built first. It is one
pure module and one table test.
