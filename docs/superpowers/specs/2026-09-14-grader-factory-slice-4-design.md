# The grader factory, slice 4: the sandbox and code graders

**Status:** design, approved in conversation 2026-09-14. No implementation yet.

Slice 1 turned one compiled-in grader into a contract. Slice 2 proved a second
grader did not bend it. Slice 3 made the evidence path general and pinned what a
run reads. Every grader so far is a manifest interpreted by fieldnote's own
engine, and the design's first risk says what happens next: every grader the
primitives cannot express becomes pressure to add a primitive, and "if a
proposed primitive has no existing grader behind it, the answer is `kind: code`,
not a new primitive". That answer does not exist yet. This slice builds it.

The sentence it is built around:

> A grader can ship a program, and the program can decide pass or fail — and
> nothing else.

The binding rule from [slice 1](2026-09-13-grader-factory-design.md) still holds
and is still what every decision below answers to:

> A built-in grader is an ordinary grader. It gets no private interface, no
> extra evidence, and no code path of its own.

For this slice that rule has a sharp edge: fieldnote's own code grader runs in
the sandbox in production, exactly as a stranger's would, even though we wrote
it and could call it directly.

## What was decided in conversation

| # | Question | Decision |
| --- | --- | --- |
| 1 | Where code graders run | **E2B**, reached through the four-operation port Act's plan 2b designed, with a local adapter for tests and development. An in-process WebAssembly sandbox (QuickJS) was offered as free, keyless and provable offline, and declined in favour of the substrate Act already chose. |
| 2 | The model broker, budget enforcement, BYOK and metering | **Out of PR #26.** Slice 1's rescope split them off from slice 4 and no slice was left to hold them. `mode: llm` and `mode: hybrid` stay accepted by the schema and unbuildable. |
| 3 | Commit attribution for implementer subagents | The fixed `Claude Opus 5` trailer on every commit, as slice 3 did. The two slice 3 commits already amended stay amended. |
| 4 | The first code grader | **`fieldnote/test-discipline`**, reading file paths only, which earns the `repo.tree` family slice 1 promised. A supply-chain grader over `package.json` was offered and declined: it needs no new family and so proves less. |
| 5 | Who writes a code grader's words | **The manifest.** The program returns data — a status, paths and at most one count per check — and fieldnote assembles the report from the manifest's prose. See [The answer](#the-answer). |

Already decided before this document, and not reopened: the slice's scope is a
sandbox and the `kind: code` contract; code graders are **fieldnote's own
only**, which parks open question 3 rather than answering it; and `kind` and
`mode` are orthogonal, so a `kind: code, mode: deterministic` grader needs a
sandbox and nothing else.

## What this slice is not

- **No third-party code.** Nothing fieldnote did not write is loaded. A design
  step that needs to is open question 3, and stops there.
- **No model, key, budget or meter.** Decision 2.
- **No `repo.history`.** No grader reads it. It arrives with the one that does,
  and [the family labels](#the-family-labels) are built so it arrives as a table
  entry.
- **No cost tracking.** No `sandbox_seconds` column, no per-run cost. The same
  line Act's plan 2a drew.
- **No change to Act.** The port is shaped so Act's plan 2b can adopt it; Act
  does not adopt it here.
- **No registry, publishing, public card or consent prompt.** Slice 5.

## The sandbox

### The port

Act's plan 2b designed "four operations — create, write, run the agent,
destroy — with an E2B adapter for production and a local adapter used by tests
and by development." The grading port is those four, with "run the agent"
generalised to running a command, because a grading run has no agent:

```ts
interface Sandbox {
  create(): Promise<SandboxHandle>;
  write(handle: SandboxHandle, path: string, contents: string): Promise<void>;
  exec(handle: SandboxHandle, command: string[], options: { timeoutMs: number; maxOutputBytes: number }):
    Promise<{ exitCode: number; stdout: string }>;
  destroy(handle: SandboxHandle): Promise<void>;
}
```

Grading composes them once per run: create a box, write three files, exec one
command, destroy the box in a `finally`. Act's plan run needs a box held across
several commands, which is why the port exposes the four operations rather than
one `runGrader()` call — a single call would be the cheaper interface to write
and the one Act could not adopt.

The port and both adapters live in `src/grading/sandbox/`. `src/domain/grading`
never imports them; the domain stays pure.

### What runs in the box

Three files, written to one directory:

- **`grader.mjs`** — the grader's program: one self-contained ES module with no
  imports, whose default export takes the evidence and returns
  [the answer](#the-answer). Synchronous or async.
- **`run.mjs`** — fieldnote's runner, a dozen lines: read `input.json` from the
  same directory, call the default export, write the return value to stdout as
  JSON, exit 0. A thrown error exits non-zero and prints nothing.
- **`input.json`** — the evidence, described in [The input](#the-input).

The command is:

```
node --permission --allow-fs-read=<that directory> <that directory>/run.mjs
```

With `--permission` set and nothing else allowed, Node refuses every
filesystem read outside that directory, every write, child processes, worker
threads, native addons and the inspector. That holds in both adapters, so the
file, process and write guarantees are properties of the command, not of the
vendor.

### The E2B adapter

`Sandbox.create({ allowInternetAccess: false, envs: {}, timeoutMs: 60_000 })`,
then `files.write` and `commands.run` with `envs: {}` and the exec timeout. The
SDK's surface was read from the published `e2b` 2.49.1 package, not from
memory: `allowInternetAccess: false` "works the same as setting network
`denyOut` to `[0.0.0.0/0]`"; `envs` defaults to `{}`; the box timeout defaults
to five minutes and is lowered here so a box whose `destroy` fails dies within a
minute on its own.

Limits: the exec times out at **20 s**; stdout is capped at **256 KiB**, and
output past the cap fails the run rather than being truncated into something
that parses.

**`E2B_API_KEY` lives in the worker's environment and never enters the box.**
The box receives none of the worker's environment — no key, no worker
variable — at creation or at exec. E2B runs a command through a shell with its
own default variables, so the program does not see an empty environment there;
it sees nothing of fieldnote's.

**One fact is unverified: whether E2B's default `base` template ships Node with
the permission model.** `--permission` is stable from Node 22.13 / 23.5; on
Node 20 the flag is `--experimental-permission`, and before that it does not
exist. The first task of the plan is a live probe of the template's `node
--version`. If it is too old or absent, a custom template is a vendor
configuration decision and goes back to the user before anything is built on
it.

### The local adapter

A fresh temporary directory, `write` as a file write, `exec` as a child process
of `process.execPath` with `env: {}`, the same command, the same timeout
(`SIGKILL` at 20 s) and the same output cap. `destroy` removes the directory.

**It cannot block the network.** Node 24's permission model has no network
permission — `node --help` on 24.19.0 lists `--allow-fs-read`,
`--allow-fs-write`, `--allow-child-process`, `--allow-worker`, `--allow-addons`,
`--allow-wasi` and `--allow-inspector`, and nothing for sockets. Every other
guarantee the local adapter enforces for real.

### Which adapter runs

- `E2B_API_KEY` present → E2B.
- No key, `NODE_ENV !== 'production'` → local. That is tests and `pnpm dev`, and
  `pnpm check` stays green offline, which is the property plan 2b's port was
  justified by.
- No key, `NODE_ENV === 'production'` → **no sandbox**. A code grader run fails
  `sandbox_unavailable`. It never falls back to the local adapter, because that
  would silently drop the network guarantee in exactly the environment it
  exists for.
  The sandbox is chosen before any evidence is collected, so that failure
  costs no GitHub calls, and the nightly scheduler skips a code grader while
  no sandbox can be chosen rather than creating a failed run every night.

## The contract

### The manifest

A `kind: code` manifest is the same manifest with three differences.

- **Its checks have no `primitive` and no `args`.** Each keeps `id`, `title`,
  `points` and `explain: { pass, fail }`. The program decides the status.
- **It carries its program**: `code: { source: string }`, the text of
  `grader.mjs`. Because the manifest is what `registerRubric()` stores and
  hashes, the program is part of the rubric definition: changing the program
  without bumping `version` throws `Rubric version definition mismatch`, exactly
  as changing a threshold does. No new mechanism.
- **It may carry `insufficientReason`**, the grader's sentence for "too little
  here to judge". A declarative grader supplies its floor inside
  `needs['fieldnote.metrics']`, because the metrics collector enforces it; a
  code grader's program enforces its own floor, so the sentence sits at the top
  level.

`kind` becomes the discriminator of the manifest schema. A declarative manifest
with `code` and a code manifest with a `primitive` are both `schema` errors.
Every existing invariant — points total 100, unique check ids, every check
grouped exactly once, `needs_empty`, `needs_too_broad`, `subject_mismatch` —
applies to both kinds.

**`needs_mismatch` applies to declarative graders only.** It works by reading
each check's primitive and asking which family it needs; a code grader's checks
have no primitive, so fieldnote cannot see which declared family the program
actually reads. What it can still guarantee is the ceiling: the program receives
only the families declared, so under-declaring breaks the grader and
over-declaring leaks nothing it did not ask for. Recorded below, because slice
5's consent prompt must treat a code grader's `needs` as a ceiling rather than
an inventory.

`registerGrader()` stops refusing `kind: code`. Registration does not run the
program.

**How the source reaches the manifest.** The program is authored as
`src/domain/grading/graders/test-discipline/grader.mjs` and unit-tested by
importing it directly. The manifest cannot read that file at runtime: the
Inngest worker is a serverless entry point, and a runtime `readFileSync` of a
source file is exactly what a bundler's file tracing drops. So a checked-in
module beside it exports the text as a string, produced by a script, and a unit
test fails `pnpm check` if the string and the file differ. A stale embed is a
failing test, never a silent drift.

### `repo.tree`

The third evidence family: the paths and sizes of the files at the pinned
commit, and never their contents.

```ts
type TreeEntry = { path: string; size: number };
```

- **Declared like `repo.files`**: a list of globs, `needs_too_broad` at 20,
  matched case-insensitively for the reason slice 3 gave.
- **Blobs only**, by the same `100644`/`100755` mode test `collectFiles` uses —
  no symlinks, no submodules, no directories. Sorted by path.
- **The caps are the tree-walk caps that already exist**: 10 000 entries,
  including the breadth-first fallback for a truncated recursive tree. A tree
  over the cap is `complete: false`, which is `incomplete_collection` — the
  run fails as fieldnote's failure, as a file collection over its caps already
  does.
- **The tree walk is extracted from `collectFiles` and shared**, not copied. A
  grader declaring both `repo.files` and `repo.tree` walks the tree twice; that
  costs a few API calls on a combination no grader declares, and is recorded.

`HANDLED_FAMILIES` gains `repo.tree`, and `collectEvidence()` gains its branch.
`RepositorySnapshot` gains `tree?: TreeEntry[] | null`.

### The input

`input.json` is exactly `{ "evidence": { … } }`, holding only the families the
manifest declared, under the names `tree`, `documents` and `metrics`. Nothing
else crosses: no sha, no repository id or name, no workspace, no user, no
manifest. A test pins the exact key set for each family combination.

### The answer

The program returns:

```ts
type CodeGraderAnswer = {
  checks: Array<{
    id: string;
    status: 'pass' | 'fail';
    paths?: string[];
    count?: { matched: number; of: number };
  }>;
  insufficient?: true;
};
```

**Every check, even when insufficient**, mirroring `runDeclarative()`, which
computes every check whether or not there is a score: a floor miss stores its
measurements, and slice 3's report renders them without points.

fieldnote parses the answer strictly and fails the run as `grader_failed` on
any of:

- output that is not JSON, or an object with any key not listed above, at any
  depth;
- a check id the manifest does not declare, a declared check missing, or one
  reported twice;
- a path that is not in the evidence the program was given, or more than 20
  paths on one check;
- a `count` whose numbers are not non-negative integers with `matched <= of`;
- `insufficient: true` from a grader whose manifest has no
  `insufficientReason`.

**There is no field that carries free text.** `id` must equal a declared id,
`status` is one of two words, and every path must equal one fieldnote already
holds. That is how "a grader never emits markup, CSS or script" is enforced: not
by a sanitiser that must be right, but by an output shape with nowhere to put
it.

fieldnote assembles each `CheckResult` the way primitives do:

- `points` are the manifest's on a pass and 0 on a fail;
- `explanation` is `explain.pass` or `explain.fail`, then `Measured {matched} of
  {of}.` when a count was given, then the disclaimer;
- `paths` are kept on a pass and dropped on a fail, as `result()` in
  `primitives.ts` already does, and `lineRanges` are empty — a path from the
  tree has no lines to point at.

The assembly is a pure function in `src/domain/grading/code.ts`, beside
`declarative.ts`, and the same function turns a hand-written answer into the
demo fixture.

## Three things slice 3 left behind

### The family labels

One lookup, in `manifest.ts`, beside `FAMILY_OF`:

```ts
const FAMILY_CHANGES: Record<EvidenceFamily, 'with-commits' | 'over-time'> = {
  'repo.files': 'with-commits',
  'repo.tree': 'with-commits',
  'fieldnote.metrics': 'over-time',
};
```

Keyed by the family type, so adding a family without deciding its label is a
compile error — the reasoning `FAMILY_OF` already records. `repo.history` gets
its label when it is built, and whether commit history at a pinned sha can
change without a commit is that slice's question to answer, on this table.

**`subject_mismatch` reads it.** A grader declaring any `over-time` family must
say `subject: repository_window`; a grader declaring none must say `subject:
repository`. Both existing graders come out exactly as they do today, and
`fieldnote/test-discipline` grades a commit. `subject` is immutable for a
grader's life, so the rule that assigns it is now a table rather than a line
that names one family.

**The scheduler reads it too**, through one exported helper,
`changesOverTime(manifest)`, rather than through `manifest.subject`. Today the
two are equivalent by construction; keying the skip off the evidence says what
the skip is actually about, and keeps the two rules from drifting if a subject
ever stops being derived.

### The skip is too loose

`scheduleIfDue` skips a `repository` grader when the head sha matches the last
**completed** run's. Two cases get through wrongly, and code graders make both
common:

- **A new grader version on an unchanged commit is skipped** until somebody
  pushes, because the comparison ignores `rubric_version`. Every change to a
  code grader's program is a version bump.
- **An insufficient run is never "done"**, because `latestCompletedGrade()`
  reads only `complete` runs. A repository too small to judge would rent a box
  every night to be told so again.

The skip becomes: no `over-time` family is declared, **and** the latest run in
`complete` or `insufficient` state has the same sha **and** the same
`rubric_version` as the registered manifest. A failed run never counts as done.

### A code grader's floor

`evaluateGradeRun()` routes to `insufficientGrade()` only when the broker's
`incompleteCode` is `insufficient_evidence`, which only `collectMetrics()`
produces. A code grader decides its floor after collection succeeds.

The worker stops reading the verdict off the broker. Evaluation returns it:

```ts
type Evaluation = { result: GradeResult; verdict: 'scored' | 'insufficient' | 'incomplete' };
```

- **Declarative:** `runDeclarative()` as today; the verdict is `insufficient`
  when the broker's code is `insufficient_evidence`, `incomplete` for any other
  incomplete snapshot, otherwise `scored`. Behaviour is unchanged.
- **Code:** if the snapshot is incomplete, the verdict is `incomplete` and **the
  box is never created** — no program is worth paying for on evidence fieldnote
  already knows is partial. Otherwise the answer decides: `insufficient: true`
  is `insufficient`, with the manifest's `insufficientReason` as
  `incompleteReason` and a null score; anything else is `scored`.

The branch between the two is on `manifest.kind` — a property of the contract,
not a grader id — and lives in one function in `src/grading/`. `scored` →
`completeGrade`, `insufficient` → `insufficientGrade`, `incomplete` →
`failGrade` with the broker's code, each after the authorization re-check they
already have. `insufficient_evidence` stays on `failGrade`'s whitelist, as the
backstop its comment describes.

## When it goes wrong

| What happened | Error code | Retried | What a reader sees |
| --- | --- | --- | --- |
| E2B refused, timed out or could not be reached while creating, writing or executing | `sandbox_unavailable` | Yes — thrown retryable, so Inngest's three retries apply | "Grading is temporarily unavailable. Try again later." |
| No `E2B_API_KEY` in production | `sandbox_unavailable` | No | The same |
| The program exited non-zero, passed 20 s, or overflowed 256 KiB | `grader_failed` | No — same input, same result | "The grader could not finish. Your last completed report is unchanged. Try again." — today's copy |
| The program's answer broke a rule in [The answer](#the-answer) | `grader_failed` | No | The same |

Both codes join `failGrade`'s whitelist, and the report's failure copy gains the
`sandbox_unavailable` branch.

**The code must survive the retries running out.** Today a retryable failure is
rethrown as a generic `Error`, and when Inngest's retries are exhausted
`onFailure` calls `failGrade(runId)` with no code — which records
`collection_failed`. Left alone, an E2B outage would be stored as fieldnote
failing to read the repository. The retryable sandbox error is rethrown under
its own name, carrying no vendor message, and `onFailure` records
`sandbox_unavailable` when the final error is that one and `collection_failed`
otherwise.

**The box is destroyed in a `finally`**, on every path. A `destroy` that itself
fails is swallowed; the box's own 60-second lifetime ends it.

**Nothing the program printed is kept.** On failure its stdout and exit status
are discarded and only the code is stored. The output of a program that just
read a private repository's file list is that repository's data, and the
existing rule — `collectionFailure()`'s "never let provider exceptions enter
Inngest logs" — covers vendor errors too: an E2B error is mapped to a code and
its message dropped.

**The file list never becomes a durable step output.** Collection, the box and
the result are all inside the existing `collect-evaluate-complete` step, which
already exists so that raw source is never a step output.

**A run now includes creating a box**, a few seconds. The Inngest function is
served from a Vercel function whose duration limit is well above that; the
plan's live probe records real timings.

## The first code grader

`fieldnote/test-discipline`, version `0.1.0`, evaluator `1.0.0`, `subject:
repository`, `mode: deterministic`, `category: test-discipline`, `kind: code`,
`needs: { 'repo.tree': ['**/*'] }`.

Its judgment, which is the grader's and nothing else's:

- **Source files** are paths ending `.ts .tsx .js .jsx .mjs .cjs .py .go .rb
  .java .kt .rs .cs .php .swift`, excluding `.d.ts`, anything under a
  `node_modules`, `dist`, `build`, `out`, `target`, `vendor`, `coverage` or
  dot-prefixed directory, dot-prefixed file names, `*.config.*` files, and test
  files.
- **Test files** are those with `.test.` or `.spec.` in the name, `_test.go`,
  `test_*.py` or `*_test.py`, `*Test`/`*Tests` in Java or Kotlin, `*_spec.rb`,
  and any source-extension file under a `__tests__`, `test`, `tests` or `spec`
  directory.
- A source file **has a test** when some test file's stem — its name with the
  extension and the test marker removed, lower-cased — equals the source file's.
- A **code folder** is a source file's first path segment, or its first two when
  the first is `src`, `packages`, `apps`, `services`, `libs` or `lib` and the
  file is below that level. Source files at the root form one folder. A folder
  **has tests** when it contains a test file or one of its source files has a
  test.

| Check | Points | Passes when | Count | Paths on a pass |
| --- | --- | --- | --- | --- |
| `tests-exist` | 20 | at least one test file | — | up to 20 test files |
| `tests-beside-source` | 40 | at least half the source files have a test | matched of source files | up to 20 matching test files |
| `tests-in-every-folder` | 40 | every code folder has tests | folders with tests of folders | up to 20 test files, one per folder |

**Fewer than five source files is insufficient**, with the sentence "Fewer than
five source files — not enough code to judge how it is tested." The disclaimer:
"This reads file names, not test contents: a test file with a matching name is
not proof the code is tested."

Card: title **Test Discipline**, tagline "Does the code here come with tests,
and are they where the code is?", groups **Presence** (`tests-exist`) and
**Coverage by name** (`tests-beside-source`, `tests-in-every-folder`).

It registers through the graders barrel like the other two, so it is a third
card in the row, with its own Run button and nightly switch, and no other change
to the page. Demo mode gets a third fixture, built by the answer assembly from a
hand-written answer. The Agents tab keeps the single readiness card.

## What is knowingly wrong

**"No network" is not proven on every `pnpm check`.** Every other item of "What
a grader never receives" is proven offline against the local adapter or against
fieldnote's own input and output code. The network guarantee is E2B's, and it
is proven only by a live suite that runs when `E2B_API_KEY` is present. This is
the cost of decision 1, stated rather than hidden: QuickJS would have proven all
of them offline.

**In development a code grader has the network.** The local adapter cannot
remove it. Harmless while every code grader is ours; it is one more reason the
slice that opens `kind: code` to authors cannot run their code locally on this
adapter.

**A code grader's `needs` is a ceiling, not an inventory.** fieldnote cannot see
which declared family a program reads. Slice 5's consent prompt must word a code
grader's request as what it *may* read.

**A repository over 10 000 tree entries cannot be graded for test discipline.**
The run fails `incomplete_collection`, the same line `agent-readiness` already
draws. Raising the cap is a cap decision for every grader, not a fix for one.

**Name-matching misses real tests and credits fake ones.** Rust's inline
`#[cfg(test)]` modules are invisible to a file list; an empty `foo.test.ts`
passes. The disclaimer says so on every check.

**A failing check shows no paths**, so "which source files have no test" is not
on the card. Parity with the declarative result; changing it is a contract change
for both kinds.

**Every code grader run rents a box, uncapped and unmetered.** The tighter skip
rule keeps an idle repository at one sha lookup a night and a box only when its
commit or its grader changed. Open question 8 and a quota belong with the first
bill.

## Testing

**The acceptance test is unchanged.**
[`readiness-v01.test.ts`](../../../src/domain/grading/readiness-v01.test.ts)
passes byte-identical to `main`.

**Every item of "What a grader never receives" has a test that proves it**, and
the proof is a hostile `grader.mjs` fixture that tries the thing, not a comment:

| Item | Proven by | Runs |
| --- | --- | --- |
| Environment variables | the program reads `process.env` and finds it empty — with a sentinel variable set in the parent process | `pnpm check`, local adapter |
| The filesystem | reading `/etc/passwd` and fieldnote's own `package.json` are refused; writing into its own directory is refused | `pnpm check`, local adapter |
| Starting a process | `child_process.spawnSync` is refused | `pnpm check`, local adapter |
| Evidence outside `needs` | a `repo.tree` grader's input has `tree` and no `documents` or `metrics`; each family combination pins its exact key set | `pnpm check` |
| Another repository or workspace | the input's full key set holds no sha, id, name, workspace or user | `pnpm check` |
| An API key | the E2B adapter is called with `envs: {}` at create and exec, and `E2B_API_KEY` appears nowhere in what is written to the box | `pnpm check`, recording fake of the SDK |
| Markup, CSS or script | an answer with an `explanation`, a `<script>` in an id, or an invented path fails `grader_failed` | `pnpm check` |
| Network | `fetch` to a public host fails inside the box | live, `E2B_API_KEY` only |

The live suite runs the same hostile fixture through the real E2B adapter —
environment, filesystem, process and network — so the table's local proofs are
also checked against the production substrate whenever a key is available.

**The contract.** Each rejection in [The answer](#the-answer) is its own case.
A code manifest with a `primitive`, and a declarative one with `code`, are
`schema` errors. A program changed without a version bump throws the mismatch.
`registerGrader()` accepts `kind: code`.

**The labels.** `subject_mismatch` in both directions for every family; a
`repo.tree` grader must say `repository`.

**The scheduler.** It skips an unchanged commit at the same version; runs an
unchanged commit at a new version; treats an insufficient run as done; never
treats a failed run as done; always runs an `over-time` grader.

**The verdict.** A code grader's `insufficient` answer stores an insufficient
run with the manifest's sentence and no score. An incomplete tree fails
`incomplete_collection` and never calls `create`. A crashing program fails
`grader_failed` and the box is destroyed. An unreachable E2B throws retryable,
and `onFailure` records `sandbox_unavailable` once the retries are spent — not
`collection_failed`.

**The grader.** `grader.mjs` imported directly, over hand-built trees: each
check passing and failing, each language's test naming, the excluded
directories, the root folder, and four source files being insufficient. The
embed test fails when the string and the file differ.

**Integration.** A `fieldnote/test-discipline` run goes through the real worker
with the local adapter and a stubbed tree, and reaches `complete` with a score.

`pnpm check` — lint, typecheck, test, test:integration, build — is the gate,
with `DEMO_MODE=false` on the command line for the integration run.

## Open questions

Slice 1's open questions 1, 2 and 4 still block slice 5. Question 3 is still
deferred and still blocks whichever slice opens `kind: code` to authors.
Question 8 carries forward from slice 3.

One is added.

9. **Where the model broker goes.** Decision 2 took it out of PR #26 with no
   slice to land in. `mode: llm` is in the schema, on the identity strip's
   vocabulary, and unbuildable. *Blocks nothing in this PR. Blocks the first
   grader that wants a model.*
