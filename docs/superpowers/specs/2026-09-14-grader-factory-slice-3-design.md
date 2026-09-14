# The grader factory, slice 3: the broker, the pinned window and the schedule

**Status:** design, approved in conversation 2026-09-14. No implementation yet.

Slice 1 turned one compiled-in grader into a contract. Slice 2 shipped a second
grader, the identity strip and a row of cards, and along the way built the
metrics collector and a dispatcher its own design called
[deliberately dumb](2026-09-13-grader-factory-slice-2-design.md).

This slice makes the contract true for a grader nobody in this repository
wrote. The sentence it is built around:

> A grader gets exactly the evidence it asked for, and a run says what it was
> pinned to.

Both halves are currently false. `collectReadiness()` decides what to read from
a hardcoded list and never looks at `needs['repo.files']`, so a third-party
grader asking for `src/**/*.ts` receives an empty document list and fails every
check. And `fieldnote/delivery-health` computes its window from wall clock at
execution time, so a run queued at 23:58 and executed at 00:03 scores a
different month than the one it was requested for.

The binding rule from [slice 1](2026-09-13-grader-factory-design.md) still
holds and is still what every decision below answers to:

> A built-in grader is an ordinary grader. It gets no private interface, no
> extra evidence, and no code path of its own.

## What this slice is not

The slice 1 sketch listed four things for slice 3. Two of them are removed
here, each because the thing it would attach to does not exist yet.

- **No `repo.tree` or `repo.history` collectors.** No primitive reads either
  family, and `parseManifest` rejects a manifest declaring a family no check
  reads — so neither can even be named in a manifest today. Building them now
  is exactly the speculation the extraction rule forbids. They arrive with the
  grader that earns them, most likely in slice 4.
- **No consent prompt.** Generating the install prompt from `needs` is the
  right design and it has no screen to live on: both graders register at boot
  and there is no install flow until slice 5. This slice makes the consent gap
  *real* rather than theoretical, and says below where the check belongs when
  slice 5 builds it.
- **No sandbox and no `kind: code`.** Unchanged since slice 1.
- **No registry, publishing or public card.** Slice 5.
- **No change to Act.** Unchanged since slice 2: the Act leg stays
  readiness-only.
- **No quota on scheduled grading.** Recorded as a known limit below rather
  than built.

## The broker

### What changes

`collectReadiness()` is not a `repo.files` collector wearing a general name. It
is the readiness grader, compiled in:

```ts
function relevant(path: string): boolean {
  return (
    path === 'AGENTS.md' ||
    path === 'CLAUDE.md' ||
    /^readme\.md$/i.test(path) ||
    (/^docs\//i.test(path) && /\.(?:md|markdown)$/i.test(path))
  );
}
```

It becomes `collectFiles(repositoryId, sha, patterns)`, matching tree entries
against the globs the manifest declared, through the existing
[`globToRegExp()`](../../../src/domain/grading/glob.ts) — which was written for
this, says so in its own docstring, and is already safe against a hostile
pattern because every construct it compiles is linear.

Three names go with it, for the reason slice 1 gave when it deleted
`check-titles.ts`: these are generic things wearing the first grader's name.

| Today | After |
| --- | --- |
| `src/github/collect-readiness.ts` | `src/github/collect-files.ts` |
| `collectReadiness()` | `collectFiles()` |
| `ReadinessCollectionError` | `FileCollectionError` |
| `resolveReadinessSha()` | `resolveHeadSha()` |

`ReadinessCollectionErrorCode` becomes `FileCollectionErrorCode`; its message
table moves with the class unchanged. The codes themselves are already
grader-agnostic: `repository_unavailable`,
`installation_unavailable`, `empty_repository`, `github_unavailable`,
`collection_failed`.

### Matching is always case-insensitive

`relevant()` accepts `readme.md` and `Docs/guide.md`; the readiness manifest
declares plain `README.md` and `docs/**/*.{md,markdown}`. Something has to give,
and the choice is between adding a per-pattern `caseInsensitive` flag to
`needs['repo.files']` and collecting case-insensitively for everyone.

