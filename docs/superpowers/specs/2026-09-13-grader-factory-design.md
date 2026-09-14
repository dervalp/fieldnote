# The grader factory

**Status:** design, approved in conversation 2026-09-13. No implementation yet.

fieldnote has one grader. It is compiled in: `grade-repository.ts` imports
`collectReadiness` and `evaluateReadiness` directly, and every query in
[`grade-runs.ts`](../../../src/db/queries/grade-runs.ts) filters on
`readinessRubric.family`. Nothing about that is wrong — there has only ever been
one grader to run.

This design turns that one grader into a **contract** that people outside this
repository can publish against, and makes fieldnote's own graders the first
consumers of it. The binding rule, from which everything else follows:

> A built-in grader is an ordinary grader. It gets no private interface, no
> extra evidence, and no code path of its own.

That rule is not a preference. It is the only way to find out whether the
contract is any good before strangers depend on it.

## What was decided in conversation

Six questions were settled before this document was written. They are recorded
here because each one closes off alternatives a reader would otherwise
reasonably propose.

| # | Question | Decision |
| --- | --- | --- |
| 1 | The README's "no LLM judges anywhere in the pipeline" claim | Dropped. A grader declares its **mode** — `deterministic`, `llm` or `hybrid` — and the mode is shown wherever a grade is shown. Honesty by disclosure, not by prohibition. |
| 2 | How a third-party grader executes | Two kinds, one contract. A **declarative** grader is a manifest interpreted by fieldnote's own engine. A **code** grader ships code and runs sandboxed. Both emit the same `GradeResult`. |
| 3 | What a grader grades | A repository at a pinned commit. Only that, in v1. The manifest names the subject anyway, so a `pull_request` subject can arrive later without breaking published graders. |
| 4 | What evidence a manifest may request | Four scope families: `repo.tree`, `repo.files`, `repo.history`, `fieldnote.metrics`. |
| 5 | Who pays for a model call | fieldnote brokers every call; a grader never holds a key or touches the network. fieldnote's key covers built-ins and a free allowance; a workspace key lifts the cap. |
| 6 | Where a card may appear | In-app always; a public URL and a README pill per repository per grader, opt-in and revocable. |

