# Grader Factory Slice 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A grader someone else wrote can be published under a workspace's handle, read by a person at fieldnote, installed with the team's eyes open, and removed without a trace left running.

**Architecture:** Graders move out of a process-local map and into three tables (`graders`, `grader_versions`, `grader_installs`); `grading_rubrics` is dropped because `grader_versions` already is an immutable manifest per `(grader_id, version)`. Resolution splits in two — `graderVersion(graderId, version)` for anything reading a finished grade, `installedGrader(workspaceId, graderId)` for anything starting a new one — and every one of the ten call sites moves at once. On top sit publishing, a staff review queue, and an install flow whose consent is enforced in `collectEvidence()` rather than at the screen.

**Tech Stack:** Next.js 16 App Router (server actions, server components), React 19, Drizzle ORM + Postgres, drizzle-kit, Zod 4, Inngest 4, Vitest 4, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-15-grader-factory-slice-6-design.md`

## Global Constraints

- `src/domain/grading/readiness-v01.test.ts` must stay **byte-identical to `main`** and pass. It grades a manifest imported from code; that is why built-ins keep their code manifests.
- **No `if` naming a grader id** inside `src/domain/grading` or `src/grading`. A built-in is an ordinary row: seeded, resolved, installed and uninstalled like any other.
- **The existing grading tests are the refactor's safety net.** They may gain `await`, a seeded row or a mock, and nothing else. A test deleted or weakened during the resolution change is the failure this slice is most likely to produce.
- `src/db/queries/public-grades.ts` must keep importing nothing from `auth/session`, `workspaces/access`, `next/headers` or `next/navigation`, directly or transitively — `src/db/queries/public-grades.imports.test.ts` walks the graph and enforces it.
- A published `(grader_id, version)` is **never updated or replaced**, apart from `verified_at`/`verified_by`/`withdrawn_at`/`withdrawn_note`.
- Publishing refuses `kind: code` (open question 3 is unanswered). fieldnote's own code grader is **seeded**, not published through the form.
- Handle format `[a-z0-9][a-z0-9-]{1,38}`; reserved: `fieldnote`, `admin`, `api`, `app`, `r`, `www`, `support`. A handle is claimed once and never changed.
- Consent copy is **generated from `needs`**, never hand-written per grader.
- Never `git add -A` or `git add .`; stage explicit paths. Do not touch `.agents/`, `.claude/`, `skills-lock.json`.
- Every commit message ends with exactly `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` and no other Co-Authored-By line. Never write your own model name.
- `eslint .` walks sibling worktrees under `.claude/worktrees/`; failures there are not yours.
- Gate: `pnpm check` with `DEMO_MODE=false` for the integration run. Known baseline: 2 integration failures in `src/inngest/dispatch-import.integration.test.ts` that also fail on `main`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/db/schema.ts` (modify) | `workspaces.handle`, `users.staff`, `graders`, `grader_versions`, `grader_installs`; `gradingRubrics` deleted |
| `drizzle/0017_grader_registry.sql` (generated) | The migration |
| `src/db/queries/graders.ts` (create) | Reads: `graderVersion`, `installedGrader`, `installedGraders`, `browsableGraders`; seeding: `seedBuiltInGraders`, `installBuiltIns` |
| `src/db/queries/grader-publishing.ts` (create) | Writes: `claimHandle`, `publishGrader`, `withdrawVersion`, `verifyVersion`, `reviewQueue` |
| `src/db/queries/grader-installs.ts` (create) | Writes: `installGrader`, `updateInstall`, `uninstallGrader`, `consentFor` |
| `src/domain/grading/registry.ts` (modify) | Keeps `parseManifest` re-export and the built-in seed list; loses `getGrader`/`listGraders` |
| `src/domain/grading/needs-consent.ts` (create) | `needsHash(needs)` and `consentSentences(needs)` — pure |
| `src/db/queries/grade-runs.ts` (modify) | `registerRubric` → `pinnedManifest`; `requestGrade`/`scheduleGrade` resolve the installed version; `validateGradeRun` resolves the pinned one |
| `src/inngest/functions/grade-repository.ts`, `schedule-grades.ts` (modify) | Await resolution; carry the consent hash |
| `src/grading/evidence.ts` (modify) | Refuse to collect when consent does not match |
| `src/components/grading/grade-presentation.ts` (modify) | Takes a manifest instead of resolving one |
| `src/app/app/repos/[repoId]/grading/page.tsx` (modify) | Renders installed graders |
| `src/app/app/settings/graders/page.tsx` + `actions.ts` (create) | Handle claim, publish, browse, install, update, uninstall |
| `src/app/app/admin/graders/page.tsx` + `actions.ts` (create) | Staff review queue |
| `src/components/grading/consent.tsx` (create) | The generated consent screen |
| `scripts/migrate.ts`, `scripts/seed.ts`, `src/workspaces/store.ts` (modify) | Seed built-ins; install them for every workspace |

---

### Task 1: The registry's tables

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0017_grader_registry.sql` (generated)
- Test: `src/db/schema.test.ts` (create)

**Interfaces:**
- Produces: `workspaces.handle` (nullable unique text), `users.staff` (boolean, default false), and the tables `graders`, `graderVersions`, `graderInstalls` exported from `src/db/schema.ts`. `gradingRubrics` no longer exists.

- [ ] **Step 1: Write the failing test**

Create `src/db/schema.test.ts`:

```ts
import { expect, test } from 'vitest';
import { graders, graderVersions, graderInstalls, users, workspaces } from './schema';
import * as schema from './schema';

