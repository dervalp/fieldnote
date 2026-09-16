# Fieldnote Skills Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Act's first action: explore a repository, grill the user for missing setup facts, install the complete latest Fieldnote Skills release in a pull request, monitor it, and verify installation after merge.

**Architecture:** Extend the existing `authoring_runs` state machine with typed workflows and linked plan/execute runs. Pure modules resolve and validate immutable skills releases, detect agent targets, render repository-local installations, and classify observed installation state; provider modules collect repository evidence, run the setup author in an E2B sandbox, write through GitHub, and monitor the authored pull request. Workflow-specific proposal data stays separate from readiness remedies while shared authorization, dispatch, recovery, and provenance remain in the authoring kernel.

**Tech Stack:** TypeScript 6, Next.js 16.3 App Router and Server Functions, React 19, Drizzle ORM/PostgreSQL, Inngest 4, Octokit 5, Zod 4, Vitest 4, E2B 2.50.0, Claude Agent SDK 0.3.273.

**Spec:** `docs/superpowers/specs/2026-09-16-fieldnote-skills-setup-design.md`

## Global Constraints

- Install every skill in the selected release; never choose a subset.
- Generic skill files are byte-identical release copies. Repository-specific decisions live under `.fieldnote/`.
- Resolve the newest published release once at plan-run start and retain its immutable tag and commit SHA.
- V1 native adapters are Codex at `.agents/skills/` and Claude Code at `.claude/skills/`; unsupported detections are reported and do not block setup.
- No GitHub token, App private key, database credential, or workspace secret enters a sandbox.
- Raw repository source never becomes a durable Inngest step output. Persist findings, notes, confirmed facts, generated files, and hashes only.
- Every browser mutation authenticates and authorizes independently. Server Functions are directly POST-reachable.
- Fieldnote may repair its own setup branch at most three times and never merges.
- A pull request is a proposal. Only a merged, freshly verified default branch becomes an installed observation.
- Generate migrations with `pnpm db:generate`; never hand-write migration SQL.
- Unit tests do not use the network or database. Database behavior belongs in `*.integration.test.ts`.
- Read the installed Next.js 16 guides before changing App Router code; `params` is a promise and Server Function inputs are untrusted.
- `pnpm check` must pass before claiming the feature complete.

## Delivery slices

1. **Supply and observation:** publish immutable skills releases, validate them, render exact installations, and detect missing/current/outdated/drifted repositories.
2. **Interactive plan:** extend authoring persistence, collect setup evidence, run the setup-profile agent, and persist a resumable grill.
3. **Execute:** render the approved setup, write a branch through the GitHub App, and open one idempotent pull request.
4. **Monitor and verify:** repair bounded failures, observe merge/closure, verify the default branch, and unlock later Act actions.

## File structure

| Path                                                                  | Responsibility                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `fieldnote-skills/.github/workflows/release.yml` _(other repository)_ | Publish validated immutable `skills-v*` releases.                                                |
| `fieldnote-skills/docs/RELEASING.md` _(other repository)_             | Exact human release procedure referenced by existing tooling.                                    |
| `src/domain/fieldnote-skills/types.ts`                                | Release, adapter, lock, file-map, and installation-observation types.                            |
| `src/domain/fieldnote-skills/adapters.ts`                             | Pure agent evidence merge and native destination mapping.                                        |
| `src/domain/fieldnote-skills/lock.ts`                                 | Render/parse/validate `.fieldnote/skills.lock.json`.                                             |
| `src/domain/fieldnote-skills/render.ts`                               | Pure complete-release-to-repository-file-map renderer.                                           |
| `src/domain/fieldnote-skills/classify.ts`                             | Pure observed installation state classifier.                                                     |
| `src/fieldnote-skills/github-release.ts`                              | Resolve and fetch a published release from `dervalp/fieldnote-skills`.                           |
| `src/github/collect-fieldnote-setup.ts`                               | Bounded target-repository evidence collection at a pinned SHA.                                   |
| `src/github/write-authored-pr.ts`                                     | Create/update branch commits and one authored pull request.                                      |
| `src/authoring/sandbox.ts`                                            | Vendor-neutral authoring sandbox port.                                                           |
| `src/authoring/e2b-sandbox.ts`                                        | Production E2B adapter; no GitHub credential.                                                    |
| `src/authoring/setup-author.ts`                                       | Claude Agent SDK prompt/output adapter for exploration, turns, and repair.                       |
| `src/db/schema.ts` _(modify)_                                         | Typed workflows, notes, setup proposals/files, authored PRs, repairs, installation observations. |
| `src/db/queries/authoring-runs.ts` _(modify)_                         | Shared typed-run lifecycle and linked execute transition.                                        |
| `src/db/queries/fieldnote-setup.ts`                                   | Proposal, note, generated-file, PR, repair, and observation persistence.                         |
| `src/inngest/events.ts` _(modify)_                                    | Setup plan/execute/repair/verify event schemas.                                                  |
| `src/inngest/dispatch-authoring.ts` _(modify)_                        | Dispatch typed plan and execute runs.                                                            |
| `src/inngest/functions/plan-fieldnote-setup.ts`                       | Explore repository and create the first question.                                                |
| `src/inngest/functions/execute-fieldnote-setup.ts`                    | Render files, write branch, and open PR.                                                         |
| `src/inngest/functions/monitor-authored-pr.ts`                        | Reconcile checks/reviews, repair, merge, and closure.                                            |
| `src/inngest/functions/verify-fieldnote-installation.ts`              | Verify the merged default branch and persist observation.                                        |
| `src/app/app/repos/[repoId]/grading/actions.ts` _(modify)_            | Setup request and answer Server Functions.                                                       |
| `src/app/app/repos/[repoId]/grading/page.tsx` _(modify)_              | Installation state and primary Act progression.                                                  |
| `src/app/app/repos/[repoId]/act/[runId]/page.tsx` _(modify)_          | Route readiness or setup plan runs to their workflow-specific view.                              |
| `src/components/act/fieldnote-setup-entry.tsx`                        | Setup/update/current/open-PR presentation.                                                       |
| `src/components/act/setup-conversation.tsx`                           | Persistent notes, evidence, answer form, and execution status.                                   |
| `docs/github-app.md` _(modify)_                                       | Required events, permissions, and rollout behavior.                                              |

