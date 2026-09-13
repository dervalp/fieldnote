# The grader factory, slice 2: the identity strip and a second grader

**Status:** design, approved in conversation 2026-09-13. No implementation yet.

Slice 1 turned fieldnote's one compiled-in grader into a contract and moved the
readiness grader onto it. Nothing shipped that a user could see, which was the
point: the contract was tested against the one grader we already understood
while the cost of being wrong was a refactor.

This slice is the first one a user can see. It ships a second built-in grader,
gives the card the identity it has never needed until now, and answers the
question slice 1 deliberately deferred: what a repository shows once it has more
than one grade.

The binding rule from [the slice 1 design](2026-09-13-grader-factory-design.md)
still holds, and this slice is its first real test:

> A built-in grader is an ordinary grader. It gets no private interface, no
> extra evidence, and no code path of its own.

`fieldnote/delivery-health` is the second consumer of the contract. Every gap it
exposes is fixed in the contract, never around it.

## Open question 5, answered

> **What the dashboard shows when a repository has four grades.** Slice 1 keeps
> the current behaviour by naming the built-in explicitly at each call site.
> Slice 2 must decide: a primary grader per repository, an average, or a row of
> cards. *Blocks slice 2.*

**A row of cards.** The Readiness tab becomes **Grades** and renders one card per
registered grader, whether or not it has ever run. Selecting a card shows that
grader's report and history beneath it. There is no primary grader, no composite
score and no setting.

An average was rejected on the same grounds the category list is closed: the
graders answer different questions, and a mean of *"can an agent work here"* and
*"does work reach green cleanly"* is a number about nothing. A primary grader was
rejected because it is a preference to build, explain and migrate, in service of
keeping pages looking as they do today.

The repository's own **Agents** tab is untouched. It asks one question — *is this
repository working for agents?* — and the readiness card is its answer. A row of
cards there would answer a question that view is not asking.

There is no fleet dashboard showing grades today; `gradeSummaries()` is called
from the repository grading page and nowhere else. This slice adds none.

## What this slice is not

- **No registry, no publishing, no install flow.** Both built-ins are still
  registered at boot. Slice 5 owns the marketplace.
- **No sandbox and no `kind: code`.** Unchanged from slice 1: accepted by the
  schema, rejected by name at registration.
- **No evidence broker.** This slice adds a second collector and a dispatcher
  over exactly two scope families. Consent, caching, the history collector and
  the schedule remain slice 3's, and the dispatcher is named so it can be
  replaced rather than found.
- **No change to Act.** The Act leg stays readiness-only. See below.
- **No card design change beyond the identity strip.** No region is moved or
  restyled; one is added.
- **No landing-page change.** `RubricGrid` remains the five readiness checks.
  The public card is slice 5, and until then the marketing page describing one
  grader is accurate rather than stale.

## The second grader

`fieldnote/delivery-health`, category `delivery-health`, mode `deterministic`.

It was chosen over a second file-reading grader because it consumes
`fieldnote.metrics` — the scope family no competing tool can offer, and the one
that justifies the family existing. That choice has a cost, recorded in full
under *What is knowingly wrong* below, and taken deliberately.

Three checks over a fixed thirty-day window:

| Points | Check | Passes when |
| --- | --- | --- |
| 40 | Merges land clean | 60% or more of merged pull requests passed review and CI on the first attempt |
| 30 | CI ends green | 90% or more of CI runs finished successfully |
| 30 | Failures get fixed | 50% or more of failed runs later went green |

All three metrics are already computed for the Delivery tab, by
`aggregatePeriod()` into `MetricTotals`: `firstPass`, `ciSuccess` and
`ciRecovered`, each a `Rate` carrying numerator, denominator and a 0–100 value.
Nothing new is measured. The grader reads what the product already knows.

**A repository with too little merged work gets no score rather than a bad one.**
Below ten merged pull requests in the window the run reports no score, the way an
incomplete file collection already does. A quiet month is not a delivery failure,
and the alternative — scoring volume as a fourth check — makes the grader punish
a team for the size of its backlog.

**A metric with no denominator fails its check.** A repository with no CI runs in
the window does not pass *CI ends green* by vacuum. The measurement sentence says
so in words rather than printing a percentage of nothing.

## The contract changes

Four additions to `manifest.ts` and one to `types.ts`. Each exists because
delivery-health needs it; none is speculative.

### `needs` admits a second family