test('the registry tables exist with the columns the slice needs', () => {
  expect(Object.keys(graders)).toEqual(expect.arrayContaining(['id', 'ownedByWorkspaceId']));
  expect(Object.keys(graderVersions)).toEqual(
    expect.arrayContaining([
      'graderId',
      'version',
      'manifest',
      'evaluatorVersion',
      'publishedBy',
      'publishedAt',
      'verifiedAt',
      'verifiedBy',
      'withdrawnAt',
      'withdrawnNote',
    ]),
  );
  expect(Object.keys(graderInstalls)).toEqual(
    expect.arrayContaining(['workspaceId', 'graderId', 'version', 'installedBy', 'consentedNeeds']),
  );
  expect(Object.keys(workspaces)).toContain('handle');
  expect(Object.keys(users)).toContain('staff');
});

test('grading_rubrics is gone: grader_versions is the immutable manifest per version', () => {
  expect('gradingRubrics' in schema).toBe(false);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/db/schema.test.ts`
Expected: FAIL — the tables do not exist.

- [ ] **Step 3: Change the schema**

In `src/db/schema.ts`: add to `workspaces`

```ts
  // Claimed once by an owner and never changed: published grader ids contain
  // it, and other workspaces' installs point at those ids.
  handle: text('handle').unique(),
```

add to `users`

```ts
  // fieldnote staff. Set directly in the database — there is no screen for it,
  // and the design records that as knowingly wrong.
  staff: boolean('staff').notNull().default(false),
```

replace the whole `gradingRubrics` table with:

```ts
// One row per grader name, and which workspace owns that name. A null owner is
// fieldnote's own, seeded from the manifests in src/domain/grading/graders.
export const graders = pgTable('graders', {
  id: text('id').primaryKey(),
  ownedByWorkspaceId: text('owned_by_workspace_id').references(() => workspaces.id),
  createdAt: created(),
});

// The registry entry and the rubric a run is pinned to, in one row: both are
// the same immutable manifest for the same (grader_id, version), and storing
// it twice would mean two writers and a drift check between them. Only the
// four lifecycle columns below may change after publication.
export const graderVersions = pgTable(
  'grader_versions',
  {
    graderId: text('grader_id')
      .notNull()
      .references(() => graders.id),
    version: text('version').notNull(),
    evaluatorVersion: text('evaluator_version').notNull(),
    manifest: jsonb('manifest').$type<Record<string, unknown>>().notNull(),
    publishedBy: text('published_by').references(() => users.id),
    publishedAt: created(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: text('verified_by').references(() => users.id),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawnNote: text('withdrawn_note'),
  },
  (t) => [primaryKey({ columns: [t.graderId, t.version] })],
);

// What a workspace installed, and what it agreed that grader may read.
// Installing pins one version; an update re-pins it, and re-consents when the
// declared needs changed.
export const graderInstalls = pgTable(
  'grader_installs',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    graderId: text('grader_id')
      .notNull()
      .references(() => graders.id),
    version: text('version').notNull(),
    installedBy: text('installed_by')
      .notNull()
      .references(() => users.id),
    installedAt: created(),
    // The canonical hash of the manifest's `needs`. collectEvidence refuses to
    // collect anything when the running manifest's needs do not hash to this.
    consentedNeeds: text('consented_needs').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.graderId] })],
);
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate --name grader_registry`
Read `drizzle/0017_grader_registry.sql`: it must create the three tables, add the two columns and **drop `grading_rubrics`**. Nothing else. If drizzle-kit asks whether a table was renamed, answer that it was created (these are new tables, and the drop is intended).

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm vitest run src/db/schema.test.ts && pnpm typecheck`
Expected: the schema test passes. `pnpm typecheck` **fails** in `src/db/queries/grade-runs.ts`, `scripts/seed.ts` and the tests that import `gradingRubrics` — Tasks 2–5 fix those; do not patch them here.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/schema.test.ts drizzle
git commit -m "feat(grading): tables for a registry of graders

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Resolution, and the built-in seed

**Files:**
- Create: `src/db/queries/graders.ts`, `src/domain/grading/needs-consent.ts`
- Modify: `src/domain/grading/registry.ts`, `src/workspaces/store.ts`, `scripts/migrate.ts`
- Test: `src/domain/grading/needs-consent.test.ts`, `src/db/graders.integration.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's tables.
- Produces:
  - `needsHash(needs: GraderManifest['needs']): string` and `consentSentences(needs): string[]` in `src/domain/grading/needs-consent.ts`
  - `builtInManifests(): GraderManifest[]` in `src/domain/grading/registry.ts` (replacing `getGrader`/`listGraders`)
  - in `src/db/queries/graders.ts`:
    - `graderVersion(graderId: string, version: string): Promise<GraderManifest | null>`
    - `installedGrader(workspaceId: string, graderId: string): Promise<InstalledGrader | null>`
    - `installedGraders(workspaceId: string): Promise<InstalledGrader[]>`
    - `browsableGraders(workspaceId: string): Promise<BrowsableGrader[]>`
    - `seedBuiltInGraders(): Promise<void>`, `installBuiltIns(workspaceId: string): Promise<void>`
    - `type InstalledGrader = { manifest: GraderManifest; version: string; consentedNeeds: string; verifiedAt: Date | null; withdrawnAt: Date | null; latestVersion: string }`
    - `type BrowsableGrader = { id: string; manifest: GraderManifest; version: string; verifiedAt: Date | null; author: string; installed: InstalledGrader | null }`

- [ ] **Step 1: Write the failing pure tests**

Create `src/domain/grading/needs-consent.test.ts`:

```ts
import { expect, test } from 'vitest';
import { consentSentences, needsHash } from './needs-consent';

const files = { 'repo.files': ['README.md', 'docs/**/*.md'] } as const;
const tree = { 'repo.tree': ['**/*'] } as const;
const metrics = {
  'fieldnote.metrics': { windowDays: 30, minMergedPullRequests: 10, insufficientReason: 'Quiet.' },
} as const;

test('the same needs hash the same however the keys were ordered', () => {
  expect(needsHash({ ...files, ...tree })).toBe(needsHash({ ...tree, ...files }));
});