**Collect case-insensitively.** The `needs` globs say *what to fetch*; the
checks do the real matching and each already carries its own `caseInsensitive`
— `file-exists.args`, `glob-count.args` and `heading-has-fence.args.scope[]`
all have one. Over-fetching a case variant of a file the grader explicitly
asked for is within what it asked for, and it is what the current code already
does. `needs['repo.files']` stays a plain `string[]`, no contract change, and
the readiness document set comes out identical — which is what keeps this
slice's acceptance test passing.

### fieldnote's caps become caps on everyone

The limits in `collect-readiness.ts` were written for one grader and are about
to bind all of them. They stay exactly as they are:

| Limit | Value |
| --- | --- |
| Tree entries walked | 10 000 |
| Documents collected | 200 |
| Bytes per file | 128 KiB |
| Bytes in total | 2 MiB |
| Wall clock per request | 30 s |

Exceeding any of them sets `complete: false`, which means the run has no score.
A partial read that produced a number would be a lie, and the whole product is
the argument behind the number.

One registration invariant is added, with its own error code:

- `needs_too_broad` — more than **20** patterns in `needs['repo.files']`. A
  manifest is untrusted input and every pattern is a regular expression run
  against every tree entry. Twenty is four times what either built-in needs.

### The dispatcher becomes the broker

`src/grading/evidence.ts` keeps its path and its exported name. Its body is
replaced; its call site in `evaluateGradeRun()` does not move. The signature
grows one argument, because the broker now needs to know when the run was
requested:

```ts
export async function collectEvidence(
  manifest: GraderManifest,
  repositoryId: string,
  sha: string,
  requestedAt: Date,
): Promise<CollectedEvidence>;
```

`HANDLED_FAMILIES` stays, and stays a literal set rather than something
inferred from the schema, for the reason its comment already gives: a family
added to `manifestSchema` without a branch here should fail loudly by name.

## The pinned window

`collectMetrics(repositoryId, need, now = new Date())` already takes the moment
it measures from. `resolveRange()` truncates to UTC calendar days. So pinning
the window is one argument:

```ts
const metrics = metricsNeed
  ? await collectMetrics(repositoryId, metricsNeed, requestedAt)
  : null;
```

`requestedAt` is `grade_runs.created_at`, which is the request time and is
already stored. **The pinning itself needs no migration and no new column** —
`evaluateGradeRun()` reads it off the run it has already loaded. The migrations
below belong to the new state and the schedule, not to this.

What this fixes is narrower than open question 6 and worth stating exactly: a
single run now scores one window for its whole life. A run that crosses
midnight between request and execution, and an Inngest retry of a failed run
hours later, both score the window the requester asked for. What it does not
fix is that re-running the grade tomorrow scores tomorrow's window — that is
not a bug, that is what a delivery grade is.

## `subject: repository_window`

`subject` is accepted as a free string and rejected for anything but
`repository`. It gains a second accepted value.

```
subject: repository | repository_window
```

And a registration invariant tying it to the evidence, with its own error code
`subject_mismatch`:

- A manifest declaring `fieldnote.metrics` **must** say `repository_window`.
- A manifest not declaring it **must** say `repository`.

The subject and the evidence then cannot disagree. A grader that reads a moving
window while claiming to grade a commit is the bug open question 6 described,
and after this it is unregistrable rather than merely undocumented.

This is done now rather than in slice 5 because **`subject` is immutable for
the life of a grader**. Today the only two graders are ours and nobody has
published against the contract, so changing it costs a version bump. After
slice 5 it is a breaking change to other people's work.

### The version bump

`fieldnote/delivery-health` goes to **0.2.0**. `subject` is part of the hashed
rubric definition, so leaving it at 0.1.0 would throw
`Rubric version definition mismatch` on the first grade request against any
database that already holds the 0.1.0 row — the same latent defect slice 2
found and fixed in its Task 13. Grade runs recorded against 0.1.0 keep pointing
at the 0.1.0 rubric row, which still exists and still renders.

`fieldnote/agent-readiness` is unchanged. It declares only `repo.files`, its
subject stays `repository`, and its version does not move.

## `insufficient` — a run that is not a failure