Today `needs` is a single required key. It becomes a set of families, at least
one of which must be present:

```ts
needs: {
  'repo.files'?: string[];              // unchanged; readiness declares this
  'fieldnote.metrics'?: {
    windowDays: 7 | 30 | 90;            // the product's own presets, and only those
    minMergedPullRequests: number;      // below this, do not score me
    insufficientReason: string;         // the grader's sentence when that happens
  };
}
```

`windowDays` is restricted to the three presets `resolveRange()` accepts, so a
manifest cannot name a window the collector is unable to build.
`minMergedPullRequests` and `insufficientReason` are the grader declaring the
floor below which its own evidence means nothing — the same kind of statement `needs`
already makes, which is why it lives there rather than in a new concept.

Two new registration invariants, each with its own error code:

- `needs_empty` — a manifest declaring no family at all.
- `needs_mismatch` — a manifest whose checks use a primitive the declared
  families cannot feed. A grader with a `metric-threshold` check and no
  `fieldnote.metrics` can never run; it is rejected at registration rather than
  at run time, when a repository would wear the failure.

### A fourth primitive: `metric-threshold`

```ts
primitive: 'metric-threshold',
args: {
  metric: 'first-pass-rate' | 'ci-success-rate' | 'ci-recovery-rate',
  atLeastPercent: number,   // integer, 0–100
}
```

The metric set is closed, for the reason the category set is closed, and it is
**extracted rather than invented**: all three values are read off `MetricTotals`
today and rendered on the Delivery tab. The extraction rule recorded in
`primitives.ts` holds — a proposed fourth metric with no grader behind it is
answered with `kind: code`, not a fifth entry.

### `card.title`

`GradeCard` hardcodes `<h2>Agent Readiness</h2>`, the string `Readiness v{version}`
in its footer, and `Agent readiness:` in its `aria-label`. A card that can render
two graders cannot hold one grader's name.

`card.title` is the grader's display name. The **author** is derived from the id
prefix — `fieldnote/delivery-health` is authored by `fieldnote` — so no field is
added for it. Version, mode and category are already on the manifest.

### `GradeResult.window`

```ts
window?: { start: string; endExclusive: string; days: number };
```

Optional, absent on a file-only grader, and written into `grade_runs.result`,
which is already `jsonb`. No migration.

This is the smallest honest response to the sliding-window problem below: a
saved report can name the dates it scored, so reopening it does not silently
mean a different thirty days.

### `RepositorySnapshot` gains metrics

```ts
export type MetricReading = {
  value: number | null;    // percentage on a 0-100 scale; null means no denominator
  numerator: number;
  denominator: number;
};

export type MetricsWindow = {
  days: 7 | 30 | 90;
  start: string;
  endExclusive: string;
  mergedPullRequests: number;
  'first-pass-rate': MetricReading;
  'ci-success-rate': MetricReading;
  'ci-recovery-rate': MetricReading;
};

export type RepositorySnapshot = {
  sha: string;
  complete: boolean;
  documents: SourceDocument[];
  metrics?: MetricsWindow | null;
  incompleteReason?: string;
};
```

The window is keyed by the primitive's own metric names, so `runCheck` is a
lookup rather than a switch, and adding a metric is a schema change in one
place.

`metrics` is optional and `documents` stays required, which is what keeps
`readiness-v01.test.ts` byte-identical: every snapshot that suite constructs
still typechecks unchanged. That suite passing untouched is this slice's
acceptance test exactly as it was slice 1's.

`incompleteReason` moves onto the snapshot because there are now two reasons a
run has no score, and they belong to different authors. Collection failing is
fieldnote's sentence and stays the `INCOMPLETE` constant in `declarative.ts`.
*Not enough merged work to judge* is the grader's, and arrives from its own
`insufficientReason`. `runDeclarative()` prefers the snapshot's reason and falls
back to its own, and still knows nothing about which grader it is running.

## Evidence: a dispatcher, not a broker

`evaluateGradeRun()` currently refuses anything but `repo.files`:

```ts
if (Object.keys(manifest.needs).join() !== 'repo.files')
  throw new NonRetriableError('Grader needs evidence fieldnote cannot yet collect');
```

That assertion is replaced by `collectEvidence(manifest, repositoryId, sha)` in a
new `src/grading/evidence.ts`: a switch over the declared families that calls
`collectReadiness()` for `repo.files` and `collectMetrics()` for
`fieldnote.metrics`, and merges the result into one snapshot. It honours exactly
two families and throws by name on a third, which is the same refusal in a shape
that has somewhere to grow. Slice 3 replaces the file, not the call site.

