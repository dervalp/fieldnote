# The grader factory, slice 5: the public card and the badge

**Status:** design, approved in conversation 2026-09-14. No implementation yet.

Slices 1–4 built a contract, three graders on it, an evidence path that gives a
grader exactly what it asked for, and a sandbox a grader's program can run in.
Every grade still lives behind a sign-in. The slice 1 design said where a card
may appear — "in-app always; a public URL and a README pill per repository per
grader, opt-in and revocable" — and that the two ship together: "a card nobody
can link to is not a growth loop, and a pill with nothing behind it is a
sticker."

The sentence this slice is built around:

> A team can show a grade to the world, and take it back, without showing
> anything it did not choose to.

The binding rule still holds: a built-in grader is an ordinary grader. The
public page and the badge read a manifest's identity and a stored result; they
branch on no grader id.

## What was decided in conversation

| # | Question | Decision |
| --- | --- | --- |
| 1 | Slice 5 as sketched — registry, publishing, the public card and the pill | **Split in two, both in PR #26.** Slice 5 is the public card and the badge for the graders that exist. Slice 6 is the registry, publishing, human review and install. The badge does not wait on a staff role and database-stored graders that nothing has yet. |
| 2 | Open question 1 — where a grader lives before install | **A fieldnote-hosted registry.** Slice 6. |
| 3 | Open question 2 — what `verified` asserts | **That a person at fieldnote read the grader.** Slice 6. |
| 4 | Open question 4 — the bottom two rungs | **Softened.** 0–49 "Bad" becomes **Early**; 50–69 "Mediocre" becomes **Improving**. This slice. |
| 5 | May a low grade be shared | **Yes, any grade.** Sharing is opt-in; a badge that only exists for good scores means less. |
| 6 | Who may share | **Workspace owners only.** Making something public is a bigger step than running a grade. |
| 7 | Whether the public page shows evidence file names | **Only for public GitHub repositories.** A private repository's public page shows every check, its sentence and its count, and no file name. |
| 8 | The shape of a public link | **Readable:** `/r/<owner>/<repo>/<grader owner>/<grader name>`, with `/badge.svg` beneath it. Chosen over opaque tokens because a badge has to be recognisable to spread. The enumeration risk is closed by making every non-shared address indistinguishable. |
| 9 | When a grade is stale | **More than 30 days since fieldnote last confirmed it still holds** — see [Staleness](#staleness). |

## What this slice is not

- **No registry, publishing, review, `verified` badge or install.** Slice 6.
- **No consent prompt, no uninstall.** Both only mean something once a grader
  nobody at fieldnote wrote can be installed. Moved to slice 6 with the other
  items slice 3 deferred "to slice 5" — see [Moved to slice 6](#moved-to-slice-6).
- **Sharing never starts grading.** No run is created by a page view, a badge
  request or the switch.
- **No embeds beyond the badge and the share image.** No iframe card, no JSON API.
- **No model broker.** Still out of PR #26 (open question 9).

## The switch

"Share publicly", one per grader, beside Run and the nightly switch on the
grades page. Owners of a workspace the repository is connected to can change it;
members see its state and cannot. Demo mode renders no switch.

**It belongs to the repository, not a workspace**, exactly as a schedule does:
one repository connected to two workspaces has one sharing state per grader, and
an owner in either can change it. When on, the switch shows the badge's
Markdown to copy.

| | |
| --- | --- |
| `public_grades` | `(repository_id, grader_id)` primary key. `enabled_by`, `workspace_id`, `enabled_at`, and a nullable `revoked_at`. |
| Shared | a row with `revoked_at IS NULL`. |
| Turning it off | sets `revoked_at`. **The row survives**, so a README's badge renders `private` rather than breaking. |
| Turning it on again | clears `revoked_at` and rewrites `enabled_by`, `workspace_id`, `enabled_at`. Links already in READMEs come back. |

The server action requires the owner role in the acting user's workspace and
that the repository is connected to it, through the same guards the schedule
switch uses; a member, a signed-out visitor and the demo workspace are refused.

## The public lookup

One session-free query module, `src/db/queries/public-grades.ts`, is the only
thing the public page, the badge and the share image read. It never calls the
session-bound queries (`accessibleRepositories`, `gradeSummaries`, …), and they
never learn about sharing.

`publicGrade(owner, repo, graderId, now)` returns one of three shapes and
nothing else:

```ts
type PublicGradeView =
  | { state: 'private' }
  | { state: 'ungraded'; repository: PublicRepository; grader: PublicGrader }
  | { state: 'graded'; repository: PublicRepository; grader: PublicGrader; grade: PublicGrade; stale: boolean };
```

**It returns `private` unless every one of these holds**, and it does not say
which failed:

- the grader id is registered;
- exactly one repository matches `owner`/`repo` case-insensitively with
  `active = true`, `is_demo = false`, and an active installation;
- that repository is still connected to at least one workspace;
- a `public_grades` row exists for the pair with `revoked_at IS NULL`;
- `DEMO_MODE` is not `true`.

**"Exactly one" is counted after the sharing join, not before it.** The query
asks for repositories that match the name *and* are shared, and refuses only
when that answers with more than one row. Two same-named repositories of which
one is shared therefore resolve to the shared one rather than to `private`. It
leaks nothing: the visitor learns only that this address is shared, which is
what an owner switched on, and the other repository is never named, counted or
hinted at — a shared repository with no namesake answers identically. Two rows
that are *both* shared still answer `private`, because then "which repository
is this" really is a guess.

**What it copies out, and only this.** `PublicRepository` is owner, name and
whether it is private. `PublicGrader` is the grader's id, the manifest's card
title, author, mode, category and disclaimer, and its `version`,
`evaluatorVersion` and check titles — all manifest constants, identical for
every repository that grader has ever scored, and all of them on screen: the
page prints the version and names each check, and compares the stored versions
against the manifest's to say when a report is historical. `PublicGrade` is the
score, the graded sha, the completion time, the rubric version, the evaluator
version, the window if any, and each check's id, status, points, `maxPoints`
and explanation — and paths **only when the repository is public**. `maxPoints`
is the rubric's own arithmetic, without which "20" is a number with no
denominator. A check's title is not copied per check — it is read from the
grader's `checkTitles`, one map for the whole page. `lineRanges` is present and
**always empty**, because a check is a `CheckResult` and that is the shape;
no range ever crosses, for a public repository or a private one.
`requested_by`, workspace, run id, trigger and every other stored field stay
behind. The stored `GradeResult` is never passed through whole.

**Which grade.** The latest `complete` run for the pair. An `insufficient` or
`failed` run after it does not replace it on a public page: a run that could not
score is the repository's current state in the app, not something to publish.
The page names the date the shown grade was computed. No completed run is
`ungraded`.

## The public page

`/r/[owner]/[repo]/[graderOwner]/[graderName]` — two segments for the grader,
because a grader id is `owner/name` and a catch-all segment cannot have a route
beneath it. No sign-in, no session read.

**Graded:** the grade card with the identity strip and the softened label; the
graded commit's short sha and date, and for a window grader the dates it scored;
a stale notice when stale; every check with its sentence and count, and for a
public repository its evidence links; the grader's disclaimer; one link to
fieldnote.

**Ungraded:** the grader's identity and "Not graded yet."

**Private:** one page, "This grade is private.", identical for every address
that is not shared — no owner, repository or grader echoed from the URL, the
same status code, and `noindex`. Graded and ungraded pages may be indexed.

The page never renders the Run button, the nightly switch, the history list,
another grader's card, who ran a grade or which workspace.

## The badge

`/r/[owner]/[repo]/[graderOwner]/[graderName]/badge.svg`, a route handler
returning a two-part SVG pill: the grader's card title on the left, the result
on the right, coloured by finish.

| View | Right side |
| --- | --- |
| graded, fresh | `82 · Very good` in the finish colour |
| graded, stale | `stale`, neutral |
| ungraded | `not graded`, neutral |
| private | `private`, neutral, with a generic left side (`fieldnote`) so nothing from the URL is echoed |

**It never names a check.** Evidence requires the click, as slice 1 recorded.

Every text in the SVG is escaped; card titles are manifest strings and slice 6
makes manifests come from strangers.

**Caching:** `Cache-Control: public, max-age=300, s-maxage=300`, the same for
every state. GitHub proxies README images, and a busy README must not reach the
database on every view.

## The share image

`opengraph-image` beside the page, through Next's metadata file convention and
`ImageResponse`. It shows the card — score, finish, label, grader title,
repository — and no checks or file names. Stale shows the score with a "stale"
mark; ungraded and private show a generic fieldnote image with nothing from the
URL. Read Next 16's `opengraph-image` reference in `node_modules/next/dist/docs`
before building it; this repository's Next differs from older versions.

## Staleness

The slice 1 design said a pill renders `stale` when the grade is "older than its
grader's `minInterval`". No manifest has that field, and adding one changes the
hashed rubric of all three graders. Instead:

> **A grade is stale when more than 30 days have passed since fieldnote last
> confirmed it still holds.**

A grade is confirmed when it is computed, and again **each night the scheduler
skips it because nothing changed** — same head commit, same grader version. That
skip is exactly the evidence that the grade still describes the repository. So:

- **`grade_runs.confirmed_at`**, nullable. `scheduleIfDue`'s skip sets it on the
  run it matched (`latestFinishedGrade` gains the run id).
- **Freshness** is `max(completed_at, confirmed_at)` of the shown run; stale when
  `now − freshness > 30 days`. One constant, `STALE_AFTER_DAYS = 30`.
- **A skip only confirms the run it matched.** If the latest finished run is an
  `insufficient` one, the older complete run the public page shows is not
  confirmed by it, and ages.
- **A window grader is never confirmed by a skip**, because it never skips; with
  nightly grading on it runs every night, which confirms it by completing.

A quiet repository with nightly grading on stays fresh; a grade nobody re-checks
goes stale after a month. A per-grader interval can arrive with the registry,
when a manifest field is worth a version bump.

**Stored data does not change meaning.** `confirmed_at` is outside `result`, so
`getGrade`, history and the immutability of a completed result are untouched.

## The softened labels

`gradePresentation()` returns **Early** for 0–49 and **Improving** for 50–69.
Thresholds, finishes, colours and symbols are unchanged. Every surface reads the
label from that one function — cards, reports, the landing page's ladder and
hero, and now the badge — so the change is one place plus the tests and comments
that quote the old words.

## Open question 8, settled

**Schedules do not expire.** A nightly schedule on a repository nobody opens
keeps running. This slice gives some of those runs a reader — a shared badge —
and gives an unread, unscheduled grade a visible signal: it goes `stale`. A cap or
quota belongs with the first bill, as slice 3 said. `listGradeSchedules()` still
has no `LIMIT`, recorded again below rather than fixed here.

## Moved to slice 6

Each of these was deferred "to slice 5" by slice 3. Each only matters once a
grader fieldnote did not write can be installed, which is slice 6.

- **The install consent prompt**, generated from `needs`, in `collectEvidence()`
  and nowhere else. A code grader's `needs` is a ceiling (slice 4).
- **Uninstall deletes `grade_schedules` rows** — and now `public_grades` rows,
  for the same reason: a reinstall must not silently resume sharing nobody
  re-chose.
- **Reconnection.** Today a reconnected repository resumes its schedules under
  their original enabler, and — because sharing is evaluated live against the
  row — resumes sharing. Recorded as current behaviour; slice 6 decides whether
  it is right.
- **Schedules and sharing belong to the repository, not a workspace.** Confirmed
  for sharing in this slice (see [The switch](#the-switch)); slice 6 revisits it if
  install is per workspace.

## What is knowingly wrong

**A renamed or transferred repository breaks its badge.** The link names the
GitHub owner and repository. Renaming it on GitHub makes the old link render
`private` until the README is updated.

**Turning sharing off takes up to five minutes to reach a cached badge.** The
cache that keeps READMEs off the database also holds the last answer.

**A private repository's shared page still reveals its score, its check names
and its counts** — only file names are withheld. An owner chooses that when they
switch it on; the switch's copy says so.

**Whether a repository is private is read from a cached column, and nothing
watches GitHub for the flip.** `publicGrade` decides whether evidence paths
reach an anonymous page from `repositories.is_private`, which is written only by
`reconcileInstallation()` — on an `installation` or `installation_repositories`
webhook, and on the sign-in access check when an installation is missing
locally or a grant has no matching repository. GitHub sends neither when a
repository's visibility flips, so a repository shared while public and later
made private keeps publishing its file paths until some unrelated event
resyncs the installation. Closing it means subscribing to GitHub's `repository`
event (`privatized`/`publicized`), which this App does not subscribe to today
(see `docs/github-app.md`) — a configuration change, not only a code one — so
it waits for a slice that can make it. Until then: **an operator who makes a
shared repository private should turn its sharing off, or re-grant the
installation, rather than assume the public page notices.** Nothing else leaks
— the score, check names and counts were already chosen when sharing was
switched on — and the badge and the share image never carry a file name in any
state.

**A shared delivery score changes every night by design.** The page names the
window it scored.

**Stale is age since confirmation, not "the head has moved".** A repository
with nightly grading off whose head moved yesterday still shows a fresh badge for
up to 30 days after its last grade. Detecting a moved head needs a GitHub call per
badge view, which the cache is there to avoid.

**`listGradeSchedules()` still has no `LIMIT`.** Unchanged from slice 3.

## Testing

**The acceptance test is unchanged.**
[`readiness-v01.test.ts`](../../../src/domain/grading/readiness-v01.test.ts)
passes byte-identical to `main`. The frozen rubric hashes pinned in slice 4 do not
move — no manifest changes in this slice.

- **Indistinguishable when not shared.** An unknown owner, an unknown repository,
  an unregistered grader, a never-shared pair, a revoked pair, an inactive
  repository, an inactive installation, a repository connected to no workspace, a
  demo repository, and `DEMO_MODE=true` all produce **byte-identical** page HTML,
  badge SVG and status codes. One test, one list, compared to each other.
- **No file names for a private repository.** A shared private repository whose
  stored result has paths produces a page, badge and share image containing none
  of them; a public repository's page contains them.
- **Only copied fields leave.** `publicGrade` output for a graded pair has exactly
  the keys the spec lists; no `requestedBy`, workspace, run id or line range.
- **Latest scored grade.** A later `insufficient` or `failed` run does not change
  the public grade; no complete run is `ungraded`.
- **Stale.** Fresh at 30 days, stale just past it; a nightly skip that matched the
  shown run resets the clock; a skip that matched a later insufficient run does
  not; a window grader is never confirmed by a skip.
- **Badge.** Each state renders its right side; no check id or title appears in any
  state; every manifest string is escaped; the cache header is present in every
  state.
- **The switch.** An owner can turn it on and off and on again, keeping the row; a
  member, a signed-out visitor and the demo workspace are refused; turning it on
  rewrites the enabler.
- **Labels.** 0, 49 → Early; 50, 69 → Improving; 70 → Good; nothing else moves.
- **Integration.** A repository is shared, graded, revoked and re-shared against
  the real database, and the page and badge follow each step.

`pnpm check` — lint, typecheck, test, test:integration, build — is the gate, with
`DEMO_MODE=false` for the integration run.

## Open questions

Open questions 1, 2 and 4 are answered by decisions 2–4 above; 1 and 2 are built in
slice 6. Question 3 (AGPL) stays deferred and still blocks whichever slice opens
`kind: code` to authors. Question 8 is settled above. Question 9 (the model broker)
is unchanged.
