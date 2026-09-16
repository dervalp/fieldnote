# Fieldnote Skills setup through Act

**Status:** approved in conversation on 2026-09-16; written specification
awaiting review.

## Purpose

Act's first action is to improve the coding agents that work in a repository.
For a repository without Fieldnote Skills, the readiness page offers **Set up
Fieldnote**. Fieldnote explores the repository, confirms which coding agents it
uses, runs a focused brainstorm/grill to settle the repository facts that
cannot be inferred, installs the complete latest Fieldnote Skills release, and
opens a pull request.

The pull request is the review surface. Fieldnote monitors it, repairs bounded
actionable failures, waits for a human to merge, and only then verifies that
the repository is installed.

This is deliberately more than generating `.fieldnote/profile.md`. A profile
without the skills that consume it does not improve an agent. A successful
setup pull request contains both:

- the generic, unchanged Fieldnote Skills in each supported agent's native
  repository-level discovery path; and
- the repository-specific `.fieldnote/` files those skills read.

## Product progression

Act exposes capabilities in this order:

1. Install Fieldnote Skills.
2. Verify the merged installation.
3. Offer broader readiness-remediation actions.

A repository with no verified installation sees **Set up Fieldnote** as Act's
primary action instead of **Plan the fixes**. An installed repository whose
release is behind the latest published release sees **Update Fieldnote to
vX**. A current repository shows the installed release. An open setup or
update pull request shows that pull request and its monitoring state.

Updates are detected automatically but remain user-initiated in V1. Fieldnote
does not open unsolicited update pull requests.

## Architectural direction

Act becomes a typed authoring platform rather than a collection of unrelated
jobs. `authoring_runs` gains a workflow discriminator:

- `readiness-remediation`
- `fieldnote-setup`

The existing `plan | execute` run kinds remain. Shared authoring
infrastructure owns authorization, durable dispatch, sandbox provenance,
notes, retries, recovery, authored pull requests, and monitoring.
Workflow-specific tables own workflow-specific results. In particular,
Fieldnote Skills installation is not represented as a set of failing
readiness checks or readiness remedies.

Existing authoring rows are backfilled as `readiness-remediation`. This keeps
the current deterministic readiness-plan behavior intact while making room
for additional Act actions without duplicating the execution kernel.

## Setup lifecycle

### Plan run

The plan run:

1. Re-checks workspace access, repository access, Act opt-in, and GitHub App
   permissions.
2. Pins the repository's default-branch commit.
3. Resolves and pins the newest published Fieldnote Skills release available
   when the run begins. It never installs from a moving `main` branch.
4. Fetches the repository as a credential-free archive and explores it in a
   read-only sandbox.
5. Detects coding agents from repository configuration, committed instruction
   files, workflow markers, and Fieldnote's existing observed agent evidence.
6. Opens a persistent conversation with its findings and evidence.
7. Runs the `fieldnote-setup-profile` workflow to infer mechanical facts and
   grill the user about facts the repository cannot prove.
8. Produces a ready setup proposal containing confirmed agent targets,
   repository facts, and generated configuration artifacts.

The plan run may wait for a human indefinitely without keeping a sandbox
alive. Findings, questions, answers, and confirmed facts are durable. Raw
repository source is not.

### Execute run

When the setup proposal is complete, Fieldnote does not add a second diff
approval ceremony. It says:

> Preparing your Fieldnote setup. I'll install the skills, tailor the
> repository profile, and open a pull request for you to review.

It then creates a linked execute run. The execute run:

1. Re-checks authorization and write permissions.
2. Re-checks the default-branch head and the evidence inputs used by the
   proposal.
3. Loads the pinned, validated Fieldnote Skills release.
4. Creates the complete repository-local installation in a fresh sandbox.
5. Validates the generated profile, lock file, target paths, and skill hashes.
6. Uses the GitHub App outside the sandbox to create a branch, commit, and pull
   request.
7. Records the authored pull request and completes.

The execute run completes when the pull request opens. Opening a pull request
means **proposed**, not **installed**.

### Pull-request monitoring

A durable monitor follows the authored setup pull request until it is merged
or closed. It reports CI, reviews, branch state, and repair activity in the
Fieldnote interface.

The monitor may start a repair attempt for an actionable CI failure or review
comment. Repair attempts use a credential-free sandbox, update only the setup
branch through the GitHub App, and are recorded with their trigger, resulting
commit, and outcome. V1 allows at most three repair rounds per pull request.