`collectMetrics(repositoryId, needs['fieldnote.metrics'])` lives in
`src/db/queries/grade-metrics.ts` and wraps `loadBasicDashboard()`. It takes the
whole declared block rather than three arguments, because the window, the floor
and the sentence reported when the floor is not met are one statement by one
author. It marks the
snapshot incomplete when `DashboardData.coverage !== 'complete'`, and again when
`totals.merged` is below the grader's floor.

**On authorization.** `loadBasicDashboard()` documents that its repository ids
must come from `accessibleRepositories()` or `requireTrackedRepository()` for the
current request. A grade run has no session. It is authorized instead by
`validateGradeRun()`, which re-checks installation, workspace link, membership and
demo mode before collection and again before completion — the same route
`collectReadiness()` already relies on. `visiblePrIds()` is a flat per-repository
history cap with no session component, so the Free-plan limit applies identically.
This reasoning is recorded in a comment at the call site; it is the kind of thing
a reader is right to stop at.

The delivery grader still pins a commit. `grade_runs_result` requires a sha on
every complete run, and the sha records which revision of the repository the
window ended at, which is true and worth keeping even though no check reads it.

## The measurement sentence

A file check proves itself by naming paths and line ranges. A metric check has
nothing to point at, so its evidence is the number, and a metric check that
printed only the grader's prose would be a bare assertion.

`runCheck()` composes the reading into the explanation, between the grader's
sentence and the grader's disclaimer:

> Merges land clean. Measured 68% (36 of 53) over the 30 days ending 2026-09-13,
> against a 60% bar. This is a delivery record, not a judgement of the code.

With no denominator:

> CI did not finish green often enough. No CI runs completed in the 30 days
> ending 2026-09-13. This is a delivery record, not a judgement of the code.

The division of labour is the one slice 1 established: the grader writes the
prose, fieldnote writes the sentence it is in a position to write. `paths` and
`lineRanges` are empty arrays, and `GradeReport` renders the measurement in place
of the file list rather than an empty evidence block.

Linking a metric check to the Delivery tab for the same window is the obvious
next honesty, and is deliberately not built here: it is a route-aware link inside
a component that currently takes only a grade, and it can be added without a
contract change.

## The identity strip

One region on `GradeCard`, under the title:

```
fieldnote · v0.1.0 · Deterministic · Agent readiness
```

Author, version, mode, category. Four facts that were implicit while there was
one grader and become load-bearing the moment there are two — and the mode is
the honesty the slice 1 design traded the README's "no LLM judges" claim for.
It is shown wherever a grade is shown, which now includes every card in the row.

Mode display names go in `src/domain/grading/mode-names.ts`, beside
`finish-names.ts`, for the same reason: a user-facing word for a schema value is
domain knowledge, tested where it lives, never spelled in a component.

`GradeCardProps` gains `title`, `author`, `mode` and `category`; the h2, the
footer's rubric line and the `aria-label` all read `title`. `gradeCardProps()` is
still the one seam between the grading domain and the design system, and still
resolves everything from the manifest the caller names.

`GradeBanner` is unchanged. It is the phone-width fallback on the Agents tab,
where there is exactly one card and no ambiguity about whose grade it is.

## The Grades tab

The route stays `/repos/[repoId]/grading`. Only the tab label changes, from
**Readiness** to **Grades** — a route rename buys a redirect and nothing else.

The page renders one card per registered grader, in registration order, from a
new `listGraders()` on the registry. A grader that has never run renders the
existing *Not graded yet* tile with its own Run button, so a second grader
advertises itself before anyone has used it.

`?grader=` selects which report and history are shown, defaulting to
`fieldnote/agent-readiness`. An unregistered value is a 404: the page resolves it through
`getGrader()`, which already throws `unknown_grader`, and calls `notFound()`.
`?run=` keeps its meaning, scoped to the selected grader.

`GradeControls` becomes per-grader. `runGrade(repositoryId)` takes a `graderId`,
validated through `getGrader()` before anything else, and `requestGrade()` is
already keyed per grader — its advisory lock, its unique index and its retry
lookup all name `graderId` as of slice 1, so two graders can run at once on one
repository with no further change. The status polling route is keyed by run id
and is untouched.

