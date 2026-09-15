# The grader factory, slice 6: the registry, publishing, review and install

**Status:** design, approved in conversation 2026-09-15. No implementation yet.

Slices 1–5 built a contract, three graders on it, an evidence path, a sandbox and
a public card. Every grader is still a file in this repository that registers
itself when the process starts. Open question 1 asked where a grader lives before
it is installed; the answer is a fieldnote-hosted registry, and this slice builds
it.

The sentence this slice is built around:

> A grader someone else wrote can be published, read by a person, installed with
> the team's eyes open, and removed without a trace left running.

The binding rule from [slice 1](2026-09-13-grader-factory-design.md) survives its
hardest test here:

> A built-in grader is an ordinary grader. It gets no private interface, no
> extra evidence, and no code path of its own.

After this slice, `fieldnote/agent-readiness` is a row in the same table a
stranger's grader occupies, resolved by the same query, installed the same way.
The code manifests remain — they are where a built-in is written and tested — but
they are now a **seed**, not a registry.

## What was decided in conversation

| # | Question | Decision |
| --- | --- | --- |
| 1 | Scope — the database move and the registry are each a slice's worth of work | **One slice.** Built together, one design, one plan. |
| 2 | Open question 1 — where a grader lives before install | **A fieldnote-hosted registry**, two tables, described below. |
| 3 | Who may publish, and under what name | **Workspace owners, under a workspace handle** claimed once (`acme` → `acme/test-coverage`). |
| 4 | Open question 2 — what `verified` asserts | **That a person at fieldnote read that version.** The card says exactly that, with the date. |
| 5 | Whether an unreviewed version is installable | **Yes, listed as not reviewed.** An author is not blocked on our queue. |
| 6 | Install scope | **Per workspace.** A workspace installs a grader and every repository in it gains the card. |
| 7 | What happens when an installed grader publishes a new version | **Nothing, until the team chooses.** Installs pin a version; an update is offered, and re-consented if the new version reads more. |
| 8 | Greenfield simplifications (raised by the user: nobody is using this yet) | **`grading_rubrics` is replaced by `grader_versions`** rather than kept beside it; built-ins are seeded in the migration; no compatibility shim for the lookup change — every caller moves at once. |

## What this slice is not

- **No code-grader publishing.** Open question 3 (AGPL) is still unanswered, so
  `kind: code` is refused at publish. fieldnote's own code grader keeps running:
  it is seeded, not published through the form.
- **No CLI publishing.** `fieldnote publish` belongs to
  [the CLI design](2026-09-13-cli-design.md) and its own slice.
- **No payments, ratings, popularity, or search beyond a list.**
- **No screen for making someone staff**, and no audit trail for it.
- **No notification** when a version is withdrawn or verified.
- **No model broker.** Still out of PR #26 (open question 9).

## Graders in the database

### The tables