test('a widened need hashes differently', () => {
  expect(needsHash({ 'repo.files': ['README.md'] })).not.toBe(needsHash(files));
  expect(needsHash(files)).not.toBe(needsHash({ ...files, ...tree }));
});

test('every declared family produces one sentence, in a fixed order', () => {
  expect(consentSentences({ ...files, ...tree, ...metrics })).toEqual([
    'The contents of files matching README.md, docs/**/*.md',
    'The list of file names in your repositories',
    'Your merged pull request and CI record over 30 days',
  ]);
  expect(consentSentences(tree)).toEqual(['The list of file names in your repositories']);
});
```

- [ ] **Step 2: Run it to see it fail, then implement**

Run: `pnpm vitest run src/domain/grading/needs-consent.test.ts` → FAIL (module missing).

Create `src/domain/grading/needs-consent.ts`:

```ts
import { manifestHash } from './manifest-hash';
import type { GraderManifest } from './manifest';

/**
 * What a workspace agreed a grader may read. The canonical manifest hash, so
 * key order cannot make the same permission look like a different one — and so
 * widening a pattern, adding a family or lengthening a window always does.
 */
export function needsHash(needs: GraderManifest['needs']): string {
  return manifestHash(needs);
}

/**
 * The consent screen's sentences, generated from the declaration rather than
 * written per grader: an author cannot describe their own permissions, and a
 * family added to the schema without a sentence here is a compile error.
 */
export function consentSentences(needs: GraderManifest['needs']): string[] {
  const sentences: string[] = [];
  const files = needs['repo.files'];
  if (files) sentences.push(`The contents of files matching ${files.join(', ')}`);
  if (needs['repo.tree']) sentences.push('The list of file names in your repositories');
  const metrics = needs['fieldnote.metrics'];
  if (metrics)
    sentences.push(
      `Your merged pull request and CI record over ${metrics.windowDays} days`,
    );
  return sentences;
}
```

Run again: PASS.

- [ ] **Step 3: Write the failing integration test for resolution and seeding**

Create `src/db/graders.integration.test.ts`. Copy the fixture scaffolding (`migrate`, a user, a workspace, `afterAll` cleanup) from `src/db/public-grades.integration.test.ts`, then:

```ts
test('seeding publishes every built-in as an ordinary verified row owned by nobody', async () => {
  await seedBuiltInGraders();
  for (const manifest of builtInManifests()) {
    const resolved = await graderVersion(manifest.id, manifest.version);
    expect(resolved).toEqual(manifest);
    const [row] = await db().select().from(graderVersions).where(
      and(eq(graderVersions.graderId, manifest.id), eq(graderVersions.version, manifest.version)),
    );
    expect(row.verifiedAt).toBeInstanceOf(Date);
    expect(row.publishedBy).toBeNull();
    const [grader] = await db().select().from(graders).where(eq(graders.id, manifest.id));
    expect(grader.ownedByWorkspaceId).toBeNull();
  }
});

test('seeding twice changes nothing', async () => {
  await seedBuiltInGraders();
  await seedBuiltInGraders();
  const rows = await db().select().from(graderVersions);
  expect(rows).toHaveLength(builtInManifests().length);
});

test('a workspace with the built-ins installed resolves them, pinned', async () => {
  await seedBuiltInGraders();
  await installBuiltIns(workspace);
  const installed = await installedGraders(workspace);
  expect(installed.map((entry) => entry.manifest.id).sort()).toEqual(
    builtInManifests().map((manifest) => manifest.id).sort(),
  );
  const readiness = await installedGrader(workspace, AGENT_READINESS);
  expect(readiness?.version).toBe(agentReadinessManifest.version);
  expect(readiness?.consentedNeeds).toBe(needsHash(agentReadinessManifest.needs));
});

test('an uninstalled grader resolves as null for a workspace but still by version', async () => {
  await seedBuiltInGraders();
  expect(await installedGrader(workspace, AGENT_READINESS)).toBeNull();
  expect(await graderVersion(AGENT_READINESS, agentReadinessManifest.version)).toEqual(
    agentReadinessManifest,
  );
});

test('an unknown grader or version resolves as null rather than throwing', async () => {
  expect(await graderVersion('nobody/nothing', '0.1.0')).toBeNull();
  expect(await graderVersion(AGENT_READINESS, '9.9.9')).toBeNull();
});
```

- [ ] **Step 4: Implement the registry seed list and the queries**

In `src/domain/grading/registry.ts`, delete `getGrader`, `listGraders`, `graderCheckTitles` and the module-level map, and leave:

```ts
import { parseManifest, type GraderManifest } from './manifest';
import { AGENT_READINESS_MANIFEST } from './graders/agent-readiness';
import { DELIVERY_HEALTH_MANIFEST } from './graders/delivery-health';
import { TEST_DISCIPLINE_MANIFEST } from './graders/test-discipline';

/**
 * fieldnote's own graders, as code. They are where a built-in is written,
 * reviewed and tested — and from slice 6 they are a *seed*: seedBuiltInGraders()
 * publishes them into the registry, where they are ordinary rows resolved by
 * the same query a stranger's grader is. Nothing else reads this list.
 */
export function builtInManifests(): GraderManifest[] {
  return [AGENT_READINESS_MANIFEST, DELIVERY_HEALTH_MANIFEST, TEST_DISCIPLINE_MANIFEST];
}