The monitor stops and asks for human action when feedback is ambiguous,
permissions are lost, a requested action is destructive, a secret would be
needed, or the retry bound is reached. Fieldnote never merges the pull
request.

### Post-merge verification

Merge triggers a fresh scan of the default branch. Fieldnote records the
installation as current only when all of the following are observed:

- the expected lock file exists and parses;
- its release and immutable upstream revision are valid;
- every skill in that release exists at every confirmed supported agent
  target;
- committed skill hashes match the lock;
- the profile exists and contains no unresolved required values; and
- the expected supporting configuration exists.

A closed-without-merge pull request leaves the repository uninstalled or
outdated. A merged but incomplete result is recorded as partial or drifted and
presented with a concrete repair action.

## Repository installation contract

### Complete release

V1 installs every skill in the selected Fieldnote Skills release. Repository
inspection does not choose a subset. This guarantees that the full loop is
available and avoids a later task failing because setup guessed that a skill
would not be needed.

Generic skill files are exact copies of the published release. Repository
customization never edits them.

### Agent targets

The first conversation message identifies detected agents and shows the
evidence:

> We found Codex and Claude Code in this repository from `AGENTS.md`,
> `.claude/`, and recent observed activity. Is that correct? Are we missing
> anything?

The user can confirm, remove a false positive, or add a missed agent. The
confirmed set becomes the installation target.

V1 supplies native repository adapters for Codex and Claude Code. The Codex
adapter writes to `.agents/skills/`; the Claude Code adapter writes to
`.claude/skills/`. Each adapter owns detection evidence, its repository skill
root, and any instruction-file integration it requires. The implementation
must verify these paths against the current agent contracts before shipping.

If an unsupported agent is detected or added, setup proceeds for supported
agents. The interface and pull-request body identify the unsupported agent and
state that no native adapter was installed for it. Unsupported agents never
silently count as installed.

For V1, supported targets receive separate byte-identical copies rather than
symlinks or wrapper skills. This favors reliable native discovery and portable
Git checkouts over deduplicating a small set of Markdown files.

### Repository-specific configuration

Repository facts live separately under `.fieldnote/`:

```text
.fieldnote/
  profile.md
  definition-of-done.md
  concerns/
    shared.md
    ...
  skills.lock.json
```

`fieldnote-setup-profile` is the authoring workflow for these files. It first
uses deterministic repository probes, then reads written repository evidence,
then asks about what remains unknowable. It does not execute an inferred check
command merely to decide whether that command belongs in the profile.

On update it preserves every explicit human-authored profile value. It fills
missing or `TODO` values and proposes evidence-backed corrections when the
repository changed. It never silently replaces a deliberate value.

### Lock file

`.fieldnote/skills.lock.json` records:

- schema version;
- published Fieldnote Skills release;
- immutable upstream revision;
- upstream release-lock hash;
- setup authoring-run identifier;
- confirmed supported target agents and destination roots;
- every installed skill and version; and
- hashes of the upstream and committed copy at every target.

The lock file is generated, never edited by hand. It is the source for
installation-state detection and drift reporting. A committed skill whose
hash differs from the lock is locally modified; an update run discusses that
drift instead of overwriting it silently.

## Product experience

The setup experience lives in the repository readiness area, where Act's
availability and repository grade already live.

The primary states are:

| Observed state                       | Primary presentation                         |
| ------------------------------------ | -------------------------------------------- |
| No verified lock/install             | **Set up Fieldnote**                         |
| A setup plan is exploring or waiting | Resume the setup conversation                |
| A setup execute run is active        | Preparing the setup pull request             |
| Setup PR is open                     | Link the PR and show monitoring status       |
| Merged, verification active          | Verifying the installation                   |
| Current                              | Fieldnote Skills vX installed                |
| Older than latest                    | **Update Fieldnote to vX**                   |
| Partial or drifted                   | Explain the mismatch and offer repair/update |

The conversation is resumable. Exploration results appear before questions.
Agent confirmation is the first question. Subsequent questions are focused,
one decision at a time, and explain why the fact matters to the installed
skills. No repository write occurs while required facts remain unresolved.

The pull request contains:

- the complete repository-local skill installation;
- the generated `.fieldnote/` configuration;
- a generated lock file;
- a concise explanation of detected and confirmed agents;
- the pinned Fieldnote Skills release;
- unsupported-agent gaps, if any; and
- verification evidence.