A [visual companion to this design](https://claude.ai/code/artifact/06bb147a-2320-4eba-af53-4f3f5cf396c7)
carries the before/after architecture, the card anatomy and the pill. It is a
conversation artifact, not an authority; where the two disagree, this document
wins.

## What this slice is

**The contract, and the built-in readiness grader moved onto it.**

When this slice is done, `evaluateReadiness()` no longer exists as a function
fieldnote calls. In its place is a manifest, interpreted by a primitive engine,
producing byte-identical `GradeResult`s — proven by the existing
[`readiness-v01.test.ts`](../../../src/domain/grading/readiness-v01.test.ts)
suite passing unchanged against the new path.

Nothing ships that a user can see. That is the point. The slice exists to find
out whether the contract survives contact with the one grader we already
understand, while the cost of being wrong is a refactor rather than a breaking
change to other people's published work.

## What this slice is not

- **No second grader.** Proving the contract with one grader is the job; a
  second one would hide a contract flaw behind "well, it works for the other one".
- **No sandbox, no code graders, no model broker.** `kind: code` is accepted by
  the manifest schema and rejected at install with "not yet supported", so the
  schema does not need a migration when slice 4 lands.
- **No evidence broker.** The readiness grader needs `repo.files` and nothing
  else, and `collectReadiness()` already supplies exactly that. The manifest
  declares its `needs`; the collector that honours arbitrary `needs` is slice 3.
- **No registry, no marketplace, no publishing, no install flow.** Built-ins are
  registered at boot, the way `registerRubric()` already works.
- **No card design change.** The card is slice 2. The one exception is
  mechanical: the `rainbow` → `prismatic` rename below changes a selector name
  in `grade-card.css` and nothing else. No region is added, moved or restyled.
- **No scheduling.** Grades are still requested by a human.

## Naming

Three words are already taken in this repository and one is about to be.

### `tier` is taken

[`next-tier.ts`](../../../src/domain/grading/next-tier.ts) uses **tier** to mean
*the next grade band a repository could reach* — `NextTier.targetFinish`, and
the moves that would get it there. It is a user-facing word on the card.

So the execution distinction must not be "Tier A / Tier B". It is a column that
discriminates row types, which by the precedent set in the
[authoring runs design](2026-09-11-authoring-runs-and-plan-workflow-design.md)
is a **kind**:

```
kind: declarative | code
```

A **declarative grader** is its manifest. A **code grader** ships code. Never
"tier A", never "tier B", in schema, prose or interface.

### `family` becomes `grader`

`grade_runs.family` is already a grader identity — `grade_runs_one_active` is
unique per `(repository_id, family)`, which is exactly "one running grade per
grader per repository". It is the right constraint under a name chosen when
there was only one value to put in it.

| Today | Settled | |
| --- | --- | --- |
| `family: 'agent-readiness'` | `grader_id: 'fieldnote/agent-readiness'` | Namespaced by owner, because a marketplace has two people who both want the name `test-coverage`. Immutable for the life of a grader. |
| `rubric_version` | `rubric_version` | Unchanged. The versioned definition of checks and points. |
| `evaluator_version` | `evaluator_version` | Unchanged. What produced the result, recorded because a `code` grader's output cannot be promised replayable. |

`grading_rubrics` keeps its name and gains the manifest. A **rubric** stays what
the glossary already says it is: the immutable, versioned definition of checks
and their points. A **manifest** is the larger thing that contains a rubric plus
everything operational — needs, mode, budget, schedule, card, kind.

### `check` already means two things, and now three

The glossary flags the collision between a **readiness check** and a **CI
check**. This design adds a third sense: a **grader check** is one criterion in
any grader's rubric, identified by a check id.

A readiness check is now simply *a grader check belonging to
`fieldnote/agent-readiness`*. That is a narrowing, not a new term — and it means
`authoring_remedies.check_id` keeps meaning what it meant. Bare "check" remains
forbidden in new code and prose.

### `rainbow` becomes `prismatic`

[`finish-names.ts`](../../../src/domain/grading/finish-names.ts) already displays
`Prismatic · Perfect score`, and `tokens.css` already names the swatch
`--fn-grade-prismatic`. Only two places still say `rainbow`:
`GradePresentation['finish']` and the `[data-finish='rainbow']` selector in
`grade-card.css`.

The user-facing name has been prismatic all along. The code should say so. This
is a pure rename with no behaviour change, and it belongs in this slice, before
any grader outside this repository can observe the finish key. The type and the
selector must change in the same commit — renaming one without the other renders
a perfect score with no foil.

Note for anyone reading the token file and not the stylesheet: the purple
`#7359a3` is the band's **ink** — `--grade`, used for the score digits and the
symbols. The finish itself is the foil in `grade-card.css`, and it is already
prismatic. Prismatic is a finish, not a hue.

## The contract

A grader is a manifest. Everything fieldnote knows about a grader, it knows from
this file.

```yaml
id:       fieldnote/agent-readiness   # owner/name, immutable
version:  0.1.0                       # semver; a grade records the exact version
subject:  repository                  # v1 accepts only this value
mode:     deterministic               # deterministic | llm | hybrid
category: agent-readiness             # exactly one, from the closed set
kind:     declarative                 # declarative | code

needs:
  repo.files: ["README.md", "AGENTS.md", "CLAUDE.md", "docs/**/*.{md,markdown}"]

card:
  tagline: "Can an agent work in this repository at all?"
  groups:
    - { title: "Instructions", checks: [root-agent-instructions, root-readme] }
    - { title: "Documented commands", checks: [docs-markdown, documented-setup, documented-tests] }

checks:
  - id: root-agent-instructions
    title: "Agent instructions"
    points: 20
    primitive: file-exists
    args: { root: true, nonempty: true, anyOf: ["AGENTS.md", "CLAUDE.md"] }
  # ... four more, below
```

### Invariants the schema enforces

- **`checks[].points` must total exactly 100.** `grade_runs_score` already
  constrains the stored score to `BETWEEN 0 AND 100`, and `gradePresentation()`
  throws on anything outside that range. A grader whose points do not total 100
  is rejected at registration, not at run time.
- **Check ids are unique within a grader** and stable across versions. A check
  id that changes meaning between versions silently invalidates every
  `authoring_remedies.check_id` pointing at it.
- **`card.groups` must name every check exactly once.** A check missing from the
  groups would be invisible on the card while still counting toward the score.
- **`id` and `subject` are immutable.** Every other field may change with a
  version bump.

### What a grader never receives

Stated here because it is the load-bearing half of the contract, and because
slice 4 will be tempted to relax it:

Network access. An API key. The filesystem. Environment variables. Evidence
outside its declared `needs`. Any other repository or workspace. The ability to
emit markup, CSS or script.

## The primitives, and where they come from

A declarative grader composes its checks from primitives fieldnote provides.
The rule for adding one:

> A primitive is extracted from a grader that earned it. It is never
> speculated into existence.

Three primitives are needed for this slice, and all three already exist as code
inside `readiness-v01.ts`. They are being given a name and a config surface, not
written.

| Primitive | Extracted from | Config |
| --- | --- | --- |
| `file-exists` | `isRootFile()` + `presenceCheck()` | `root`, `nonempty`, `anyOf: string[]`, `caseInsensitive` |
| `glob-count` | `isDocsMarkdown()` + `presenceCheck()` | `pattern`, `nonempty`, `min` |
| `heading-has-fence` | `documentedCommand()` + `commandCheck()` | `headings: string[]`, `scope: glob[]` |

`heading-has-fence` is the interesting one. It is the markdown fence-and-heading
walker in `documentedCommand()` — the code that already handles nested fences,
tilde fences, closing-fence length, and heading depth resetting. It is ~60 lines
of carefully tested logic, and it is the single most reusable thing in the
grading domain. Naming it is most of the value of this slice.

Every primitive must produce a full `CheckResult` — including `paths` and
`lineRanges`. A primitive that cannot point at its own evidence is not
admissible, because evidence is the product.

### The readiness rubric, ported

| Check today | Primitive | Args |
| --- | --- | --- |
| `root-agent-instructions` | `file-exists` | root, nonempty, `anyOf: [AGENTS.md, CLAUDE.md]` |
| `root-readme` | `file-exists` | root, nonempty, `anyOf: [README.md]`, caseInsensitive |
| `docs-markdown` | `glob-count` | `docs/**/*.{md,markdown}`, nonempty, min 1 |
| `documented-setup` | `heading-has-fence` | `[setup, install, installation, getting started]` |
| `documented-tests` | `heading-has-fence` | `[test, testing, validation, verification, checks]` |

Five checks, 20 points each, totalling 100. It ports exactly.

## What moves out of fieldnote's core

This is the part that proves the contract, and the part most likely to be
skipped under time pressure. Three modules in `src/domain/grading/` are
readiness-specific prose wearing generic names. Each must move into the
built-in grader's own manifest, or the contract is a fiction.

| Module | Today | After |
| --- | --- | --- |
| [`check-titles.ts`](../../../src/domain/grading/check-titles.ts) | A `Record` of the five readiness check ids to display titles | `checks[].title` in the manifest. The module is deleted. |
| [`flavour.ts`](../../../src/domain/grading/flavour.ts) | Six lines of readiness prose keyed by finish — *"An agent will guess…"* | `card.tagline` in the manifest. One line per grader, not six per finish. |
| [`finish-names.ts`](../../../src/domain/grading/finish-names.ts) | `Common · Flat finish`, `Prismatic · Perfect score` | Stays in core. This describes the **finish**, which belongs to fieldnote and not to any grader. |

`flavour.ts` is the one that costs something. Today the flavour line varies by
finish — a repository at 38 and one at 94 read different sentences, and those
sentences are good. Under the contract, a grader supplies one tagline and the
finish supplies the rest.

**This is a deliberate loss, and it is recoverable.** The per-finish voice was
never generic; it was an essay about agent readiness specifically, which is why
it cannot survive as core behaviour. If it turns out the card is worse without
it, the manifest can grow `card.flavour: Record<finish, string>` as an optional
author slot in slice 2 — and then every grader can have that voice, not just
ours. Do not smuggle the readiness prose back into core to avoid the regression.

[`next-tier.ts`](../../../src/domain/grading/next-tier.ts) stays in core
unchanged. It already operates on `CheckResult[]` and `maxPoints` alone, with no
knowledge of which grader produced them. It was written generic; it just never
had a second grader to prove it.

## Schema

One migration.

```
grading_rubrics
  + manifest        jsonb   not null    -- the full validated manifest
    family          → renamed grader_id
    (family, version) primary key → (grader_id, version)

grade_runs
    family          → renamed grader_id
    grade_runs_one_active → unique (repository_id, grader_id) where state in (queued, running)
```

`grade_runs.result`, its `grade_runs_score` and `grade_runs_result` check
constraints, and every state transition stay exactly as they are. `GradeResult`
gains nothing: it is already grader-agnostic, and that is the strongest
available evidence that the original design was sound.

The nine query functions in `grade-runs.ts` that filter on
`readinessRubric.family` take a `graderId` parameter instead. `latestGrade()`,
`gradeHistory()`, `gradeSummaries()` and `latestCompletedGrade()` are called
from the dashboard and the repository page, which today mean "the readiness
grade" — they keep that meaning in this slice by passing the built-in's id
explicitly at the call site, so the single-grader assumption becomes *visible*
rather than *implicit*. Slice 2 decides what those pages show when a repository
has four grades.

## The Inngest function

`grade-repository.ts` keeps all four steps, its `singleton` key, its retry
count, its `onFailure`, and both authorization re-checks. Two lines change:

- `collectReadiness(repositoryId, sha)` becomes a call that reads the manifest's
  `needs` and — in this slice only — asserts it is exactly `repo.files`,
  delegating to the existing collector. Slice 3 replaces the assertion with the
  broker.
- `evaluateReadiness(snapshot)` becomes `runDeclarative(manifest, evidence)`.

`validateGradeRun()`'s rubric-identity check gains the manifest hash: a grade
must not complete against a manifest that changed after the run was queued.

## Categories

A grader declares exactly one. The set is closed, because an open tag field
makes a marketplace unbrowsable at about forty entries.

| Category | The question it answers |
| --- | --- |
| `harness-integrity` | Are the gates honest, or did something move the goalposts? |
| `delivery-health` | Does work here reach green cleanly, or by attrition? |
| `agent-readiness` | Can a coding agent understand and work in this repository at all? |
| `architecture` | Do the boundaries hold, or has the structure drifted? |
| `test-discipline` | Do the tests assert anything, or only execute? |
| `code-quality` | Is the code itself sound — size, duplication, dead paths? |
| `documentation` | Is the knowledge written down, or only in someone's head? |
| `supply-chain` | What can get in — dependencies, secrets, permissions? |

The first two are only possible because fieldnote already computes a
repository's delivery record. No competing tool can offer them, which is why
they lead the list and why `fieldnote.metrics` is a scope family rather than an
afterthought.

Category answers *what does this grader look at* — the axis a browsing developer
filters on. How strictly it judges is the score. How far to trust the score is
the mode. Three signals, three separate places on the card, never conflated.

## Testing

The slice has one acceptance test and it is not a unit test.

**`readiness-v01.test.ts` must pass unchanged**, against a readiness grader
running entirely through the public contract. Not adapted, not re-pointed at new
helpers — unchanged. If the existing suite needs editing to accommodate the
contract, the contract is wrong and the edit is a failure to notice.

Beyond that:

- A property test per primitive, over generated `SourceDocument[]`, asserting
  every `CheckResult` carries `lineRanges` that resolve inside the document they
  name.
- Manifest schema tests: points not totalling 100, a check absent from
  `card.groups`, a duplicate check id, `kind: code`, and an unknown `subject`
  are each rejected at registration with a distinguishable error.
- An integration test that `grade_runs_one_active` permits two simultaneous
  runs for the same repository under different `grader_id`s, and still forbids
  two under the same one.

## The later slices

Sketched, not specified. Each gets its own design document before it is built.

**Slice 2 — the identity strip and a second grader.** The card gains one region:
author, version, mode, category under the title. The flavour line and the moves
block become the manifest's `card.tagline` and `card.groups`. A second built-in
ships — a `delivery-health`
grader, because it consumes `fieldnote.metrics` and so proves the scope family
that nobody else can offer. Two visibly different cards in one grid is the first
moment this design is legible to anyone who has not read this document.

**Slice 3 — the evidence broker, consent and the schedule.** Four collectors,
the install consent prompt generated from `needs` rather than hand-written by
the author, the history collector and its per-sha cache, and nightly cron per
installation. The largest slice, and deliberately after the contract is settled.

**Slice 4 — code graders.** Sandboxed execution reusing the Act leg's sandbox
port, `judge()`, budget enforcement before the call, BYOK key handling,
metering. The highest-risk slice, last, once three slices of contract have said
what it must support.

**Slice 5 — registry, publishing, the public card and the pill.** Marketplace
listing and browse, the publish flow, opt-in public URLs, `badge.svg` and its
staleness rules, OG images, revocation. The public card and the pill ship
together: a card nobody can link to is not a growth loop, and a pill with
nothing behind it is a sticker.

The pill's rules, recorded now so slice 5 does not relitigate them: a grade
older than its grader's `minInterval` renders `stale` rather than a number, a
revoked pill renders `private` rather than 404, and the pill shows a score and a
finish but never a failing check. Evidence requires the click.

## Open questions

These do not block slice 1. Each blocks a later one, and each is recorded here
rather than discovered later.

1. **Where does a grader live before it is installed?** A fieldnote-hosted
   registry, or a GitHub repository containing `grader.yaml` that fieldnote
   reads by URL? The second gets contributors on day one and costs a registry;
   the first buys review, revocation and a `verified` badge that means
   something. *Blocks slice 5.*

2. **What does `verified` assert?** That a human read the code, or that a
   machine confirmed the grader declares no code and touches only approved
   primitives? The second scales; the first is what a buyer will assume it
   means. Whichever is chosen, the card must say which. *Blocks slice 5.*

3. **AGPL and code graders.** fieldnote is AGPL-3.0-only. Does a `kind: code`
   grader executing inside fieldnote's sandbox constitute a derived work? This
   will be the first question in the first GitHub issue an author opens. It
   needs a written answer before the first code grader runs, not after.
   *Blocks slice 4.*

4. **The bottom two rungs.** `gradePresentation()` labels 0–49 "Bad" and 50–69
   "Mediocre". Those are verdicts on a team, about to become printable on a
   public page and embeddable in a README. The evidence is the judgment; the
   label need not pile on. *Blocks slice 5, and is cheap to change before then.*

5. **What the dashboard shows when a repository has four grades.** Slice 1 keeps
   the current behaviour by naming the built-in explicitly at each call site.
   Slice 2 must decide: a primary grader per repository, an average, or a row of
   cards. *Blocks slice 2.*

## Risks

**The primitive set becomes a programming language.** Every rejected community
grader is pressure to add one more primitive, one more operator, one more
conditional. The extraction rule is the defence, and it only works if it is
applied when it is inconvenient. If a proposed primitive has no existing grader
behind it, the answer is `kind: code`, not a new primitive.

**Slice 1 ships nothing visible and can be cancelled.** A slice with no user-
facing output is the easiest thing in any roadmap to defer in favour of slice 2,
which produces screenshots. Doing so would mean designing the card against a
contract that has never been tested — and the card is the part that becomes
permanent the moment someone else publishes against it.

**The flavour regression is visible and the fix is tempting.** The per-finish
prose is genuinely good writing and the card will feel flatter without it. The
wrong fix is a special case for the built-in. The right fix, if needed, is an
optional author slot every grader can use.