| | |
| --- | --- |
| `workspaces.handle` | Nullable, unique, `[a-z0-9][a-z0-9-]{1,38}`. Claimed once in workspace settings and **never changed**, because published grader ids contain it. A workspace without a handle can install but not publish. |
| `graders` | One row per grader id (`owner/name`). `owned_by_workspace_id` (nullable — null is fieldnote's own), `created_at`. |
| `grader_versions` | `(grader_id, version)` primary key. The validated `manifest`, `evaluator_version`, `published_by`, `published_at`, nullable `verified_at`/`verified_by`, nullable `withdrawn_at` and `withdrawn_note`. **Immutable once written**, apart from those three lifecycle columns. |
| `grader_installs` | `(workspace_id, grader_id)` primary key. The pinned `version`, `installed_by`, `installed_at`, and `consented_needs` — the hash of the `needs` the workspace agreed to. |

**`grading_rubrics` is dropped.** It stored an immutable manifest per
`(grader_id, version)` so a run could be pinned to the rubric it was graded
against — which is exactly what `grader_versions` now is, with a publication
record attached. Keeping both would mean two writers, two hashes and a drift
check between them. `registerRubric()`'s job survives as a **read**: resolve the
version, derive `rubricView()` from its manifest, compare hashes, refuse a run
whose pinned version no longer matches. With real users this would be a careful
migration; with none it is one table fewer.

### Resolution becomes a query

`getGrader(id)` is a synchronous lookup in a module-level map, called from ten
modules. It is replaced by two asynchronous functions in
`src/db/queries/graders.ts`:

- **`graderVersion(graderId, version)`** — the manifest exactly as published. What
  a grade run, a report, a public page and a badge resolve, because each of them
  knows which version its grade was computed against.
- **`installedGraders(workspaceId)`** and **`installedGrader(workspaceId, graderId)`**
  — the version a workspace pinned. What the grades page renders and what a new
  run pins.

Two rules keep the distinction honest:

- **A finished grade always resolves the version it was graded with.** A card, a
  report, a public page and a badge never re-interpret an old grade through a
  newer manifest.
- **A new run resolves the installed version.** `requestGrade` and `scheduleGrade`
  both already know their workspace.

`src/domain/grading/registry.ts` keeps `parseManifest` and the seed map for the
built-ins, and loses `getGrader`. `gradeCardProps()` stops resolving a grader by
id and takes the manifest it was given; `readiness-v01.ts` keeps importing the
built-in manifest directly, so the acceptance test is untouched.

### The seed

The three built-in manifests stay in `src/domain/grading/graders/`, where they are
written, reviewed and tested. A migration publishes them into `graders` and
`grader_versions` under the reserved `fieldnote` handle, verified, with no owning
workspace — and installs them into every workspace that exists. Workspace
creation installs them too, so a new team sees the row of cards it sees today.

They are ordinary rows afterwards: a workspace may uninstall one, and Act's entry
disappears with `fieldnote/agent-readiness` because Act reads that grader's grade.
That is the rule working, not a bug.

## Publishing

**Claiming a handle.** Workspace settings gains one field, set once by an owner.
The reserved handles are `fieldnote`, `admin`, `api`, `app`, `r`, `www` and
`support`.

**Publishing a version.** An owner pastes a manifest into a form. fieldnote
refuses it unless:

- `parseManifest` accepts it — every existing invariant, unchanged;
- `kind` is `declarative` — open question 3 still parks the rest;
- the id's owner segment equals this workspace's handle;
- the grader id either has no row yet, or has one owned by this workspace;
- that `(grader_id, version)` does not exist. **A published version is never
  replaced**: installs point at it and grades are pinned to it.

On success the version is listed immediately, marked **not reviewed**.

**Withdrawing.** An owner may withdraw a version with a note. It leaves the
browse list and cannot be newly installed; workspaces that already installed it
keep running it, and every grade already produced keeps rendering. Nothing is
deleted.

## Review

**A new role.** `users.staff`, a boolean set directly in the database. There is no
screen for granting it and no audit trail — recorded below as knowingly wrong.

**The queue.** `/app/admin/graders`, staff only, listing versions with no
`verified_at`, newest first. Each renders the whole manifest a reviewer must
judge: checks, points, the exact `needs`, and the prose the grader will print on
other people's cards. Two actions: **mark verified**, or **withdraw with a note**.

**What the mark asserts**, in the words the card uses: *"Read by fieldnote on
15 September 2026."* Not that the grader is correct, not that its scores are
fair. A person read it.

**A version is verified, not a grader.** A new version starts unreviewed however
many of its predecessors were read, because the new one is what will run.

Every surface that names a grader also names its state: **read by fieldnote**,
**not reviewed**, or **withdrawn** (only where it is still installed).

## Installing, and consent

**Browsing.** `/app/settings/graders` lists the registry for the acting
workspace: verified first, then unreviewed, withdrawn hidden. Each entry shows
the author, the tagline, the category, the mode, the state and what it reads.

**Consent comes before the install, and it is generated, not written.** The
screen renders the manifest's `needs` in plain sentences:

| Declared | Shown |
| --- | --- |
| `repo.files: ["README.md", "docs/**/*.md"]` | The contents of files matching `README.md`, `docs/**/*.md` |
| `repo.tree: ["**/*"]` | The list of file names in your repositories |
| `fieldnote.metrics: { windowDays: 30, … }` | Your merged pull request and CI record over 30 days |

Installing records the pinned version and `consented_needs`, the canonical hash
of that manifest's `needs`.

**The promise is kept at collection time, not at the screen.** `collectEvidence()`
— the one place that knows both a manifest's `needs` and the repository it is
about to read, as slice 3's docstring demands — receives the consent hash for the
run's workspace and refuses to collect anything when it does not match the
manifest's. The run fails `consent_required`. A grader cannot widen what it reads
by publishing a version nobody agreed to.

**Updating.** An installed grader with a newer version shows "update available".
Taking it re-pins the version; if the new `needs` hash differs from the consented
one, the consent screen appears again first.

**Uninstalling** deletes the install row, and with it **that workspace's** nightly
schedules and public sharing rows for that grader — both tables carry a
`workspace_id`, so another workspace sharing the same repository is untouched.
Grades already produced stay: history is never rewritten.

**Reconnecting a repository** resumes its schedules and sharing as it does today,
but only for graders the workspace still has installed.

## What is knowingly wrong

**Making someone staff is a database edit**, with no screen, no audit trail and
no second pair of eyes. The registry's only human gate is operated by a flag
nobody can see in the product.

**A withdrawn version keeps running where it is installed**, and nothing tells
those teams. Pulling a grader out from under a team's history is worse than
leaving it, but a grader withdrawn *because it was bad* stays live until each
team acts.

**A handle can never be changed**, and a workspace that claims a bad one is stuck
with it in every grader id it publishes.

**Publishing has no rate limit**, and browse has no paging or search. Both are
fine at zero users and neither is fine at a thousand.

**An uninstall cannot be undone with its settings intact**: reinstalling starts
with no schedule and no sharing, which is the safe direction but not a pleasant
one.

**The consent hash covers `needs` only.** A new version may change its checks,
its thresholds and its prose freely once installed — that is what a version is
for — but the team's score can move without a new consent screen. The update
prompt is what makes that visible.

## Testing

**The acceptance test is unchanged.**
[`readiness-v01.test.ts`](../../../src/domain/grading/readiness-v01.test.ts)
passes byte-identical to `main`. It grades a manifest imported from code, which is
exactly why the built-ins keep their code manifests.

**The refactor's net is the existing suite.** Every grading test that exists today
must pass after resolution becomes a query, changed only where it must await a
result or seed a row. A test deleted or weakened during that refactor is the
failure mode to watch for, and the whole-slice review is pointed at it.

- **Publishing.** Refused for: a foreign handle, a workspace with no handle, a
  member rather than an owner, a `kind: code` manifest, an existing
  `(grader_id, version)`, a grader id owned by another workspace, and every
  `parseManifest` failure. Accepted once, listed as unreviewed.
- **Review.** A non-staff user reaching `/app/admin/graders` is a 404. Verifying
  writes the reviewer and the date; withdrawing hides it from browse, keeps it
  running where installed, and keeps its grades rendering.
- **Install and consent.** The consent screen's sentences are generated from
  `needs` — a manifest declaring two families produces both sentences.
  Installing records the pinned version and the hash. An update whose `needs` are
  unchanged skips the screen; one that widens them does not.
- **The enforcement.** A run whose manifest's `needs` hash differs from the
  workspace's consent collects **nothing** and fails `consent_required` — asserted
  by the collectors never being called.
- **Uninstall.** Removes that workspace's schedules and sharing rows for that
  grader; leaves another workspace's rows for the same repository alone; leaves
  grade history intact.
- **Resolution.** A finished grade resolves the version it was graded with even
  after a newer version is published and installed; a new run pins the installed
  version.
- **Seeding.** After migration, the three built-ins are present, verified, owned
  by no workspace, and installed in every existing workspace; a newly created
  workspace has them too.

`pnpm check` — lint, typecheck, test, test:integration, build — is the gate, with
`DEMO_MODE=false` for the integration run.

## Open questions

Open questions 1 and 2 are answered by this slice. Question 3 (AGPL and code
graders) still blocks publishing `kind: code`, and is now the only thing standing
between the registry and its full purpose. Question 8 stays settled. Question 9
(the model broker) is unchanged and still out of PR #26.

One is added.

10. **Who reviews the reviewers.** `users.staff` is a database edit, and a staff
    member can mark any version verified, including one published by their own
    workspace. At this size that is a non-problem; before the registry carries
    graders anyone relies on, it needs an answer — at minimum, refusing to verify
    a version published by a workspace the reviewer belongs to. *Blocks nothing
    today.*