The pull request is the final review surface. There is no duplicate in-app
diff-approval step after the grill.

## Data model

The precise migration may split fields differently for indexing, but it must
represent the following contracts.

### `authoring_runs`

Add:

- `workflow`: `readiness-remediation | fieldnote-setup`
- `plan_run_id`: self-reference, required for an execute run and absent for a
  plan run

Existing state and provenance fields remain. One active authoring run per
repository remains the database-enforced default. A transition from a ready
plan run to its execute run occurs transactionally so both cannot be active at
once.

### `authoring_notes`

Durable conversation and findings:

```text
id, authoring_run_id, speaker ('agent' | 'human'),
kind ('finding' | 'question' | 'answer' | 'remark'), body, created_at
```

Ordering is stable. Browser reads remain repository-authorized.

### `fieldnote_setup_proposals`

One row per setup plan run:

```text
authoring_run_id, repository_sha,
skills_release, skills_revision, release_lock_hash,
detected_agents, confirmed_agents,
status ('exploring' | 'awaiting-input' | 'ready'),
created_at, updated_at
```

Detected and confirmed agent records include evidence and adapter support
state. The proposal also owns the generated repository-specific artifacts,
stored as path, kind, body, and content hash. It never stores a copy of the
target repository source or the generic upstream skill tree.

### `authored_pull_requests`

The existing designed link between an execute run and its pull request is
implemented for this workflow:

```text
id, authoring_run_id, repository_id, number,
branch, head_sha, outcome ('open' | 'merged' | 'closed'),
opened_at, merged_at, closed_at
```

Repository and pull-request number are unique. Setup workflow and release are
reachable through the authoring run and setup proposal.

### Repair attempts

Each automatic monitoring repair is durable:

```text
id, authored_pull_request_id, ordinal,
trigger_kind, trigger_reference, state,
base_head_sha, result_head_sha, error_code,
created_at, completed_at
```

The `(pull_request, ordinal)` uniqueness constraint enforces the retry bound
under concurrent delivery.

### `repository_fieldnote_installations`

The latest verified observation for a repository:

```text
repository_id, state ('current' | 'outdated' | 'partial' | 'drifted'),
release, revision, lock_hash, agents,
commit_sha, verified_at
```

Absence means no verified installation. `outdated` is computed against the
cached newest published release and persisted when observed. An open authored
setup PR remains proposal state and does not create or advance this record.

## Components and boundaries

### Release provider

A narrow Fieldnote Skills release provider resolves the newest published
release and fetches an immutable release by identifier. It validates
`catalog.json`, the upstream `skills.lock.json`, release metadata, and file
hashes before returning installable data. Latest-release metadata is cached so
rendering a readiness page does not consume a GitHub request every time.

### Agent adapters

Each supported agent adapter has three responsibilities:

1. detect evidence in a repository snapshot;
2. name its native repository-level skill destination; and
3. render any minimal agent-specific integration required for native discovery.

Adapters do not change generic Fieldnote skill content.

### Setup-profile author

This component runs deterministic probes, presents evidence, maintains
confirmed facts, and invokes the generic `fieldnote-setup-profile` skill for
judgment and conversation. It merges into existing configuration rather than
overwriting it.

### Installation renderer

A pure renderer receives a validated release, confirmed adapters, and the
repository-specific artifacts. It returns the complete file map and lock file.
Given the same inputs, it returns byte-identical output. It performs no GitHub
writes.

### GitHub writer

The GitHub writer creates commits, refs, and pull requests through the App
installation. It receives a validated file map. It is the only component that
holds write credentials.

### Pull-request monitor

The monitor consumes GitHub events plus reconciliation polling, classifies
actionable versus human-required states, starts bounded repair attempts, and
triggers post-merge verification. It never merges.

## Authorization and sandbox boundary

Setup and update require repository access, an active workspace relationship,
Act opt-in, and GitHub permissions sufficient to write contents and pull
requests. These checks run at request time and again before every external
write or long operation.

No GitHub installation token, application private key, database credential,
or workspace secret enters the sandbox. Fieldnote fetches repository and
release archives outside the sandbox and uploads credential-free bytes. The
sandbox returns structured findings or generated files, never credentials.