`gradeSummaries(repositoryIds, graderId)` generalises to take `graderIds:
string[]`, and `GradeSummary` gains `graderId`. It has one call site, so a second
near-identical function would be two things to keep in step for no gain.
`gradeHistory()` and `getGrade()` stay per-grader and are called for the selected
one. `latestGrade()` is untouched: its callers — the Agents tab and
`authoring-runs.ts` — mean the readiness grade and continue to say so.

## Act is unchanged

`plan-repository.ts` and `authoring-runs.ts` keep naming
`fieldnote/agent-readiness`. `ActEntry` renders under the readiness report and
nowhere else.

Nothing an agent writes into a repository raises a first-pass rate. A plan
generated from *Merges land clean* would be a plausible document about an
unfixable thing, which is worse than no button.

A `actionable` flag on the manifest was considered and rejected for now: it is a
field on a public contract with one consumer, and the contract is still new
enough that adding a field is cheaper later than removing one. When a third
grader wants Act, the flag is the answer.

## The demo

`src/demo/fixtures.ts` computes its readiness grade with `runDeclarative()`
against a hand-written snapshot rather than writing the result out by hand. The
delivery grade is seeded the same way, from a hand-written `MetricsWindow`, so
the demo workspace shows two cards side by side. The demo is how anyone who has
not read this document sees what the slice did.

## What is knowingly wrong

**The delivery score moves on its own.** The window is the last thirty days,
computed at run time. The same commit scores differently next month, a repository
can lose a finish with nobody touching it, and re-running a grade never
reproduces an old one. This is not a bug to be found later; it is the cost of
grading a period with a contract that pins a commit, and it was chosen with the
alternatives on the table.

Three things contain it, and none of them fixes it:

1. `GradeResult.window` names the dates, so a saved report says what it scored.
2. The finish and the score are shown against that window on the card footer.
3. The history list keeps every run, so the drift is visible rather than
   surprising.

The real fix is a `subject` that means *a repository over a window* rather than
*a repository at a commit*, with the window pinned at request time. The manifest
already carries `subject` as a free string rejected by name for exactly this kind
of arrival. **This is recorded as open question 6 and blocks nothing in this
slice**, but it should be answered before a delivery grade is publishable — a
public card or a README pill showing a number that changes on its own is a
different promise from one that does not, and slice 5 must not discover that.

## Testing

**The acceptance test is unchanged and it is the same one.**
`readiness-v01.test.ts` must still pass **byte-identical to `main`**. Slice 1
proved the contract fit the grader it was extracted from; this slice proves that
fitting a second grader did not bend it. If that suite needs an edit, the
contract change is wrong and the edit is a failure to notice.

Beyond that:

- **Manifest schema.** `needs_empty`, `needs_mismatch` in both directions, a
  `windowDays` that is not a preset, and a `metric-threshold` with an
  out-of-range bar are each rejected at registration with a distinguishable
  error.
- **The primitive.** `metric-threshold` at the bar, one below it and one above;
  a reading with a null value fails; the measurement sentence is asserted
  verbatim in both the measured and the no-denominator forms.
- **The grader.** `fieldnote/delivery-health` registers, totals 100 points, and
  produces a known `GradeResult` from a fixed `MetricsWindow`.
- **The collector.** `collectMetrics()` maps each `Rate` to its reading;
  `coverage !== 'complete'` yields fieldnote's incomplete reason; fewer than ten
  merged pull requests yields the grader's.
- **The dispatcher.** `collectEvidence()` calls only the collectors a manifest
  declares, and refuses an undeclared family by name.
- **Integration.** Two runs for one repository under different `graderId`s are
  simultaneously active, and two under the same one are still refused.
- **The page.** Two cards render; `?grader=` selects the report; an unregistered
  `?grader=` is a 404; an ungraded grader renders its tile and its Run button.

`pnpm check` — lint, typecheck, test, test:integration, build — is the gate, with
`DEMO_MODE=false` on the command line for the integration run, as recorded in
slice 1.

## Open questions

Slice 1's five carry forward unchanged except the fifth, answered above. One is
added.

6. **What a grader grades, when it grades a period.** `subject: repository`
   means a repository at a pinned commit, and `fieldnote/delivery-health` grades
   thirty days that keep moving. A `repository_window` subject, with the range
   pinned at request time the way the sha is, would make a delivery grade
   reproducible. *Blocks nothing in this slice. Must be answered before a
   delivery grade is published — slice 5.*