---

### Task 1: Publish an immutable Fieldnote Skills V1 release

Work in `https://github.com/dervalp/fieldnote-skills`. This is a prerequisite: its current `release.json` says `skills-v0.1.0`, but no Git tag or GitHub release exists.

**Files:**

- Create: `.github/workflows/release.yml`
- Create: `docs/RELEASING.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: existing `npm run release`, `npm run catalog`, `npm run validate`, `npm run check:decoupling`.
- Produces: latest GitHub release `skills-v0.1.0`, pointing at an immutable commit whose `release.json` and `skills.lock.json.release` both equal the tag.

- [ ] **Step 1: Add a failing release-contract test to the workflow**

Create `.github/workflows/release.yml` with validation before publication:

```yaml
name: Release

on:
  push:
    tags: ['skills-v*']

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run validate
      - run: npm run check:decoupling
      - name: Verify tag matches release metadata
        env:
          TAG: ${{ github.ref_name }}
        run: |
          node -e 'const fs=require("node:fs"); const tag=process.env.TAG; const release=JSON.parse(fs.readFileSync("release.json","utf8")).release; const lock=JSON.parse(fs.readFileSync("skills.lock.json","utf8")).release; if (tag!==release || tag!==lock) process.exit(1)'
      - name: Publish immutable GitHub release
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release create "${{ github.ref_name }}" --verify-tag --generate-notes
```

- [ ] **Step 2: Validate the workflow against the current untagged repository**

Run:

```bash
npm ci
npm run validate
npm run check:decoupling
test "$(node -p "require('./release.json').release")" = "skills-v0.1.0"
test "$(node -p "require('./skills.lock.json').release")" = "skills-v0.1.0"
```

Expected: all commands pass; `gh release view skills-v0.1.0` still fails because publication has not happened.

- [ ] **Step 3: Document the exact release procedure**

Create `docs/RELEASING.md` with these commands and invariants:

```markdown
# Releasing Fieldnote Skills

1. Run `npm run release 0.1.0` for the intended version.
2. Run `npm run catalog && npm run validate && npm run check:decoupling`.
3. Commit `release.json`, `catalog.json`, `CATALOG.md`, `skills.lock.json`, and stamped skill files through a pull request.
4. After merge, tag the merge commit: `git tag skills-v0.1.0 && git push origin skills-v0.1.0`.
5. The Release workflow validates that the tag, release metadata, and lock agree before creating the GitHub release.

Never retag or overwrite a published release. Publish a new version instead.
```

Add a README link under Status: `Release process: docs/RELEASING.md`.

- [ ] **Step 4: Run upstream checks and commit**

Run `npm run catalog && npm run validate && npm run check:decoupling && npm test --prefix cli`.

Commit:

```bash
git add .github/workflows/release.yml docs/RELEASING.md README.md
git commit -m "ci: publish immutable skills releases"
```

- [ ] **Step 5: Merge, tag, and verify V1**

After the release change merges to `main`:

```bash
git switch main
git pull --ff-only
git tag skills-v0.1.0
git push origin skills-v0.1.0
gh release view skills-v0.1.0 --json tagName,targetCommitish,isDraft,isPrerelease
```

Expected: `tagName` is `skills-v0.1.0`, and the release is neither draft nor prerelease.

---

### Task 2: Define the pure release, adapter, lock, and state contracts

**Files:**

- Create: `src/domain/fieldnote-skills/types.ts`
- Create: `src/domain/fieldnote-skills/adapters.ts`
- Create: `src/domain/fieldnote-skills/adapters.test.ts`
- Create: `src/domain/fieldnote-skills/classify.ts`
- Create: `src/domain/fieldnote-skills/classify.test.ts`

**Interfaces:**

- Consumes: `AgentId`, `Detection`, and `catalogue` from `src/domain/ai-involvement/`.
- Produces: `SkillsRelease`, `AgentCandidate`, `ConfirmedAgent`, `InstallationObservation`, `InstallationState`, `detectAgentCandidates()`, and `classifyInstallation()`.

- [ ] **Step 1: Write failing pure tests**

```typescript
test('merges repository and historical evidence without confirming it', () => {
  expect(
    detectAgentCandidates({ paths: ['AGENTS.md', '.claude/settings.json'], detections: [] }),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ agent: 'codex', supported: true, confirmed: false }),
      expect.objectContaining({ agent: 'claude-code', supported: true, confirmed: false }),
    ]),
  );
});

test('reports unsupported detections without blocking supported targets', () => {
  const candidates = detectAgentCandidates({
    paths: ['.cursor/rules'],
    detections: [],
  });
  expect(candidates).toContainEqual(expect.objectContaining({ agent: 'cursor', supported: false }));
});