`runDeclarative()` already builds the complete result when there is no score —
every check, what it measured, and the grader's own sentence. `evaluateGradeRun()`
then throws all of it away, because `grade_runs_result` forbids a non-complete
run from storing a result. That is
[open question 7](2026-09-13-grader-factory-design.md#open-questions), and this
is its answer.

**A floor miss stops being a failure.** It gets its own state.

```
grade_runs_state   state IN ('queued','running','complete','failed','insufficient')

grade_runs_result
     (state = 'complete'     AND sha IS NOT NULL AND completed_at IS NOT NULL
                             AND result IS NOT NULL AND result->>'score' IS NOT NULL)
  OR (state = 'insufficient' AND sha IS NOT NULL AND completed_at IS NOT NULL
                             AND result IS NOT NULL AND result->>'score' IS NULL)
  OR (state NOT IN ('complete','insufficient') AND result IS NULL)
```

`grade_runs_score` needs no change: a SQL check constraint passes on NULL, so
`(result->>'score')::integer BETWEEN 0 AND 100` already tolerates a null score.
`grade_runs_one_active` needs no change: it names only `queued` and `running`.

**A collection failure stays `failed` and stores nothing.** Its check results
are noise — they failed because the evidence was missing, not because the
repository is lacking. The distinction is exactly the one slice 2 drew when it
split `incompleteCode` into `incomplete_collection` and `insufficient_evidence`,
and this is what that split was for.

`grade-runs.ts` gains one writer beside `completeGrade()` and `failGrade()`:

```ts
insufficientGrade(runId: string, result: GradeResult): Promise<void>
```

It writes `state: 'insufficient'`, the result, and `completed_at`, and asserts
what `completeGrade()` asserts in mirror image: the result's score must be
null. `failGrade()`'s existing `insufficient_evidence` error code becomes
unreachable from this path and is left in its whitelist, because a code
grader in slice 4 can still fail a floor without a result to store.

So `evaluateGradeRun()` branches on the code the broker already returns:

| `incompleteCode` | State | Stored |
| --- | --- | --- |
| `null` (complete) | `complete` | the result, with a score |
| `insufficient_evidence` | `insufficient` | the result, score null |
| `incomplete_collection` | `failed` | nothing; `error_code` only |

### Where it shows

- **The card** reads *Not scored* with the grader's sentence beneath it, not an
  error. The existing failure path on `GradeReport` already switches on
  `Status.errorCode`; this adds a state alongside it.
- **The report** renders the checks with their measurements and **without
  points**. The numbers are real and worth reading; the points are not, because
  nothing was scored, and printing 40/40 beside no score invites the arithmetic
  a reader would then do wrong.
- **History stays scored runs only.** `CompletedGrade` and the `completed()`
  helper in `grade-runs.ts` are unchanged, so `latestGrade()`,
  `latestCompletedGrade()`, `gradeHistory()` and `gradeSummaries().latest` all
  continue to mean *a grade*. An unscored run on the score-over-time list is
  the same lie as scoring a partial read.

An insufficient run is therefore visible as the repository's current state and
not as a point in its history. That is the honest reading of it: fieldnote
looked, and there was not enough to judge.

## The nightly schedule

### The switch

One per card, not one per repository. The graders answer different questions
and move at different speeds — a delivery grade changes on its own every day, a
readiness grade only when someone edits a file — and a repository-wide switch
would silently start grading with a grader installed in slice 5 that nobody
chose.

`repositories.act_enabled` is the precedent for a per-repository opt-in and is
the wrong shape here, so the switch gets its own table:

```
grade_schedules
  repository_id   text  not null  → repositories
  grader_id       text  not null
  enabled_by      text  not null  → users
  workspace_id    text  not null  → workspaces
  created_at      timestamptz not null
  primary key (repository_id, grader_id)
```

Presence means on; turning it off deletes the row. `enabled_by` and
`workspace_id` are not decoration: `grade_runs.requested_by` and
`requested_workspace_id` are both NOT NULL, and a scheduled run has to be
somebody's. They are the provenance it copies.

The page needs to render each toggle, so `grade-schedules.ts` also exports:

```ts
gradeSchedules(repositoryId: string): Promise<
  Record<string, { enabledBy: string; paused: boolean }>
>
```

keyed by grader id, absent meaning off. `paused` is step 2's condition
evaluated once for the page rather than inferred in a component: the card can
then say *paused* without knowing what membership is.

`setGradeSchedule(repositoryId, graderId, enabled)` is a server action beside
`runGrade`. It resolves the grader through `getGrader()` — which throws
`unknown_grader` — and checks workspace membership, repository connection and
demo mode by the same route `requestGrade()` does. The toggle sits beside each
card's Run button and works on a grader that has never run, the way the Run
button already does.

### The scheduler

A new Inngest function, `schedule-grades`, on `0 3 * * *`. Not the
`* * * * *` the reconcilers use: those recover dropped events, this creates
work. Three in the morning UTC rather than midnight, so the night's imports
have landed before anything reads them. It returns early under
`DEMO_MODE=true`, the way `reconcile-grades` does.

For each row in `grade_schedules`, in order:

1. **Skip an unavailable repository.** Inactive repository, inactive
   installation, or `is_demo`.
2. **Skip a paused schedule.** If `enabled_by` is no longer a member of
   `workspace_id`, or the workspace no longer has the repository connected,
   skip and leave the row in place. See below.
3. **Skip if a run is already active** for that `(repository_id, grader_id)`.
   `grade_runs_one_active` would refuse the insert anyway; skipping avoids
   manufacturing an error to swallow.
4. **Skip if nothing it reads has changed**, decided by `subject`:
   - `repository` — resolve the head sha through `resolveHeadSha()`. If it
     equals the sha of the most recent scored run for that grader, skip. Same
     commit, same manifest, same score; the row would be noise on the history
     list the product asks people to read.
   - `repository_window` — always run. The window moved by definition, which is
     the whole reason the subject exists.

   An idle repository therefore costs one sha lookup a night rather than a tree
   walk and a pile of blob fetches.
5. **Otherwise create the run and dispatch it** onto the existing queue, which
   is unchanged from the Run button down.

### The session-free request path

`requestGrade()` cannot be reused: it calls `currentUser()` and
`requireWorkspace()` on its first two lines. Its transaction body is exactly
right, though — the advisory lock keyed by grader, the workspace `for update`,
the availability join, the `retryOf` lookup and the conflict fallback.

That body is extracted as:

```ts
insertGradeRun(input: {
  repositoryId: string;
  graderId: string;
  manifest: GraderManifest;
  userId: string;
  workspaceId: string;
  trigger: 'manual' | 'schedule';
}): Promise<{ id: string; state: GradeRun['state'] }>
```

`requestGrade()` keeps its signature and becomes the session half: resolve the
grader, the repository, the workspace and the user, refuse the demo workspace,
`registerRubric()`, then call `insertGradeRun` with `trigger: 'manual'`.
`scheduleGrade()` is the scheduler's half: it has the repository, grader,
enabler and workspace from the schedule row, calls `registerRubric()` the same
way, and passes `trigger: 'schedule'`.

The availability join inside the extracted body still re-checks membership,
connection, installation and demo mode, so the scheduler cannot create a run
the session path would have refused.

`grade_runs` gains `trigger text not null default 'manual'`, constrained to
those two values. Without it a nightly run is indistinguishable from one the
enabler clicked, and "nobody asked for this run" stops being answerable.

### When the person who turned it on loses access

`validateGradeRun()` re-checks that `requested_by` is still a member of
`requested_workspace_id`, before collection and again before completion. A
scheduled run attributed to a departed user would therefore fail — every night,
for as long as the row exists.

**The schedule pauses; the row survives.** Step 2 above checks the same
conditions before creating anything, skips when they do not hold, and the card
shows the toggle as paused with one line saying why. Nothing is deleted, it
resumes by itself if the person's access comes back, and anyone else can take
it over by switching it off and on — which writes their own `enabled_by`.

The alternative was making `requested_by` nullable, adding the `trigger` value
as the discriminator, and teaching `validateGradeRun()` a schedule-shaped
authorization path that checks the workspace rather than a person. That is the
more truthful model of who asked for a scheduled run. It also weakens a
deliberately strict security check on the strength of a convenience, in a slice
that is already the largest of the five. It is not this slice's to do.

## What is knowingly wrong

**The consent gap becomes real.** Today a grader can only ever receive the
readiness paths, because the collector is hardcoded. After this slice a grader
receives whatever it declared, up to the caps — which is the point, and which
means an installed third-party grader could read any file in the repository.
Harmless while both graders are ours and register at boot, and the reason the
consent prompt is not merely deferred but *owed*. `collectEvidence()` is the
one place the check belongs, because it is the one place that knows both the
manifest's `needs` and the repository it is about to read. Slice 5 must not put
it anywhere else, and must not let an install flow ship without it.

**The window still includes the current day.** `resolveRange()` presets run to
`today + 1 day`, so a grade at 03:00 UTC scores twenty-nine whole days and
three hours. The Delivery tab has always done this and the numbers agree with
each other, which is worth more than either being separately tidier. Changing
it is a dashboard decision, not a grading one.

**A paused schedule needs a human to notice.** There is no email and no badge —
one line on the card, seen by whoever next opens the page. A repository whose
only grading advocate left the workspace stops being graded quietly.

**Nightly grading is uncapped.** Every enabled pair runs every night, bounded
only by how many people switch it on. The skip-if-unchanged rule keeps an idle
repository at one API call, which is what makes this acceptable now rather than
safe forever. A quota belongs with whatever first shows a bill.

## Testing

**The acceptance test is unchanged and it is still the same one.**
[`readiness-v01.test.ts`](../../../src/domain/grading/readiness-v01.test.ts)
must pass **byte-identical to `main`**. Slice 1 proved the contract fit the
grader it was extracted from; slice 2 proved a second grader did not bend it;
this slice proves that making the evidence path general did not change what the
first grader sees. If that suite needs an edit, the change is wrong and the
edit is a failure to notice.

`collect-readiness.test.ts` moves to `collect-files.test.ts` and **is** edited —
it tests the collector, and the collector's interface is what changed. It keeps
every case it has, exercised through the readiness manifest's declared globs
rather than the hardcoded predicate, and gains the cases below.

- **The broker.** A manifest declaring `src/**/*.ts` receives those files and
  not `README.md`. The readiness manifest's globs yield the same document set
  the hardcoded predicate produced, case variants included. A tree over the
  document cap yields `complete: false`. `collectEvidence()` calls only the
  collectors a manifest declares and refuses an undeclared family by name.
- **Registration.** More than twenty `repo.files` patterns is `needs_too_broad`.
  `fieldnote.metrics` with `subject: repository` is `subject_mismatch`, and so
  is `repository_window` with no metrics family. Each is distinguishable by
  code.
- **The pinned window.** `collectEvidence()` passes the run's `created_at` and
  not the wall clock: a run created on one UTC day and evaluated on the next
  produces the window of the first. `GradeResult.window` names it.
- **The state.** An `insufficient` run stores a result whose score is null and
  whose `incompleteReason` is the grader's sentence. The constraint refuses a
  null score on a `complete` run and a stored result on a `failed` one.
  `latestGrade()`, `gradeHistory()` and `gradeSummaries()` ignore insufficient
  runs. `GradeReport` renders the sentence and the measurements and prints no
  points.
- **The switch.** `setGradeSchedule` refuses an unknown grader, the demo
  workspace, and a user who is not a member. Enabling twice is idempotent.
- **The scheduler.** It picks up only enabled pairs; skips an inactive
  repository, an active run, and a `repository` grader whose head sha matches
  the last scored run; always runs a `repository_window` grader; skips and
  leaves the row when the enabler has lost access; does nothing under
  `DEMO_MODE=true`.
- **Integration.** A scheduled run is created and completes end to end with no
  session, and its row records `trigger: 'schedule'`.

`pnpm check` — lint, typecheck, test, test:integration, build — is the gate,
with `DEMO_MODE=false` on the command line for the integration run, as recorded
in slice 1.

## Open questions

Open question 6 is answered by `subject: repository_window` and the pinned
window. Open question 7 is answered by the `insufficient` state. Slice 1's
remaining four carry forward unchanged:

1. **Where does a grader live before it is installed?** *Blocks slice 5.*
2. **What does `verified` assert?** *Blocks slice 5.*
3. **AGPL and code graders.** *Blocks slice 4.*
4. **The bottom two rungs** — the "Bad" and "Mediocre" labels. *Blocks slice 5,
   and is cheap to change before then.*

One is added by this slice.

8. **What a schedule is worth to a repository nobody opens.** Nightly grading
   creates a run a night per enabled pair, and the only thing that reads them
   is someone visiting the page. A repository whose team stopped looking keeps
   costing API calls and accumulating rows forever. A schedule that expires
   after some months of nobody opening the page, or a digest that gives the
   runs a reader, would fix it. *Blocks nothing. Should be settled before the
   first bill, or before slice 5 gives a public card a reason to stay fresh.*