export { parseManifest };
```

Each grader module currently calls `registerGrader(...)` and exports the result. Change each to `export const AGENT_READINESS_MANIFEST = parseManifest({ … })` (same object, same name for the id constant), and update `src/domain/grading/graders/index.ts` to re-export the three manifests. The barrel's side-effect role is over: delete the `import '../../domain/grading/graders';` lines in `src/db/queries/grade-runs.ts` and `src/db/queries/grade-schedules.ts` **and the comments explaining them**, because registration no longer happens at import.

Create `src/db/queries/graders.ts` with `graderVersion`, `installedGrader`, `installedGraders`, `browsableGraders`, `seedBuiltInGraders`, `installBuiltIns`. Shape:

```ts
export async function graderVersion(graderId: string, version: string): Promise<GraderManifest | null> {
  const [row] = await db()
    .select({ manifest: graderVersions.manifest })
    .from(graderVersions)
    .where(and(eq(graderVersions.graderId, graderId), eq(graderVersions.version, version)));
  // A stored manifest was validated before it was written, and is re-validated
  // here rather than trusted: a row edited by hand must not reach the engine.
  return row ? parseManifest(row.manifest) : null;
}
```

`installedGrader`/`installedGraders` join `graderInstalls` to `graderVersions` on the pinned version and also select the grader's newest non-withdrawn version as `latestVersion` (a correlated subquery or a second query keyed by grader id — either is fine, say which you chose). `browsableGraders(workspaceId)` lists the newest non-withdrawn version of every grader, verified first then by published date, each with its install if the workspace has one, and the author (`graders.ownedByWorkspaceId`'s handle, or `fieldnote` when null).

`seedBuiltInGraders()` inserts each built-in's `graders` row and `grader_versions` row with `onConflictDoNothing`, `verifiedAt: new Date()`, `publishedBy: null`. `installBuiltIns(workspaceId)` inserts a `grader_installs` row per built-in with the pinned version and `consentedNeeds: needsHash(manifest.needs)`, `installedBy` — there is no user for a seed, so make `grader_installs.installed_by` nullable in Task 1's schema if it is not already, or pass the workspace's owner; **choose one, say which, and keep it consistent**.

Call `seedBuiltInGraders()` at the end of `scripts/migrate.ts`, and `installBuiltIns(workspace.id)` inside `ensureDefaultWorkspace`'s transaction and in `createWorkspace` (`src/workspaces/store.ts`).

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/domain/grading/needs-consent.test.ts` and
`DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/graders.integration.test.ts`
Expected: PASS. `pnpm typecheck` still fails in the call sites Tasks 3–5 move.

- [ ] **Step 6: Commit**

```bash
git add src/domain/grading/needs-consent.ts src/domain/grading/needs-consent.test.ts src/domain/grading/registry.ts src/domain/grading/graders src/db/queries/graders.ts src/db/graders.integration.test.ts src/workspaces/store.ts scripts/migrate.ts
git commit -m "feat(grading): a grader is a row, and the built-ins are its seed

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The run path resolves versions

**Files:**
- Modify: `src/db/queries/grade-runs.ts`
- Test: `src/db/grade-runs.integration.test.ts`, `src/db/queries/grade-runs.registration.test.ts`

**Interfaces:**
- Consumes: `graderVersion`, `installedGrader` (Task 2).
- Produces:
  - `pinnedManifest(graderId: string, version: string): Promise<GraderManifest>` — throws `Error('Unsupported rubric version')` when the version is gone or no longer matches the run
  - `requestGrade` and `scheduleGrade` unchanged in signature; both now resolve the **installed** version and pin it
  - `registerRubric` is deleted

- [ ] **Step 1: Rewrite the rubric functions**

Replace `registerRubric` with:

```ts
/**
 * The manifest a run is pinned to. grader_versions is immutable, so this is a
 * read: a run that was queued against a version resolves that version, and a
 * version that has since been withdrawn still resolves — a withdrawal stops new
 * installs, it does not rewrite history.
 */
export async function pinnedManifest(graderId: string, version: string): Promise<GraderManifest> {
  const manifest = await graderVersion(graderId, version);
  if (!manifest) throw new Error('Unsupported rubric version');
  return manifest;
}
```

`validateGradeRun` keeps every check it makes today except that its manifest now comes from `pinnedManifest(run.graderId, run.rubricVersion)`, and the `gradingRubrics` lookup and the two hash comparisons against it are gone — the pinned row *is* the rubric. Keep `run.evaluatorVersion !== manifest.evaluatorVersion` and the availability join exactly as they are. Keep the thrown message `'Unsupported rubric version'`, which the worker's copy is keyed to.

`requestGrade` resolves the workspace's install:

```ts
  const workspace = await requireWorkspace();
  …
  const installed = await installedGrader(workspace.id, graderId);
  if (!installed) throw new ManifestError('unknown_grader', `No grader '${graderId}' is installed.`);
  return insertGradeRun({ … manifest: installed.manifest … });
```

`scheduleGrade` does the same with `input.workspaceId`. Both drop their `registerRubric` call: `insertGradeRun` already stores `rubricVersion` from the manifest it is handed.

- [ ] **Step 2: Move the tests**

In `src/db/grade-runs.integration.test.ts`: replace every `registerRubric(...)` with a seeded registry — call `seedBuiltInGraders()` and `installBuiltIns(workspace)` in `beforeAll`, and where a test needed a *different* stored definition (the "a version still freezes a threshold" and "card drift" tests), publish a fixture version directly into `grader_versions` with the manifest that test wants. Keep every assertion: those tests exist to prove a changed rubric cannot complete a run, and that must still be what they prove.

`src/db/queries/grade-runs.registration.test.ts` tested that importing `grade-runs.ts` registers the built-ins through the barrel. Registration no longer happens at import, so that test's premise is gone: replace the file with one that proves the new equivalent — `requestGrade` refuses a grader the workspace has not installed, by id, without touching the database's grade tables.

- [ ] **Step 3: Run**

Run: `pnpm vitest run src/db && pnpm typecheck` (typecheck still fails in Tasks 4–5's files), then
`DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/grade-runs.integration.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/db/queries/grade-runs.ts src/db/grade-runs.integration.test.ts src/db/queries/grade-runs.registration.test.ts
git commit -m "feat(grading): a run pins the version its workspace installed

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The workers resolve versions

**Files:**
- Modify: `src/inngest/functions/grade-repository.ts`, `src/inngest/functions/schedule-grades.ts`
- Test: their existing test files