test('classifies a verified older release as outdated', () => {
  expect(
    classifyInstallation({
      observation: validObservation('skills-v0.1.0'),
      latest: 'skills-v0.2.0',
      openPr: null,
    }),
  ).toEqual({ kind: 'outdated', installed: 'skills-v0.1.0', latest: 'skills-v0.2.0' });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run `pnpm vitest run src/domain/fieldnote-skills/adapters.test.ts src/domain/fieldnote-skills/classify.test.ts`.

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the narrow types and adapters**

Use these exact public shapes:

```typescript
export type SupportedSetupAgent = 'codex' | 'claude-code';

export interface AgentCandidate {
  agent: AgentId;
  label: string;
  supported: boolean;
  confirmed: boolean;
  evidence: Array<{ source: 'path' | 'executed' | 'configured' | 'declared'; value: string }>;
}

export interface ConfirmedAgent {
  agent: AgentId;
  supported: boolean;
  skillsRoot: string | null;
}

export interface ReleaseFile {
  path: string;
  content: string;
  hash: `sha256:${string}`;
}

export interface SkillsRelease {
  release: string;
  revision: string;
  releaseLockHash: `sha256:${string}`;
  skills: Array<{ name: string; version: string; files: ReleaseFile[] }>;
}

export interface GeneratedFile {
  path: string;
  kind: 'profile' | 'definition-of-done' | 'concern';
  content: string;
  hash: `sha256:${string}`;
}

export interface RenderedInstallation {
  files: ReadonlyMap<string, string>;
  lockHash: `sha256:${string}`;
}

export interface SetupRepositorySnapshot {
  sha: string;
  complete: boolean;
  paths: string[];
  documents: Array<{ path: string; blobSha: string; text: string }>;
  candidates: AgentCandidate[];
}

export interface InstallationObservation {
  state: 'current' | 'outdated' | 'partial' | 'drifted';
  release: string;
  revision: string;
  lockHash: string;
  agents: ConfirmedAgent[];
  commitSha: string;
  reasons: string[];
}

export const setupAdapters = {
  codex: { label: 'Codex', skillsRoot: '.agents/skills' },
  'claude-code': { label: 'Claude Code', skillsRoot: '.claude/skills' },
} as const;

export type InstallationState =
  | { kind: 'missing'; latest: string }
  | { kind: 'proposed'; runId: string; pullRequestUrl: string | null }
  | { kind: 'current'; release: string }
  | { kind: 'outdated'; installed: string; latest: string }
  | { kind: 'partial' | 'drifted'; release: string; reasons: string[] };
```

Detection must deduplicate evidence, sort by catalogue order, and never set `confirmed: true`; confirmation is human input persisted later.

- [ ] **Step 4: Run tests and commit**

Run `pnpm vitest run src/domain/fieldnote-skills/adapters.test.ts src/domain/fieldnote-skills/classify.test.ts`.

Commit:

```bash
git add src/domain/fieldnote-skills
git commit -m "feat(act): define Fieldnote Skills installation domain"
```

---

### Task 3: Resolve and validate immutable skills releases

**Files:**

- Create: `src/fieldnote-skills/github-release.ts`
- Create: `src/fieldnote-skills/github-release.test.ts`
- Modify: `src/lib/env.ts`
- Modify: `.env.example`

**Interfaces:**

- Consumes: GitHub public REST responses for `dervalp/fieldnote-skills`.
- Produces: `latestSkillsRelease(fetcher?: typeof fetch): Promise<SkillsRelease>` and `readSkillsRelease(tag, fetcher?): Promise<SkillsRelease>`.

- [ ] **Step 1: Write failing tests with a fake fetch**

Cover: latest release resolution, annotated/ordinary tag resolution through `commits/{tag}`, base64 content decoding, exact SHA-256 validation from `skills.lock.json`, a mismatched file, a tag/metadata mismatch, size limits, and non-200 responses. Assert stored errors are stable codes such as `release_unavailable` and `release_invalid`, never provider response text.

```typescript
await expect(
  readSkillsRelease('skills-v0.1.0', fakeFetch({ corrupt: 'fieldnote-testing' })),
).rejects.toMatchObject({ code: 'release_invalid', retryable: false });
```

- [ ] **Step 2: Run the test to verify failure**

Run `pnpm vitest run src/fieldnote-skills/github-release.test.ts`.

Expected: FAIL because `readSkillsRelease` does not exist.

- [ ] **Step 3: Implement the provider**

Validate all remote JSON with Zod. Resolve latest through:

```text
GET /repos/dervalp/fieldnote-skills/releases/latest
GET /repos/dervalp/fieldnote-skills/commits/{tag}
GET /repos/dervalp/fieldnote-skills/contents/release.json?ref={sha}
GET /repos/dervalp/fieldnote-skills/contents/catalog.json?ref={sha}
GET /repos/dervalp/fieldnote-skills/contents/skills.lock.json?ref={sha}
GET /repos/dervalp/fieldnote-skills/contents/skills/{name}/{file}?ref={sha}
```

Use `next: { revalidate: 300 }` only for the latest-release request. Fetch immutable SHA-addressed content with `cache: 'force-cache'`. Bound the catalog at 100 skills, each file at 256 KiB, and the complete decoded release at 8 MiB. Recompute every lock hash with `createHash('sha256')`.

Add optional `FIELDNOTE_SKILLS_GITHUB_TOKEN` support for rate capacity. It is a server-only operator credential and never enters a sandbox or rendered output.

- [ ] **Step 4: Run tests, typecheck, and commit**

```bash
pnpm vitest run src/fieldnote-skills/github-release.test.ts
pnpm typecheck
git add src/fieldnote-skills src/lib/env.ts .env.example
git commit -m "feat(act): validate published Fieldnote Skills releases"
```

---

### Task 4: Render and verify repository-local installations

**Files:**

- Create: `src/domain/fieldnote-skills/lock.ts`
- Create: `src/domain/fieldnote-skills/lock.test.ts`
- Create: `src/domain/fieldnote-skills/render.ts`
- Create: `src/domain/fieldnote-skills/render.test.ts`

**Interfaces:**

- Consumes: `SkillsRelease`, confirmed agents, and repository-specific `GeneratedFile[]`.
- Produces: `renderInstallation(input): RenderedInstallation` and `verifyInstallation(snapshot, latest): InstallationObservation`.

- [ ] **Step 1: Write failing renderer tests**

```typescript
const rendered = renderInstallation({
  release,
  setupRunId: 'run-1',
  agents: [
    { agent: 'codex', supported: true, skillsRoot: '.agents/skills' },
    { agent: 'claude-code', supported: true, skillsRoot: '.claude/skills' },
  ],
  configuration: [{ path: '.fieldnote/profile.md', content: completeProfile }],
});

expect(rendered.files.get('.agents/skills/fieldnote-testing/SKILL.md')).toBe(upstreamTesting);
expect(rendered.files.get('.claude/skills/fieldnote-testing/SKILL.md')).toBe(upstreamTesting);
expect(JSON.parse(rendered.files.get('.fieldnote/skills.lock.json')!)).toMatchObject({
  release: 'skills-v0.1.0',
  revision: release.revision,
});
```

Also assert path traversal is rejected, all catalog skills appear at every supported target, unsupported targets create no files, profile gaps prevent rendering, and one modified committed byte verifies as drift.

- [ ] **Step 2: Run tests to verify failure**

Run `pnpm vitest run src/domain/fieldnote-skills/lock.test.ts src/domain/fieldnote-skills/render.test.ts`.

- [ ] **Step 3: Implement a deterministic renderer**

Use `Map<string, string>` sorted lexicographically before lock rendering. The lock schema is version `1` and records release, revision, release lock hash, setup run id, agent roots, every skill version, and a SHA-256 for every destination copy. Reject absolute paths, `..`, NUL, duplicate paths, and configuration files outside `.fieldnote/`.

Keep `verifyInstallation()` pure: it receives an already bounded snapshot of expected paths and contents; provider IO stays elsewhere.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm vitest run src/domain/fieldnote-skills/lock.test.ts src/domain/fieldnote-skills/render.test.ts
git add src/domain/fieldnote-skills
git commit -m "feat(act): render locked repository skill installations"
```

---

### Task 5: Extend authoring persistence for typed setup workflows

**Files:**

- Modify: `src/db/schema.ts`
- Generated: next Drizzle migration and snapshot files
- Modify: `src/db/queries/authoring-runs.ts`
- Create: `src/db/queries/fieldnote-setup.ts`
- Create: `src/db/fieldnote-setup.integration.test.ts`

**Interfaces:**

- Consumes: existing `authoringRuns` and workspace authorization.
- Produces: typed workflow runs, notes, setup proposals/files, authored PRs, repair attempts, installation observations, and transactional `readySetupAndQueueExecute(planRunId)`.

- [ ] **Step 1: Write failing constraint and lifecycle tests**

Test these database invariants:

```typescript
await expect(insertExecute({ workflow: 'fieldnote-setup', planRunId: null })).rejects.toThrow();
await expect(insertPlan({ workflow: 'fieldnote-setup', planRunId: 'another' })).rejects.toThrow();
await expect(insertRepair({ pullRequestId, ordinal: 4 })).rejects.toThrow();
await expect(readySetupAndQueueExecute(planRunId)).resolves.toMatchObject({ kind: 'execute' });
await expect(readySetupAndQueueExecute(planRunId)).resolves.toMatchObject({ id: firstExecuteId });
```

Also prove existing readiness rows backfill to `readiness-remediation`, notes retain stable order, one proposal exists per setup plan, file paths are unique per proposal, PR number is unique per repository, and an open PR does not create an installation observation.

- [ ] **Step 2: Run the integration test to verify failure**

```bash
docker compose up -d --wait
pnpm vitest run --config vitest.integration.config.ts src/db/fieldnote-setup.integration.test.ts
```

- [ ] **Step 3: Add the schema and generate the migration**

Add `workflow` and `planRunId` to `authoring_runs`. Add focused tables matching the spec; use the existing schema helpers and import the JSON value types from the domain module:

```typescript
export const authoringNotes = pgTable('authoring_notes', {
  id: id(),
  authoringRunId: text('authoring_run_id')
    .notNull()
    .references(() => authoringRuns.id),
  speaker: text('speaker').$type<'agent' | 'human'>().notNull(),
  kind: text('kind').$type<'finding' | 'question' | 'answer' | 'remark'>().notNull(),
  body: text('body').notNull(),
  createdAt: created(),
});

export const fieldnoteSetupProposals = pgTable('fieldnote_setup_proposals', {
  authoringRunId: text('authoring_run_id')
    .primaryKey()
    .references(() => authoringRuns.id),
  repositorySha: text('repository_sha').notNull(),
  skillsRelease: text('skills_release').notNull(),
  skillsRevision: text('skills_revision').notNull(),
  releaseLockHash: text('release_lock_hash').notNull(),
  detectedAgents: jsonb('detected_agents').$type<AgentCandidate[]>().notNull(),
  confirmedAgents: jsonb('confirmed_agents').$type<ConfirmedAgent[]>(),
  state: text('state').$type<'exploring' | 'awaiting-input' | 'ready'>().notNull(),
  createdAt: created(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fieldnoteSetupFiles = pgTable(
  'fieldnote_setup_files',
  {
    id: id(),
    proposalRunId: text('proposal_run_id')
      .notNull()
      .references(() => fieldnoteSetupProposals.authoringRunId),
    path: text('path').notNull(),
    kind: text('kind').$type<'profile' | 'definition-of-done' | 'concern'>().notNull(),
    body: text('body').notNull(),
    hash: text('hash').notNull(),
  },
  (t) => [uniqueIndex('fieldnote_setup_files_path').on(t.proposalRunId, t.path)],
);

export const authoredPullRequests = pgTable(
  'authored_pull_requests',
  {
    id: id(),
    authoringRunId: text('authoring_run_id')
      .notNull()
      .unique()
      .references(() => authoringRuns.id),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    number: integer('number').notNull(),
    branch: text('branch').notNull(),
    headSha: text('head_sha').notNull(),
    url: text('url').notNull(),
    outcome: text('outcome').$type<'open' | 'merged' | 'closed'>().notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    mergedAt: timestamp('merged_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('authored_pull_requests_number').on(t.repositoryId, t.number)],
);

export const authoredPullRequestRepairs = pgTable(
  'authored_pull_request_repairs',
  {
    id: id(),
    authoredPullRequestId: text('authored_pull_request_id')
      .notNull()
      .references(() => authoredPullRequests.id),
    ordinal: integer('ordinal').notNull(),
    triggerKind: text('trigger_kind').notNull(),
    triggerReference: text('trigger_reference').notNull(),
    state: text('state').$type<'queued' | 'running' | 'complete' | 'failed'>().notNull(),
    baseHeadSha: text('base_head_sha').notNull(),
    resultHeadSha: text('result_head_sha'),
    errorCode: text('error_code'),
    createdAt: created(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('authored_pull_request_repairs_order').on(t.authoredPullRequestId, t.ordinal),
    check('authored_pull_request_repairs_ordinal', sql`${t.ordinal} BETWEEN 1 AND 3`),
  ],
);

export const repositoryFieldnoteInstallations = pgTable('repository_fieldnote_installations', {
  repositoryId: text('repository_id')
    .primaryKey()
    .references(() => repositories.id),
  state: text('state').$type<'current' | 'outdated' | 'partial' | 'drifted'>().notNull(),
  release: text('release').notNull(),
  revision: text('revision').notNull(),
  lockHash: text('lock_hash').notNull(),
  agents: jsonb('agents').$type<ConfirmedAgent[]>().notNull(),
  commitSha: text('commit_sha').notNull(),
  reasons: jsonb('reasons').$type<string[]>().notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
});
```

Use JSON columns only for detected/confirmed agent records whose Zod schema is defined in `src/domain/fieldnote-skills/types.ts`; keep indexed lifecycle values as columns.

Run `pnpm db:generate` and inspect the generated SQL for the backfill/default removal, foreign keys, checks, and partial unique indexes.

- [ ] **Step 4: Implement trusted persistence primitives**

Keep browser-facing functions authorization-first. Keep worker primitives unexported from browser action modules. The ready-to-execute transition must take the repository advisory lock, mark the proposal ready, complete the plan run, and insert exactly one linked queued execute run in one transaction.

- [ ] **Step 5: Run integration tests and commit**

```bash
pnpm vitest run --config vitest.integration.config.ts src/db/fieldnote-setup.integration.test.ts src/db/authoring-lifecycle.integration.test.ts
git add src/db drizzle
git commit -m "feat(act): persist Fieldnote setup authoring runs"
```

---

### Task 6: Collect bounded setup evidence and agent candidates

**Files:**

- Create: `src/github/collect-fieldnote-setup.ts`
- Create: `src/github/collect-fieldnote-setup.test.ts`
- Modify: `src/db/queries/ai-involvement.ts`

**Interfaces:**

- Consumes: repository id, pinned SHA, and stored AI-involvement detections.
- Produces: `collectFieldnoteSetup(repositoryId, sha): Promise<SetupRepositorySnapshot>` containing bounded paths/documents plus evidence-backed candidates.

- [ ] **Step 1: Write failing collector tests**

Mock Octokit and cover flat and truncated trees, invalid UTF-8, symlinks/submodules, file and total byte limits, agent marker paths, existing `.fieldnote/`, CI workflows, deployment files, package manifests, root instructions, ADRs, PR templates, and provider error sanitization.

```typescript
expect(snapshot.candidates).toContainEqual(
  expect.objectContaining({
    agent: 'claude-code',
    confirmed: false,
    evidence: expect.arrayContaining([{ source: 'path', value: '.claude/settings.json' }]),
  }),
);
```

- [ ] **Step 2: Run the test to verify failure**

Run `pnpm vitest run src/github/collect-fieldnote-setup.test.ts`.

- [ ] **Step 3: Implement bounded collection**

Reuse the immutable-tree traversal and deadline/error pattern from `collect-readiness.ts`, but use setup-specific relevance rules. Limits: 15,000 tree entries, 400 documents, 256 KiB per file, 4 MiB total decoded content. Do not return secrets files, arbitrary source code, lockfiles other than `.fieldnote/skills.lock.json`, or binary data.

Add a trusted `loadDetectionsForWorker(repositoryId)` that does not depend on browser session state and returns only normalized detection evidence.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm vitest run src/github/collect-fieldnote-setup.test.ts src/domain/fieldnote-skills/adapters.test.ts
git add src/github src/db/queries/ai-involvement.ts
git commit -m "feat(act): collect setup evidence and agent candidates"
```

---

### Task 7: Add the sandbox and setup-profile author

**Files:**

- Modify: `package.json`, `pnpm-lock.yaml`
- Create: `src/authoring/sandbox.ts`
- Create: `src/authoring/local-sandbox.ts`
- Create: `src/authoring/e2b-sandbox.ts`
- Create: `src/authoring/setup-author.ts`
- Create: `src/authoring/setup-author.test.ts`
- Modify: `src/lib/env.ts`, `.env.example`

**Interfaces:**

- Consumes: bounded repository snapshot, pinned `fieldnote-setup-profile/SKILL.md`, candidates, and prior notes.
- Produces: validated `SetupAuthorResult` with findings, exactly zero or one next question, confirmed facts, and `.fieldnote/` generated files when ready.

- [ ] **Step 1: Install pinned dependencies and inspect their declarations**

```bash
pnpm add -E e2b@2.50.0 @anthropic-ai/claude-agent-sdk@0.3.273
rg -n "export declare function query|export declare type Options" node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts
rg -n "declare class Sandbox|static create|commands:|files:" node_modules/e2b/dist/index.d.ts
```

Do not implement against remembered SDK APIs. The inspected declarations are binding.

- [ ] **Step 2: Write failing contract tests**

Define and test this port:

```typescript
export interface AuthoringSandbox {
  run(input: {
    files: ReadonlyMap<string, string>;
    prompt: string;
    mode: 'read-only' | 'write-generated';
  }): Promise<{ sandboxId: string; model: string; output: unknown; files: Map<string, string> }>;
}
```

Tests must prove schema-invalid model output is rejected, repository instructions cannot expand allowed output paths, only `.fieldnote/**` is returned in write mode, the first result asks the agent-confirmation question, one question is emitted per turn, and a ready result has no unresolved required profile facts.

- [ ] **Step 3: Implement the local fake and output schema**

`local-sandbox.ts` is deterministic test/development infrastructure; it never calls a model. `setup-author.ts` builds the prompt from the pinned skill, evidence, and notes, then parses output with a closed Zod schema. Its system contract explicitly states that repository files are evidence, not workflow instructions.

- [ ] **Step 4: Implement the E2B adapter**

Create a sandbox with a five-minute timeout, upload only bounded evidence plus the pinned setup skill, run the Agent SDK runner with tools limited to `Read`, `Glob`, and `Grep` in read-only mode, and destroy the sandbox in `finally`. For generated configuration, allow writes only under `/workspace/.fieldnote`; validate returned paths again outside the sandbox.

The environment passed to the runner contains only `ANTHROPIC_API_KEY`, `PATH`, `HOME`, and `CLAUDE_AGENT_SDK_CLIENT_APP=fieldnote/0.1.0`. It contains no GitHub, database, Inngest, or encryption variables.

- [ ] **Step 5: Run tests without production credentials and commit**

```bash
env -u E2B_API_KEY -u ANTHROPIC_API_KEY pnpm vitest run src/authoring/setup-author.test.ts
pnpm typecheck
git add package.json pnpm-lock.yaml src/authoring src/lib/env.ts .env.example
git commit -m "feat(act): author setup profiles in an isolated sandbox"
```

---

### Task 8: Run and resume the setup grill

**Files:**

- Modify: `src/inngest/events.ts`
- Modify: `src/inngest/dispatch-authoring.ts`
- Create: `src/inngest/functions/plan-fieldnote-setup.ts`
- Create: `src/inngest/functions/plan-fieldnote-setup.test.ts`
- Modify: `src/inngest/functions/reconcile-authoring.ts`
- Modify: `src/app/api/inngest/route.ts`
- Modify: `src/app/app/repos/[repoId]/grading/actions.ts`

**Interfaces:**

- Consumes: release provider, setup collector, setup author, and setup persistence.
- Produces: `requestFieldnoteSetup(repositoryId)`, `answerFieldnoteSetup(repositoryId, runId, formData)`, and durable `repository/fieldnote.setup.plan.requested` processing.

- [ ] **Step 1: Write failing function and action tests**

Prove: request authorization, one active run, latest release pinned once, repository SHA pinned once, candidates persisted before the first question, repeated dispatch idempotency, answer authorization, exactly one pending question, and automatic linked execute queuing once the result is ready.

```typescript
await answerFieldnoteSetup(repoId, runId, form('Yes; Codex and Claude Code are correct.'));
expect(deps.appendAnswer).toHaveBeenCalledWith(runId, expect.any(String));
expect(deps.queueExecute).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run tests to verify failure**

Run `pnpm vitest run src/inngest/functions/plan-fieldnote-setup.test.ts 'src/app/app/repos/[repoId]/grading/actions.test.ts'`.

- [ ] **Step 3: Implement durable exploration**

Use stable steps `begin`, `pin-release`, `pin-commit`, `collect`, and `explore`. Step outputs contain ids and hashes, not repository documents. `collect` calls the author and persists results inside the step before returning. Reconciliation dispatches queued setup plans exactly like existing readiness plans.

Answers are ordinary Server Functions, not a long-running Inngest step. Each call authorizes with `requireRepository`, validates the run belongs to the repository and is awaiting input, appends the answer, invokes the author over persisted findings/notes, and either stores the next question or transactionally queues the execute run.

- [ ] **Step 4: Register functions, run tests, and commit**

```bash
pnpm vitest run src/inngest/functions/plan-fieldnote-setup.test.ts src/inngest/dispatch-authoring.test.ts 'src/app/app/repos/[repoId]/grading/actions.test.ts'
git add src/inngest src/app/api/inngest/route.ts 'src/app/app/repos/[repoId]/grading/actions.ts'
git commit -m "feat(act): run a resumable Fieldnote setup grill"
```

---

### Task 9: Render the setup conversation and Act progression

**Files:**

- Create: `src/components/act/fieldnote-setup-entry.tsx`
- Create: `src/components/act/fieldnote-setup-entry.test.ts`
- Create: `src/components/act/setup-conversation.tsx`
- Create: `src/components/act/setup-conversation.test.ts`
- Modify: `src/app/app/repos/[repoId]/grading/page.tsx`
- Modify: `src/app/app/repos/[repoId]/grading/page.test.ts`
- Modify: `src/app/app/repos/[repoId]/act/[runId]/page.tsx`
- Modify: `src/lib/app-routes.ts`, `src/lib/app-routes.test.ts`

**Interfaces:**

- Consumes: `InstallationState`, latest setup plan/PR, proposal candidates, and notes.
- Produces: setup/update CTA, resume link, current/outdated/open-PR presentation, and answer form.

- [ ] **Step 1: Write failing rendering tests**

Assert exact primary copy for missing, current, outdated, drifted, exploring, waiting, preparing, open PR, and verifying states. Assert the existing readiness **Plan the fixes** entry is absent until installation is current. Assert evidence is visible beside each candidate and unsupported agents say no native adapter will be installed.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm vitest run src/components/act/fieldnote-setup-entry.test.ts src/components/act/setup-conversation.test.ts 'src/app/app/repos/[repoId]/grading/page.test.ts'
```

- [ ] **Step 3: Implement server-rendered state and a small client answer form**

Keep the page dynamic. Await `params`. The form action calls `answerFieldnoteSetup.bind(null, repositoryId, runId)`. Use `useActionState` only for pending/error feedback; authorization stays in the Server Function. Render notes in database order and one current question.

- [ ] **Step 4: Run tests, build, and commit**

```bash
pnpm vitest run src/components/act 'src/app/app/repos/[repoId]/grading/page.test.ts' src/lib/app-routes.test.ts
pnpm typecheck
git add src/components/act 'src/app/app/repos/[repoId]' src/lib/app-routes.ts src/lib/app-routes.test.ts
git commit -m "feat(act): guide repositories through Fieldnote setup"
```

---

### Task 10: Render, commit, and open the setup pull request

**Files:**

- Create: `src/github/write-authored-pr.ts`
- Create: `src/github/write-authored-pr.test.ts`
- Create: `src/inngest/functions/execute-fieldnote-setup.ts`
- Create: `src/inngest/functions/execute-fieldnote-setup.test.ts`
- Modify: `src/inngest/events.ts`
- Modify: `src/inngest/dispatch-authoring.ts`
- Modify: `src/inngest/functions/reconcile-authoring.ts`
- Modify: `src/app/api/inngest/route.ts`

**Interfaces:**

- Consumes: ready setup proposal, pinned release, current default-branch head, renderer, and GitHub installation client.
- Produces: branch `fieldnote/setup-skills-vX`, one commit, one authored pull request, and persisted PR identity.

- [ ] **Step 1: Write failing GitHub writer tests**

Mock Octokit and prove the writer: reads the current default ref, creates blobs/tree/commit/ref, recovers an already-created ref, finds an existing open PR before creating, updates the recorded PR head, and sanitizes provider errors.

```typescript
const result = await writeAuthoredPullRequest(input, fakeClient);
expect(result).toEqual({
  number: 42,
  branch: 'fieldnote/setup-skills-v0.1.0',
  headSha: 'new-sha',
  url: 'https://github.test/pr/42',
});
```

- [ ] **Step 2: Write failing execute-function tests**

Prove stable steps `begin`, `refresh`, `render`, `write-pr`, `complete`; write permission re-check; relevant-evidence movement returns the plan to awaiting input; unrelated movement rebases to current head; renderer validation occurs before GitHub mutation; and retries reuse the existing branch/PR.

- [ ] **Step 3: Implement the GitHub writer**

Use Git data APIs rather than putting credentials in a sandbox. Build a tree from validated UTF-8 file content. Never delete repository files. Refuse a destination path already modified on the current base when its proposal base blob differs; return a stable `setup_conflict` result for refreshed exploration.

The PR title is `Set up Fieldnote Skills vX`. Its body lists confirmed agents, unsupported gaps, release/revision, profile evidence summary, and verification performed. It contains no raw source or model transcript.

- [ ] **Step 4: Implement and register the execute function**

The renderer runs deterministically outside the sandbox from persisted configuration plus the pinned validated release. A sandbox is used only when the setup author must revise generated `.fieldnote/` files after evidence refresh. Record the PR before marking the execute run complete.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm vitest run src/github/write-authored-pr.test.ts src/inngest/functions/execute-fieldnote-setup.test.ts
git add src/github/write-authored-pr* src/inngest src/app/api/inngest/route.ts
git commit -m "feat(act): open idempotent Fieldnote setup pull requests"
```

---

### Task 11: Monitor and repair the authored pull request

**Files:**

- Create: `src/domain/act/pr-monitor.ts`
- Create: `src/domain/act/pr-monitor.test.ts`
- Create: `src/inngest/functions/monitor-authored-pr.ts`
- Create: `src/inngest/functions/monitor-authored-pr.test.ts`
- Modify: `src/github/handle-event.ts`, `src/github/handle-event.test.ts`
- Modify: `src/inngest/events.ts`
- Modify: `src/app/api/inngest/route.ts`

**Interfaces:**

- Consumes: authored PR snapshot, checks, reviews, current head, and repair history.
- Produces: pure `monitorDecision()` and durable monitor/repair events.

- [ ] **Step 1: Write failing decision tests**

```typescript
expect(
  monitorDecision({ outcome: 'open', failures: [actionableLint], reviews: [], repairs: 0 }),
).toEqual({ kind: 'repair', trigger: actionableLint });
expect(
  monitorDecision({ outcome: 'open', failures: [actionableLint], reviews: [], repairs: 3 }),
).toEqual({ kind: 'human-required', reason: 'repair_limit' });
expect(monitorDecision({ outcome: 'merged', failures: [], reviews: [], repairs: 1 })).toEqual({
  kind: 'verify',
});
```

Cover ambiguous review, permission loss, requested secret, destructive feedback, pending checks, closed PR, merged PR, and never returning a merge action.

- [ ] **Step 2: Run tests to verify failure**

Run `pnpm vitest run src/domain/act/pr-monitor.test.ts src/inngest/functions/monitor-authored-pr.test.ts`.

- [ ] **Step 3: Route relevant GitHub events**

After existing raw-event persistence and PR hydration, identify authored PRs by repository/number and dispatch `repository/authored-pr.monitor.requested`. Do not bypass the raw-event-first invariant. Reconciliation also scans nonterminal authored PRs so missed webhooks recover.

- [ ] **Step 4: Implement bounded repair**

Reserve the next ordinal transactionally before starting a repair. The repair author receives only the setup file map, normalized CI/review evidence, and prior repair outcomes. It may edit only managed setup paths. Validate the replacement file map and update the same branch with `force-with-lease` semantics expressed through expected-head SHA checks in the Git data API.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm vitest run src/domain/act/pr-monitor.test.ts src/inngest/functions/monitor-authored-pr.test.ts src/github/handle-event.test.ts
git add src/domain/act/pr-monitor* src/inngest src/github/handle-event* src/app/api/inngest/route.ts
git commit -m "feat(act): monitor and repair setup pull requests"
```

---

### Task 12: Verify merged installations and unlock later Act actions

**Files:**

- Create: `src/github/verify-fieldnote-installation.ts`
- Create: `src/github/verify-fieldnote-installation.test.ts`
- Create: `src/inngest/functions/verify-fieldnote-installation.ts`
- Create: `src/inngest/functions/verify-fieldnote-installation.test.ts`
- Create: `src/db/queries/fieldnote-installations.ts`
- Modify: `src/inngest/events.ts`
- Modify: `src/app/api/inngest/route.ts`
- Modify: `src/app/app/repos/[repoId]/grading/page.tsx`
- Modify: `src/components/act/fieldnote-setup-entry.tsx`

**Interfaces:**

- Consumes: merged authored PR, latest published release, and bounded default-branch expected-path snapshot.
- Produces: verified current/outdated/partial/drifted observation and final Act UI state.

- [ ] **Step 1: Write failing verification tests**

Cover valid install, missing lock, malformed lock, missing target, missing skill, changed skill hash, incomplete profile, unsupported agent recorded but not expected, older valid release, and default branch not yet containing the merge.

```typescript
expect(await verifyFieldnoteInstallation(validSnapshot, latestRelease)).toMatchObject({
  state: 'current',
  release: 'skills-v0.1.0',
});
```

- [ ] **Step 2: Run tests to verify failure**

Run `pnpm vitest run src/github/verify-fieldnote-installation.test.ts src/inngest/functions/verify-fieldnote-installation.test.ts`.

- [ ] **Step 3: Implement merge-triggered verification**

The monitor dispatches verification only for merged authored PRs. The verifier resolves the repository's current default-branch SHA, fetches only lock-declared paths plus required configuration, runs pure lock/profile verification, and upserts the observation. If GitHub has not exposed the merge on the default branch yet, throw a retryable stable error rather than recording partial state.

- [ ] **Step 4: Gate readiness remediation on current installation**

Update the grading page so setup state is primary until a current or valid outdated installation exists. A valid outdated installation exposes **Update Fieldnote to vX** and may still show broader readiness actions; missing, proposed, partial, or drifted states do not.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm vitest run src/github/verify-fieldnote-installation.test.ts src/inngest/functions/verify-fieldnote-installation.test.ts src/components/act/fieldnote-setup-entry.test.ts 'src/app/app/repos/[repoId]/grading/page.test.ts'
git add src/github/verify-fieldnote-installation* src/inngest src/db/queries/fieldnote-installations.ts src/components/act 'src/app/app/repos/[repoId]/grading/page.tsx' src/app/api/inngest/route.ts
git commit -m "feat(act): verify merged Fieldnote Skills installations"
```

---

### Task 13: Rollout documentation and end-to-end validation

**Files:**

- Modify: `docs/github-app.md`
- Modify: `docs/roadmap.md`
- Modify: `README.md`
- Create: `docs/validation-fieldnote-skills-setup.md`

**Interfaces:**

- Consumes: the complete feature.
- Produces: operator rollout procedure and evidence that setup works without weakening Monitor.

- [ ] **Step 1: Update operational documentation**

Document Contents/Pull requests write permission, pull-request review/check/workflow subscriptions, `E2B_API_KEY`, `ANTHROPIC_API_KEY`, optional `FIELDNOTE_SKILLS_GITHUB_TOKEN`, Inngest function registration, reconciliation, three-repair limit, no-auto-merge rule, and release-source allowlist.

- [ ] **Step 2: Run the complete automated suite**

```bash
docker compose up -d --wait
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Expected: every command passes. Production build uses the same synthetic environment pattern already documented in `.github/workflows/ci.yml`; no real GitHub, E2B, or Anthropic request is made by tests/build.

- [ ] **Step 3: Perform four manual acceptance runs**

Use authorized disposable repositories representing Codex only, Claude Code only, both, and both plus unsupported Cursor evidence. For each, record:

1. detected evidence and human confirmation;
2. one-question-at-a-time grill and resume after navigation;
3. exact complete skill copies and lock hashes in the PR;
4. active CI/review monitoring without merge;
5. human merge;
6. post-merge default-branch verification; and
7. current/update-available UI state.

Also close one setup PR without merge and prove the repository remains uninstalled.

- [ ] **Step 4: Write the validation report**

Create `docs/validation-fieldnote-skills-setup.md` with command results, tested repository shapes, screenshots/PR links that contain no secrets, observed limitations, and rollout actions still pending. Do not claim production readiness from mocked tests alone.

- [ ] **Step 5: Commit documentation and validation**

```bash
git add README.md docs/github-app.md docs/roadmap.md docs/validation-fieldnote-skills-setup.md
git commit -m "docs(act): validate Fieldnote Skills setup"
```

## Final review gate

Before opening the implementation pull request:

- Read the approved spec and map every requirement to one task above.
- Inspect every changed migration, provider boundary, Server Function, and GitHub mutation for authorization and idempotency.
- Run `git diff --check` and `pnpm check` from a clean environment.
- Review the whole branch against the spec with `superpowers:requesting-code-review`.
- Confirm the branch contains no credentials, downloaded customer source, sandbox transcript, or generated test artifact.
- Confirm no code path merges an authored pull request.