Repository content is untrusted input. Exploration tools are read-only.
Instructions found in the repository may inform repository facts but cannot
change the setup workflow, broaden write scope, request credentials, bypass
the human merge gate, or alter the pinned release source.

Generated configuration and conversation notes may be persisted because they
are explicit authoring outputs. Raw repository files never become durable
Inngest step output.

## Idempotency and stale-state handling

- At most one setup/update authoring run is active per repository.
- Repeated button presses return the active run.
- An existing open authored setup PR for the same repository and target
  release is resumed rather than duplicated.
- Branch and pull-request creation are recoverable after partial provider
  failure by looking up the recorded deterministic head identity.
- A plan records the repository SHA and evidence paths it consulted.
- Before execution, Fieldnote compares the current default branch with that
  snapshot. If relevant agent configuration, instructions, CI, or
  `.fieldnote/` files changed, it refreshes exploration. It returns to the
  conversation only when confirmed answers may no longer be valid.
- If unrelated files changed, execution applies the proposal to the current
  default-branch head.
- Local modifications to managed skill copies are drift, never disposable
  noise. An update explains them and requires a resolved proposal before
  replacement.

## Failure behavior

Failures use stable error codes and user-facing explanations; provider or
driver messages are not stored for rendering.

- Release lookup failure leaves the setup retryable and writes nothing.
- Release validation failure blocks installation and identifies the release as
  unusable.
- Permission loss stops before the next GitHub write.
- Sandbox failure preserves the conversation and proposal so the run can be
  retried. There is no deterministic floor that opens a partial installation
  PR.
- A profile with unresolved required facts cannot become ready.
- A branch conflict refreshes against the default branch; unresolved
  configuration conflicts return to the conversation.
- Monitoring stops after three unsuccessful repair rounds and requests human
  action.
- Closing without merge records the proposal outcome but does not mark the
  repository installed.
- Post-merge mismatch records partial or drifted installation and offers a
  repair action.

## Verification strategy

### Unit tests

- Agent detectors return evidence and never silently confirm it.
- Supported and unsupported agent confirmation is represented distinctly.
- Profile merging preserves explicit values, fills missing and `TODO` values,
  and surfaces evidence conflicts.
- The installation renderer installs every catalog skill for every confirmed
  supported adapter without changing bytes.
- Lock rendering and validation cover release, revision, targets, versions,
  and hashes.
- Installation-state classification distinguishes missing, proposed, current,
  outdated, partial, and drifted states.
- Monitoring decisions distinguish repairable, human-required, merged, and
  closed states.
- The repair limit cannot exceed three.

### Integration tests

- A setup request authorizes, queues, dispatches, and resumes idempotently.
- A plan conversation persists findings and answers across requests.
- A ready plan transitions transactionally to one linked execute run.
- Repeated or concurrent requests cannot create duplicate active runs,
  branches, or pull requests.
- GitHub write permission is re-checked before branch, commit, and pull-request
  mutations.
- Default-branch movement refreshes only when relevant evidence changed.
- An update preserves human-authored profile values and refuses to overwrite
  unexplained skill drift.
- Pull-request events drive monitoring, bounded repair attempts, and terminal
  outcomes.
- Merge triggers verification; only a valid default-branch installation
  creates a current installation observation.

### Manual acceptance

Run the complete flow against representative repositories using Codex only,
Claude Code only, both agents, and one additional unsupported detected agent.
For each, verify the setup conversation, generated PR, native skill discovery,
CI/review monitoring, human merge, default-branch verification, and subsequent
update-available state when a newer test release is published.

## Success criteria

- A new user can go from **Set up Fieldnote** to a reviewable installation pull
  request without manually authoring a profile or running a local installer.
- After merge, a supported coding agent discovers all Fieldnote Skills from
  the repository and those skills read a complete repository profile.
- Fieldnote never claims installation before observing the merged result.
- Re-running setup or update is safe, resumable, and idempotent.
- A new release becomes visible as an update without generating an unsolicited
  pull request.
- Monitoring repairs bounded, unambiguous failures and always leaves merge
  authority with a human.

## Out of scope

- Automatically opening update pull requests.
- Automatically merging any pull request.
- Native repository adapters beyond Codex and Claude Code in V1.
- Choosing a subset of the release's skills.
- Editing generic skill content for one repository.
- Installing skills into developers' user-level agent homes.
- General readiness remediation after installation; it remains the next Act
  capability and reuses the same authoring kernel.
- Public Train/MCP token issuance.