**Interfaces:**
- Consumes: `pinnedManifest` (Task 3), `installedGrader` (Task 2).
- Produces: no new exports; `evaluateGradeRun` resolves `pinnedManifest(run.graderId, run.rubricVersion)`; `scheduleIfDue` resolves `installedGrader(row.workspaceId, row.graderId)` and skips when there is none.

- [ ] **Step 1: Change the worker**

In `grade-repository.ts`, `const manifest = getGrader(run.graderId)` becomes `const manifest = await pinnedManifest(run.graderId, run.rubricVersion);`. It sits inside the existing `try`, so a missing version already becomes `collectionFailure`'s generic path — check that: `'Unsupported rubric version'` is not a `FileCollectionError`, so it is rethrown as a generic error and retried, and `onFailure` records `collection_failed`. That is the behaviour today when `getGrader` throws; keep it.

In `schedule-grades.ts`, replace the `getGrader` try/catch with:

```ts
  const installed = await installedGrader(row.workspaceId, row.graderId);
  // A schedule for a grader this workspace has uninstalled is inert, not fatal.
  if (!installed) return null;
  const manifest = installed.manifest;
```

Everything after it — the sandbox check, the active-run check, `changesOverTime`, the skip and `confirmGrade` — is unchanged.

- [ ] **Step 2: Move the tests**

Both test files mock the registry today. Point the mocks at the new modules: `vi.mock('../../db/queries/graders', …)` returning `installedGrader`, and `vi.mock('../../db/queries/grade-runs', …)` gaining `pinnedManifest`. Keep every existing case and assertion. Add one per file:

```ts
test('a grader the workspace no longer has installed is skipped, and its row survives', async () => {
  graders.installedGrader.mockResolvedValue(null);
  expect(await scheduleIfDue(readinessRow)).toBeNull();
  expect(runs.scheduleGrade).not.toHaveBeenCalled();
});
```

```ts
test('a run whose pinned version is gone fails rather than grading against another', async () => {
  queries.pinnedManifest.mockRejectedValue(new Error('Unsupported rubric version'));
  await expect(evaluateGradeRun('run-1')).rejects.toThrow();
  expect(queries.completeGrade).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run and commit**

Run: `pnpm vitest run src/inngest && pnpm typecheck`

```bash
git add src/inngest/functions/grade-repository.ts src/inngest/functions/grade-repository.test.ts src/inngest/functions/schedule-grades.ts src/inngest/functions/schedule-grades.test.ts
git commit -m "feat(grading): the workers resolve a version, not a registry

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The read paths resolve versions

**Files:**
- Modify: `src/db/queries/public-grades.ts`, `src/db/queries/public-grade-settings.ts`, `src/db/queries/grade-schedules.ts`, `src/components/grading/grade-presentation.ts`, `src/app/app/repos/[repoId]/grading/page.tsx`
- Test: those files' existing tests

**Interfaces:**
- Consumes: `graderVersion`, `installedGrader`, `installedGraders` (Task 2).
- Produces: `gradeCardProps({ …, grader: GraderManifest })` — the seam takes a manifest instead of resolving one; the grading page renders `installedGraders(workspace.id)`.

- [ ] **Step 1: The public lookup resolves the graded version**

In `public-grades.ts`, the grader is currently resolved by id from the registry. It must now resolve **the version the shown grade was computed with** — which is why the run query moves above it:

```ts
  // … after the repository/sharing match, and after the run query:
  if (!run?.result || !run.sha || !run.completedAt) {
    // Nothing scored: fall back to the newest published version for identity.
    const manifest = await latestPublishedVersion(graderId);
    return manifest ? { state: 'ungraded', repository, grader: publicGrader(manifest) } : PRIVATE;
  }
  const manifest = await graderVersion(graderId, run.result.rubricVersion);
  if (!manifest) return PRIVATE;
```

Add `latestPublishedVersion(graderId)` to `src/db/queries/graders.ts` (newest non-withdrawn version, or null). The module must still import nothing session-bound — `graders.ts` is a plain query module, so the imports test keeps passing; run it.

- [ ] **Step 2: The two settings writers check the install, not the registry**

`public-grade-settings.ts`'s `writePublicGrade` and `grade-schedules.ts`'s `writeGradeSchedule` each start with `getGrader(graderId)` to refuse an unknown grader. Both now read `installedGrader(workspace.id, graderId)` **after** resolving the workspace they already resolve, and throw `new ManifestError('unknown_grader', …)` when it is null. A workspace cannot schedule or share a grader it has not installed.

- [ ] **Step 3: The card seam takes a manifest**

In `grade-presentation.ts`, `gradeCardProps` gains `grader: GraderManifest` in its input and drops `graderId` plus both registry calls; `nextTier`'s check titles come from `Object.fromEntries(grader.checks.map((check) => [check.id, check.title]))`. Its test builds the manifest it already imports and passes it.

- [ ] **Step 4: The grading page renders installed graders**

In the page: `const [workspace, …] = await Promise.all([requireWorkspace(), …])` already exists from slice 5; add `installedGraders(workspace.id)`. `graders` becomes those entries' manifests; the selected grader is the installed entry whose id matches `?grader=`, defaulting to the readiness one **if it is installed** and otherwise the first entry; a `?grader=` that is not installed is a 404, as an unregistered one is today. `checkTitles` comes from the selected manifest. If nothing is installed, render one Surface: "No graders installed. A workspace owner can install one from workspace settings." with a link to `/app/settings/graders`.

- [ ] **Step 5: Run every touched suite**

Run: `pnpm vitest run src/db src/components/grading "src/app/app/repos/[repoId]/grading" src/app/r && pnpm typecheck && pnpm lint && pnpm build`
Then: `DEMO_MODE=false pnpm test:integration`
Expected: PASS, apart from the 2 known `dispatch-import` failures. **Every pre-existing assertion must survive**; where a test seeded no registry it now seeds one.

- [ ] **Step 6: Commit**

```bash
git add src/db/queries/public-grades.ts src/db/queries/public-grade-settings.ts src/db/queries/grade-schedules.ts src/db/queries/graders.ts src/components/grading/grade-presentation.ts src/components/grading/grade-presentation.test.ts "src/app/app/repos/[repoId]/grading/page.tsx" "src/app/app/repos/[repoId]/grading/page.test.ts" src/db/public-grades.integration.test.ts
git commit -m "feat(grading): every reader resolves the version it means

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Consent, enforced where the evidence is collected

**Files:**
- Modify: `src/grading/evidence.ts`, `src/inngest/functions/grade-repository.ts`, `src/db/queries/grade-runs.ts` (`failGrade` whitelist), `src/components/grading/report.tsx`
- Test: `src/grading/evidence.test.ts`, `src/inngest/functions/grade-repository.test.ts`, `src/components/grading/report.test.ts`

**Interfaces:**
- Consumes: `needsHash` (Task 2), `installedGrader` (Task 2).
- Produces: `collectEvidence(manifest, repositoryId, sha, requestedAt, consentedNeeds: string)` — throws `ConsentError` when `needsHash(manifest.needs) !== consentedNeeds`; error code `consent_required` on `failGrade`'s whitelist.

- [ ] **Step 1: Write the failing tests**

In `src/grading/evidence.test.ts`:

```ts
test('a grader asking for more than the workspace agreed collects nothing', async () => {
  await expect(
    collectEvidence(agentReadinessManifest, 'repo', 'abc', new Date(), 'a-hash-of-something-else'),
  ).rejects.toBeInstanceOf(ConsentError);
  expect(collectFiles).not.toHaveBeenCalled();
  expect(collectTree).not.toHaveBeenCalled();
  expect(collectMetrics).not.toHaveBeenCalled();
});

test('the consent it was given is the hash of the needs it declares', async () => {
  collectFiles.mockResolvedValue({ sha: 'abc', complete: true, documents: [] });
  await expect(
    collectEvidence(agentReadinessManifest, 'repo', 'abc', new Date(), needsHash(agentReadinessManifest.needs)),
  ).resolves.toBeTruthy();
});
```

In `src/inngest/functions/grade-repository.test.ts`:

```ts
test('a run whose workspace never consented to these needs fails as consent_required', async () => {
  queries.loadGradeRun.mockResolvedValue(run);
  graders.installedGrader.mockResolvedValue(null);
  await expect(evaluateGradeRun('run-1')).rejects.toBeInstanceOf(NonRetriableError);
  expect(queries.failGrade).toHaveBeenCalledWith('run-1', 'consent_required');
  expect(broker.collectEvidence).not.toHaveBeenCalled();
});
```

In `src/components/grading/report.test.ts`, the failure copy for `consent_required`:

```ts
const CONSENT_REQUIRED =
  'This grader now asks to read more than this workspace agreed to. A workspace owner can review it in settings.';
```

- [ ] **Step 2: Implement**

In `src/grading/evidence.ts`:

```ts
/** The workspace agreed to one set of needs; this manifest declares another. */
export class ConsentError extends Error {
  constructor() {
    super('The grader asks for evidence this workspace has not agreed to.');
    this.name = 'ConsentError';
  }
}
```

and, as the **first** thing `collectEvidence` does after the family check:

```ts
  // The one place that knows both the manifest's needs and the repository it is
  // about to read, which is why slice 3 put the check here and nowhere else.
  if (needsHash(manifest.needs) !== consentedNeeds) throw new ConsentError();
```

In `grade-repository.ts`'s `evaluateGradeRun`, resolve the install for the run's workspace and pass its `consentedNeeds`; when there is no install, fail `consent_required` without collecting:

```ts
    const manifest = await pinnedManifest(run.graderId, run.rubricVersion);
    const installed = await installedGrader(run.requestedWorkspaceId, run.graderId);
    if (!installed) {
      await failGrade(runId, 'consent_required');
      throw new NonRetriableError('Grader is not installed');
    }
    const collected = await collectEvidence(manifest, run.repositoryId, run.sha, run.createdAt, installed.consentedNeeds);
```

and map `ConsentError` in `collectionFailure` to `failGrade(runId, 'consent_required')` + `NonRetriableError`. Add `'consent_required'` to `failGrade`'s whitelist, and the copy above to the report's failure branch.

- [ ] **Step 3: Run and commit**

Run: `pnpm vitest run src/grading src/inngest src/components/grading && pnpm typecheck && pnpm lint`

```bash
git add src/grading/evidence.ts src/grading/evidence.test.ts src/inngest/functions/grade-repository.ts src/inngest/functions/grade-repository.test.ts src/db/queries/grade-runs.ts src/components/grading/report.tsx src/components/grading/report.test.ts
git commit -m "feat(grading): a run collects nothing a workspace did not agree to

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Claiming a handle

**Files:**
- Create: `src/db/queries/grader-publishing.ts`
- Modify: `src/app/app/settings/actions.ts`, `src/app/app/settings/workspace/page.tsx`
- Test: `src/db/grader-publishing.integration.test.ts` (create), `src/app/app/settings/actions.test.ts`

**Interfaces:**
- Produces: `claimHandle(handle: string): Promise<void>` (owner-only, once, reserved names refused) and the server action `saveWorkspaceHandle(form: FormData)`.

- [ ] **Step 1: Write the failing integration tests**

```ts
test('an owner claims a handle once, and it is theirs', async () => {
  await claimHandle('acme');
  const [row] = await db().select().from(workspaces).where(eq(workspaces.id, workspace));
  expect(row.handle).toBe('acme');
});
test('a handle cannot be changed once claimed', async () => {
  await claimHandle('acme');
  await expect(claimHandle('acme-two')).rejects.toThrow('Handle already claimed');
});
test('a handle another workspace holds is refused', async () => { /* second workspace claims 'acme' first */ });
test.each(['fieldnote', 'admin', 'api', 'app', 'r', 'www', 'support'])('%s is reserved', async (handle) => {
  await expect(claimHandle(handle)).rejects.toThrow('Handle unavailable');
});
test.each(['Acme', 'a', '-acme', 'acme_two', 'a'.repeat(40)])('%s is not a handle', async (handle) => {
  await expect(claimHandle(handle)).rejects.toThrow('Invalid handle');
});
test('a member cannot claim a handle', async () => { /* context.user = member */ });
```

- [ ] **Step 2: Implement**

`claimHandle` requires `requireWorkspace(undefined, 'owner')`, validates against `/^[a-z0-9][a-z0-9-]{1,38}$/` and the reserved list, refuses when the workspace already has one, and inserts — relying on the unique index for the race, mapping a unique violation to `Error('Handle unavailable')`.

Add `saveWorkspaceHandle` to the settings actions using the file's existing `save()` wrapper and message map (add the three new messages), and render the field on the workspace settings page inside a `SettingsForm`, shown only to owners, and read-only once claimed with the sentence "Your graders publish as `acme/…`. A handle cannot be changed."

- [ ] **Step 3: Run and commit**

Run: `pnpm vitest run src/app/app/settings && pnpm typecheck && pnpm lint`, plus the new integration file.

```bash
git add src/db/queries/grader-publishing.ts src/db/grader-publishing.integration.test.ts src/app/app/settings/actions.ts src/app/app/settings/actions.test.ts src/app/app/settings/workspace/page.tsx
git commit -m "feat(grading): a workspace claims the name it publishes under

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Publishing a version

**Files:**
- Modify: `src/db/queries/grader-publishing.ts`
- Create: `src/app/app/settings/graders/page.tsx`, `src/app/app/settings/graders/actions.ts`
- Test: `src/db/grader-publishing.integration.test.ts`, `src/app/app/settings/graders/page.test.ts`

**Interfaces:**
- Produces: `publishGrader(manifestJson: string): Promise<GraderManifest>` and `withdrawVersion(graderId, version, note)`; the server action `publishGraderVersion(form: FormData)`.

- [ ] **Step 1: Write the failing tests** — one per refusal, each asserting nothing was written:

```ts
test('an owner publishes a declarative grader under their own handle', …);        // accepted, unverified
test('a manifest whose id is not under this handle is refused', …);               // 'Wrong namespace'
test('a workspace with no handle cannot publish', …);                             // 'Claim a handle first'
test('a member cannot publish', …);
test('a kind: code manifest is refused while the licence question is open', …);   // 'Code graders cannot be published yet'
test('a version that already exists is refused, and the stored one is untouched', …);
test('a grader id another workspace owns is refused', …);
test('a manifest that fails parseManifest is refused with its own code', …);      // ManifestError
test('a published version is listed for browsing, marked unreviewed', …);
test('withdrawing hides it from browsing and keeps it resolvable by version', …);
```

- [ ] **Step 2: Implement `publishGrader`**

Owner-only; `parseManifest(JSON.parse(manifestJson))` (a parse failure is `ManifestError('schema', …)`); refuse `kind === 'code'`; require the workspace handle and that `manifest.id.split('/')[0] === handle`; insert the `graders` row `onConflictDoNothing` then verify its `ownedByWorkspaceId` is this workspace; insert the `grader_versions` row and map a primary-key violation to `Error('Version already published')`.

`withdrawVersion` sets `withdrawnAt`/`withdrawnNote` for a version this workspace owns.

- [ ] **Step 3: The page**

`/app/settings/graders` gains a "Publish a grader" section for owners with a handle: a textarea for the manifest, the errors rendered above it, and a list of this workspace's published graders with each version's state (verified / not reviewed / withdrawn) and a withdraw form. Follow the settings pages' existing `SettingsForm` + `save()` shape.

- [ ] **Step 4: Run and commit**

```bash
git add src/db/queries/grader-publishing.ts src/db/grader-publishing.integration.test.ts "src/app/app/settings/graders" 
git commit -m "feat(grading): a workspace publishes a grader other teams can install

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Browsing, consent and installing

**Files:**
- Create: `src/db/queries/grader-installs.ts`, `src/components/grading/consent.tsx`
- Modify: `src/app/app/settings/graders/page.tsx`, `src/app/app/settings/graders/actions.ts`
- Test: `src/db/grader-installs.integration.test.ts` (create), `src/components/grading/consent.test.ts` (create)

**Interfaces:**
- Consumes: `browsableGraders`, `needsHash`, `consentSentences`.
- Produces: `installGrader(graderId: string, version: string): Promise<void>` (owner-only, records the consented hash), `consentFor(graderId, version)` for the screen; `<ConsentScreen grader={manifest} action={…} />`.

- [ ] **Step 1: The consent component test**

```ts
test('the screen lists one sentence per declared family, generated from needs', () => {
  const html = renderToStaticMarkup(createElement(ConsentScreen, { manifest: agentReadinessManifest, … }));
  expect(html).toContain('The contents of files matching README.md');
  expect(html).not.toContain('file names');       // readiness declares no repo.tree
});
test('it names the grader, its author and its version, and says nothing else is collected', …);
```

- [ ] **Step 2: The install tests**

```ts
test('installing pins the version and records the needs the workspace agreed to', …);
test('installing twice is idempotent and keeps the first consent', …);
test('a member cannot install', …);
test('a withdrawn version cannot be newly installed', …);
test('an unverified version can be installed, and the row records no verification', …);
```

- [ ] **Step 3: Implement**

`installGrader` is owner-only, refuses a withdrawn or unknown version, and inserts `{ workspaceId, graderId, version, installedBy, consentedNeeds: needsHash(manifest.needs) }` with `onConflictDoNothing`. The browse page lists `browsableGraders(workspace.id)`; an entry that is not installed renders an "Install" button that reveals the consent screen (a `?install=<id>@<version>` query on the same page, so there is no client state to lose), and the confirm button runs the action.

- [ ] **Step 4: Run and commit**

```bash
git add src/db/queries/grader-installs.ts src/db/grader-installs.integration.test.ts src/components/grading/consent.tsx src/components/grading/consent.test.ts "src/app/app/settings/graders"
git commit -m "feat(grading): installing a grader asks first, in the grader's own words

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Updating and uninstalling

**Files:**
- Modify: `src/db/queries/grader-installs.ts`, `src/app/app/settings/graders/page.tsx`, `src/app/app/settings/graders/actions.ts`
- Test: `src/db/grader-installs.integration.test.ts`

**Interfaces:**
- Produces: `updateInstall(graderId: string, version: string)` (re-consents when `needs` changed) and `uninstallGrader(graderId: string)`.

- [ ] **Step 1: Write the failing tests**

```ts
test('an update whose needs are unchanged re-pins without a new consent', …);
test('an update that widens needs requires the new consent, and stores it', …);
test('uninstalling removes this workspace nightly schedules and sharing for that grader', …);
test('uninstalling leaves another workspace rows for the same repository alone', …);
test('uninstalling leaves grade history intact', …);
test('a member cannot update or uninstall', …);
```

The cleanup test needs two workspaces both connected to one repository, each with its own schedule and sharing row — build them from the integration file's fixtures.

- [ ] **Step 2: Implement**

`updateInstall` refuses a withdrawn version, and when `needsHash(newManifest.needs) !== install.consentedNeeds` requires the caller to have passed through the consent screen (the action re-routes to `?install=…` in that case); it writes the new version and the new hash together.

`uninstallGrader` deletes, in one transaction: the `grader_installs` row; `grade_schedules` rows for that grader **whose `workspace_id` is this workspace**; `public_grades` rows for that grader whose `workspace_id` is this workspace. It never touches `grade_runs`.

The page shows "Update available" beside an installed grader with a newer version, and an "Uninstall" form with a confirmation sentence naming what goes with it.

- [ ] **Step 3: Run and commit**

```bash
git add src/db/queries/grader-installs.ts src/db/grader-installs.integration.test.ts "src/app/app/settings/graders"
git commit -m "feat(grading): updating asks again when a grader wants more, and uninstalling clears up

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: The review queue

**Files:**
- Create: `src/app/app/admin/graders/page.tsx`, `src/app/app/admin/graders/actions.ts`, `src/workspaces/staff.ts`
- Modify: `src/db/queries/grader-publishing.ts`
- Test: `src/app/app/admin/graders/page.test.ts` (create), `src/db/grader-publishing.integration.test.ts`

**Interfaces:**
- Produces: `requireStaff(): Promise<{ id: string }>` in `src/workspaces/staff.ts` (404 for everyone else, like `requireWorkspace`); `reviewQueue()`, `verifyVersion(graderId, version)` in `grader-publishing.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
test('a signed-in non-staff user gets a 404, not a hint that the page exists', …);
test('staff see every unreviewed version, newest first, with its manifest', …);
test('verifying records the reviewer and the date, and the card says read by fieldnote', …);
test('withdrawing from the queue takes it out of browsing and notes why', …);
test('a verified version stays verified when a newer version is published unreviewed', …);
```

- [ ] **Step 2: Implement**

`requireStaff` reads `users.staff` for the current user and calls `notFound()` otherwise. The page renders each queued version's manifest — checks, points, `needs` (through `consentSentences`), card prose — with "Mark verified" and "Withdraw with a note" forms. `verifyVersion` is staff-only and sets `verifiedAt`/`verifiedBy`.

Render the state wherever a grader is named: the browse list, the install screen, and the grade card's identity strip — "Read by fieldnote on 15 September 2026", "Not reviewed", or "Withdrawn".

- [ ] **Step 3: Run and commit**

```bash
git add src/workspaces/staff.ts "src/app/app/admin" src/db/queries/grader-publishing.ts src/db/grader-publishing.integration.test.ts
git commit -m "feat(grading): a person reads a grader before it wears the mark

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: The whole path, end to end

**Files:**
- Modify: `scripts/seed.ts`, `src/demo/fixtures.ts` (only if the seed needs the registry rows)
- Test: `src/db/grader-lifecycle.integration.test.ts` (create)

- [ ] **Step 1: Write the test**

One integration test that walks the slice: a second workspace claims `acme`, publishes `acme/test-coverage` (declarative, reading `repo.files`), staff verify it, the first workspace installs it after consent, a grade runs and completes against the pinned version, `acme` publishes a version that widens `needs`, the installed workspace's runs keep working on the pinned version, updating requires the new consent, and uninstalling clears the schedule and sharing rows it created while leaving the grade history and the other workspace's rows alone.

- [ ] **Step 2: Fix the seed**

`scripts/seed.ts` inserts `gradingRubrics` rows for the three built-ins. Replace those with `seedBuiltInGraders()` and `installBuiltIns('demo-workspace')` so the demo renders its three cards.

- [ ] **Step 3: Run the whole gate**

```bash
pnpm lint && pnpm typecheck && pnpm test && DEMO_MODE=false pnpm test:integration && pnpm build
```

Expected: green apart from the 2 known `dispatch-import` failures. `git diff main -- src/domain/grading/readiness-v01.test.ts` must be empty.

- [ ] **Step 4: Commit**

```bash
git add src/db/grader-lifecycle.integration.test.ts scripts/seed.ts src/demo/fixtures.ts
git commit -m "test(grading): publish, verify, install, grade, update, uninstall

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Final gate

`pnpm lint && pnpm typecheck && pnpm test && DEMO_MODE=false pnpm test:integration && pnpm build`, the readiness diff empty, and `pnpm vitest run src/domain/grading/graders/frozen-rubrics.test.ts` passing — the built-ins' manifests must not have moved while becoming rows.
