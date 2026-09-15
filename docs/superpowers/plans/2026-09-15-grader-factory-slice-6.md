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
    // Nullable: a seeded install of a built-in has no user behind it.
    installedBy: text('installed_by').references(() => users.id),
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
    - `latestPublishedVersion(graderId: string): Promise<GraderManifest | null>` — the newest version with no `withdrawn_at`
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

`seedBuiltInGraders()` inserts each built-in's `graders` row and `grader_versions` row with `onConflictDoNothing`, `verifiedAt: new Date()`, `publishedBy: null`. `installBuiltIns(workspaceId)` inserts a `grader_installs` row per built-in with the pinned version and `consentedNeeds: needsHash(manifest.needs)`, `installedBy: null` — the column is nullable for exactly this case, and a seeded install has no user behind it.

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
- Consumes: `requireWorkspace(undefined, 'owner')` from `src/workspaces/access.ts`; `currentUser()` from `src/auth/session.ts`.
- Produces:
  - `RESERVED_HANDLES: readonly string[]` and `claimHandle(handle: string): Promise<void>` in `src/db/queries/grader-publishing.ts`
  - the server action `saveWorkspaceHandle(form: FormData): Promise<{ error?: string }>`

- [ ] **Step 1: Write the failing integration tests**

Create `src/db/grader-publishing.integration.test.ts`. Copy the harness from `src/db/public-grades.integration.test.ts` verbatim — the `context` hoisted object, the four `vi.mock`s (`../auth/session`, `next/headers`, `next/navigation`, `../lib/env`), `beforeAll` creating an owner, a second owner and a member in one workspace, and an `afterAll` that deletes memberships, workspaces and users by id. Then add a second workspace (`otherWorkspace`, owned by `secondOwner`) and:

```ts
import { claimHandle } from './queries/grader-publishing';
import { workspaces } from './schema';

beforeEach(async () => {
  context.user = owner;
  context.workspace = workspace;
  context.demo = false;
  await db().update(workspaces).set({ handle: null }).where(eq(workspaces.id, workspace));
  await db().update(workspaces).set({ handle: null }).where(eq(workspaces.id, otherWorkspace));
});

test('an owner claims a handle once, and it is theirs', async () => {
  await claimHandle('acme');
  const [row] = await db().select().from(workspaces).where(eq(workspaces.id, workspace));
  expect(row.handle).toBe('acme');
});

test('a handle cannot be changed once claimed', async () => {
  await claimHandle('acme');
  await expect(claimHandle('acme-two')).rejects.toThrow('Handle already claimed');
  const [row] = await db().select().from(workspaces).where(eq(workspaces.id, workspace));
  expect(row.handle).toBe('acme');
});

test('a handle another workspace holds is refused', async () => {
  context.user = secondOwner;
  context.workspace = otherWorkspace;
  await claimHandle('acme');
  context.user = owner;
  context.workspace = workspace;
  await expect(claimHandle('acme')).rejects.toThrow('Handle unavailable');
  const [row] = await db().select().from(workspaces).where(eq(workspaces.id, workspace));
  expect(row.handle).toBeNull();
});

test.each(['fieldnote', 'admin', 'api', 'app', 'r', 'www', 'support'])(
  '%s is reserved',
  async (handle) => {
    await expect(claimHandle(handle)).rejects.toThrow('Handle unavailable');
  },
);

test.each(['Acme', 'a', '-acme', 'acme_two', 'acme!', 'a'.repeat(40)])(
  '%s is not a handle',
  async (handle) => {
    await expect(claimHandle(handle)).rejects.toThrow('Invalid handle');
  },
);

test('a member cannot claim a handle', async () => {
  context.user = member;
  await expect(claimHandle('acme')).rejects.toThrow('not found');
  const [row] = await db().select().from(workspaces).where(eq(workspaces.id, workspace));
  expect(row.handle).toBeNull();
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/grader-publishing.integration.test.ts`
Expected: FAIL — `./queries/grader-publishing` does not exist.

- [ ] **Step 3: Implement**

Create `src/db/queries/grader-publishing.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../index';
import { workspaces } from '../schema';
import { requireWorkspace } from '../../workspaces/access';

// A handle becomes the owner segment of every grader id this workspace
// publishes, so these are the names a URL, a route or fieldnote itself needs.
export const RESERVED_HANDLES = ['fieldnote', 'admin', 'api', 'app', 'r', 'www', 'support'] as const;
const HANDLE = /^[a-z0-9][a-z0-9-]{1,38}$/;

/**
 * Claim the name this workspace publishes under. Owners only, once and never
 * again: published grader ids contain the handle, and other workspaces' installs
 * point at those ids, so a rename would orphan them.
 */
export async function claimHandle(handle: string): Promise<void> {
  const workspace = await requireWorkspace(undefined, 'owner');
  if (!HANDLE.test(handle)) throw new Error('Invalid handle');
  if ((RESERVED_HANDLES as readonly string[]).includes(handle))
    throw new Error('Handle unavailable');
  const [existing] = await db()
    .select({ handle: workspaces.handle })
    .from(workspaces)
    .where(eq(workspaces.id, workspace.id));
  if (existing?.handle) throw new Error('Handle already claimed');
  try {
    await db().update(workspaces).set({ handle }).where(eq(workspaces.id, workspace.id));
  } catch (error) {
    // The unique index is the race winner, not this read-then-write.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
      throw new Error('Handle unavailable');
    throw error;
  }
}
```

- [ ] **Step 4: Write the failing action test**

In `src/app/app/settings/actions.test.ts`, add `claimHandle: vi.fn()` to a new `vi.mock('../../../db/queries/grader-publishing', …)` and:

```ts
test('claiming a handle passes the submitted value and reports a taken one in words', async () => {
  const form = new FormData();
  form.set('handle', 'acme');
  vi.mocked(claimHandle).mockResolvedValue(undefined);
  expect(await saveWorkspaceHandle(form)).toEqual({});
  expect(claimHandle).toHaveBeenCalledWith('acme');

  vi.mocked(claimHandle).mockRejectedValue(new Error('Handle unavailable'));
  expect(await saveWorkspaceHandle(form)).toEqual({
    error: 'That handle is taken or reserved. Try another.',
  });
});
```

- [ ] **Step 5: Implement the action and the field**

In `src/app/app/settings/actions.ts`, add to the `messages` map inside `save()`:

```ts
      'Invalid handle': 'A handle is 2–39 characters: lowercase letters, numbers and dashes.',
      'Handle unavailable': 'That handle is taken or reserved. Try another.',
      'Handle already claimed': 'This workspace already has a handle, and it cannot be changed.',
```

and the action:

```ts
export async function saveWorkspaceHandle(form: FormData): Promise<Result> {
  return save(() => claimHandle(value(form, 'handle')));
}
```

In `src/app/app/settings/workspace/page.tsx`, read the workspace's handle alongside the members query and render, for owners only:

```tsx
      <Surface>
        <h2>Publishing handle</h2>
        {workspace.handle ? (
          <p>
            Your graders publish as <code>{workspace.handle}/…</code>. A handle cannot be changed.
          </p>
        ) : (
          <SettingsForm action={saveWorkspaceHandle} submitLabel="Claim handle">
            <p>
              Claim the name this workspace publishes graders under. Lowercase letters, numbers and
              dashes. It cannot be changed afterwards.
            </p>
            <label htmlFor="handle">Handle</label>
            <input id="handle" name="handle" required />
          </SettingsForm>
        )}
      </Surface>
```

`requireWorkspace()` returns `{ id, name, role }` today; add `handle` to what it selects and returns so the page needs no second query, and update its type in `src/workspaces/store.ts`.

- [ ] **Step 6: Run and commit**

Run: `pnpm vitest run src/app/app/settings && pnpm typecheck && pnpm lint`, then the integration file.

```bash
git add src/db/queries/grader-publishing.ts src/db/grader-publishing.integration.test.ts src/app/app/settings/actions.ts src/app/app/settings/actions.test.ts src/app/app/settings/workspace/page.tsx src/workspaces/access.ts src/workspaces/store.ts
git commit -m "feat(grading): a workspace claims the name it publishes under

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Publishing a version

**Files:**
- Modify: `src/db/queries/grader-publishing.ts`
- Create: `src/app/app/settings/graders/page.tsx`, `src/app/app/settings/graders/actions.ts`
- Test: `src/db/grader-publishing.integration.test.ts`, `src/app/app/settings/graders/page.test.ts` (create)

**Interfaces:**
- Consumes: `parseManifest` (`src/domain/grading/registry.ts`), `ManifestError` (`src/domain/grading/manifest.ts`), `graderVersion` (`src/db/queries/graders.ts`).
- Produces:
  - `publishGrader(manifestJson: string): Promise<GraderManifest>`
  - `withdrawVersion(graderId: string, version: string, note: string): Promise<void>`
  - `workspaceGraders(): Promise<PublishedVersion[]>` where `PublishedVersion = { graderId: string; version: string; title: string; publishedAt: Date; verifiedAt: Date | null; withdrawnAt: Date | null }`
  - the server actions `publishGraderVersion(form)` and `withdrawGraderVersion(form)`

- [ ] **Step 1: Write the failing tests**

Append to `src/db/grader-publishing.integration.test.ts` (the fixtures are already there):

```ts
const manifest = (over: Record<string, unknown> = {}) => ({
  id: 'acme/test-coverage',
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'test-discipline',
  kind: 'declarative',
  needs: { 'repo.files': ['README.md'] },
  disclaimer: 'Evidence, not certification.',
  card: { title: 'Test Coverage', tagline: 'Is it tested?', groups: [{ title: 'All', checks: ['readme'] }] },
  checks: [
    {
      id: 'readme',
      title: 'Project documentation',
      points: 100,
      explain: { pass: 'Found a README.', fail: 'No README.' },
      primitive: 'file-exists',
      args: { root: true, nonempty: true, anyOf: ['README.md'] },
    },
  ],
  ...over,
});
const publishedCount = async () => (await db().select().from(graderVersions)).length;

test('an owner publishes a declarative grader under their own handle, unreviewed', async () => {
  await claimHandle('acme');
  const published = await publishGrader(JSON.stringify(manifest()));
  expect(published.id).toBe('acme/test-coverage');
  const [row] = await db()
    .select()
    .from(graderVersions)
    .where(eq(graderVersions.graderId, 'acme/test-coverage'));
  expect(row.verifiedAt).toBeNull();
  expect(row.withdrawnAt).toBeNull();
  expect(row.publishedBy).toBe(owner);
  const [grader] = await db().select().from(graders).where(eq(graders.id, 'acme/test-coverage'));
  expect(grader.ownedByWorkspaceId).toBe(workspace);
});

test('a manifest whose id is not under this handle is refused', async () => {
  await claimHandle('acme');
  const before = await publishedCount();
  await expect(publishGrader(JSON.stringify(manifest({ id: 'other/thing' })))).rejects.toThrow(
    'Wrong namespace',
  );
  expect(await publishedCount()).toBe(before);
});

test('a workspace with no handle cannot publish', async () => {
  await expect(publishGrader(JSON.stringify(manifest()))).rejects.toThrow('Claim a handle first');
});

test('a member cannot publish', async () => {
  await claimHandle('acme');
  context.user = member;
  await expect(publishGrader(JSON.stringify(manifest()))).rejects.toThrow('not found');
});

test('a code grader is refused while the licence question is open', async () => {
  await claimHandle('acme');
  const code = manifest({
    kind: 'code',
    code: { source: 'export default () => ({ checks: [] });' },
    needs: { 'repo.tree': ['**/*'] },
    checks: [{ id: 'readme', title: 'T', points: 100, explain: { pass: 'Yes.', fail: 'No.' } }],
  });
  await expect(publishGrader(JSON.stringify(code))).rejects.toThrow(
    'Code graders cannot be published yet',
  );
});

test('a version that already exists is refused, and the stored one is untouched', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await expect(
    publishGrader(JSON.stringify(manifest({ disclaimer: 'Rewritten after the fact.' }))),
  ).rejects.toThrow('Version already published');
  const stored = await graderVersion('acme/test-coverage', '0.1.0');
  expect(stored?.disclaimer).toBe('Evidence, not certification.');
});

test('another workspace cannot reach this grader name, because it cannot hold the handle', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  context.user = secondOwner;
  context.workspace = otherWorkspace;
  // The namespace check is only as strong as the handle's uniqueness, so this
  // is where that is pinned: the second workspace cannot own `acme`, and
  // therefore cannot publish anything under `acme/`.
  await expect(claimHandle('acme')).rejects.toThrow('Handle unavailable');
  await claimHandle('other');
  await expect(publishGrader(JSON.stringify(manifest()))).rejects.toThrow('Wrong namespace');
});

test('a manifest that fails parseManifest is refused with its own error', async () => {
  await claimHandle('acme');
  await expect(
    publishGrader(JSON.stringify(manifest({ checks: [{ ...manifest().checks[0], points: 60 }] }))),
  ).rejects.toBeInstanceOf(ManifestError);
  await expect(publishGrader('not json')).rejects.toBeInstanceOf(ManifestError);
});

test('withdrawing hides a version from browsing and keeps it resolvable', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await withdrawVersion('acme/test-coverage', '0.1.0', 'Superseded.');
  const [row] = await db()
    .select()
    .from(graderVersions)
    .where(eq(graderVersions.graderId, 'acme/test-coverage'));
  expect(row.withdrawnAt).toBeInstanceOf(Date);
  expect(row.withdrawnNote).toBe('Superseded.');
  expect(await graderVersion('acme/test-coverage', '0.1.0')).not.toBeNull();
  expect(await latestPublishedVersion('acme/test-coverage')).toBeNull();
});
```

Note the "another workspace owns it" case: a second workspace cannot claim the same handle, which is what makes the grader id unreachable. Keep the assertion as written — it documents why the namespace check is enough.

- [ ] **Step 2: Run to see them fail, then implement**

Add to `src/db/queries/grader-publishing.ts`:

```ts
/**
 * Publish one version. Owners only, under this workspace's own handle, and
 * never over an existing (grader_id, version): installs point at a version and
 * grades are pinned to it, so a published version is immutable.
 */
export async function publishGrader(manifestJson: string): Promise<GraderManifest> {
  const workspace = await requireWorkspace(undefined, 'owner');
  const user = await currentUser();
  const [row] = await db()
    .select({ handle: workspaces.handle })
    .from(workspaces)
    .where(eq(workspaces.id, workspace.id));
  if (!row?.handle) throw new Error('Claim a handle first');
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestJson);
  } catch {
    throw new ManifestError('schema', 'That is not valid JSON.');
  }
  const manifest = parseManifest(parsed);
  // Open question 3 — whether a grader running inside fieldnote's sandbox is a
  // derived work of an AGPL application — is unanswered, so nothing that ships
  // code is published. fieldnote's own code grader is seeded, not published.
  if (manifest.kind === 'code') throw new Error('Code graders cannot be published yet');
  if (manifest.id.split('/')[0] !== row.handle) throw new Error('Wrong namespace');
  await db()
    .insert(graders)
    .values({ id: manifest.id, ownedByWorkspaceId: workspace.id })
    .onConflictDoNothing();
  const [grader] = await db().select().from(graders).where(eq(graders.id, manifest.id));
  if (grader.ownedByWorkspaceId !== workspace.id) throw new Error('Grader name taken');
  const inserted = await db()
    .insert(graderVersions)
    .values({
      graderId: manifest.id,
      version: manifest.version,
      evaluatorVersion: manifest.evaluatorVersion,
      manifest,
      publishedBy: user.id,
    })
    .onConflictDoNothing()
    .returning({ version: graderVersions.version });
  if (inserted.length === 0) throw new Error('Version already published');
  return manifest;
}

/** Take a version out of browsing. Whoever already installed it keeps running it. */
export async function withdrawVersion(
  graderId: string,
  version: string,
  note: string,
): Promise<void> {
  const workspace = await requireWorkspace(undefined, 'owner');
  const [grader] = await db().select().from(graders).where(eq(graders.id, graderId));
  if (!grader || grader.ownedByWorkspaceId !== workspace.id) throw new Error('Grader unavailable');
  await db()
    .update(graderVersions)
    .set({ withdrawnAt: new Date(), withdrawnNote: note })
    .where(and(eq(graderVersions.graderId, graderId), eq(graderVersions.version, version)));
}

/** Every version this workspace has published, newest first. */
export async function workspaceGraders(): Promise<PublishedVersion[]> {
  const workspace = await requireWorkspace();
  return db()
    .select({
      graderId: graderVersions.graderId,
      version: graderVersions.version,
      title: sql<string>`${graderVersions.manifest}->'card'->>'title'`,
      publishedAt: graderVersions.publishedAt,
      verifiedAt: graderVersions.verifiedAt,
      withdrawnAt: graderVersions.withdrawnAt,
    })
    .from(graderVersions)
    .innerJoin(graders, eq(graders.id, graderVersions.graderId))
    .where(eq(graders.ownedByWorkspaceId, workspace.id))
    .orderBy(desc(graderVersions.publishedAt));
}
```

- [ ] **Step 3: The page and its actions**

Create `src/app/app/settings/graders/actions.ts`:

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { ManifestError } from '../../../../domain/grading/manifest';
import { publishGrader, withdrawVersion } from '../../../../db/queries/grader-publishing';

type Result = { error?: string };
const value = (form: FormData, key: string) => String(form.get(key) ?? '');

async function save(operation: () => Promise<unknown>): Promise<Result> {
  try {
    await operation();
    revalidatePath('/', 'layout');
    return {};
  } catch (error) {
    unstable_rethrow(error);
    // A manifest error is the author's own words about their own file: show it.
    if (error instanceof ManifestError) return { error: `${error.code}: ${error.message}` };
    const messages: Record<string, string> = {
      'Claim a handle first': 'Claim a publishing handle for this workspace first.',
      'Wrong namespace': 'A grader id must start with this workspace’s handle.',
      'Grader name taken': 'Another workspace owns that grader name.',
      'Version already published': 'That version already exists. Publish a new version instead.',
      'Code graders cannot be published yet': 'Code graders cannot be published yet.',
      'Grader unavailable': 'That grader is not yours to change.',
    };
    return {
      error:
        (error instanceof Error && messages[error.message]) ||
        'We could not publish this grader. Please try again.',
    };
  }
}

export async function publishGraderVersion(form: FormData): Promise<Result> {
  return save(() => publishGrader(value(form, 'manifest')));
}

export async function withdrawGraderVersion(form: FormData): Promise<Result> {
  return save(() =>
    withdrawVersion(value(form, 'graderId'), value(form, 'version'), value(form, 'note')),
  );
}
```

Create `src/app/app/settings/graders/page.tsx` with `export const dynamic = 'force-dynamic'`, `requireWorkspace()`, and two sections: **Published by this workspace** (from `workspaceGraders()`, each row showing id, version, state and a withdraw form for owners) and **Publish a grader** (owners with a handle: a `SettingsForm` around a `<textarea name="manifest">`). A workspace without a handle sees one sentence pointing at workspace settings. Task 9 adds the browse section to the same page.

- [ ] **Step 4: The page test**

Create `src/app/app/settings/graders/page.test.ts` mocking `../../../../workspaces/access` and `../../../../db/queries/grader-publishing`:

```ts
test('an owner with a handle is offered the publish form', async () => {
  deps.workspace.mockResolvedValue({ id: 'w', name: 'W', role: 'owner', handle: 'acme' });
  deps.workspaceGraders.mockResolvedValue([]);
  const html = renderToStaticMarkup(await Graders());
  expect(html).toContain('Publish a grader');
  expect(html).toContain('name="manifest"');
});

test('an owner with no handle is told to claim one, and gets no form', async () => {
  deps.workspace.mockResolvedValue({ id: 'w', name: 'W', role: 'owner', handle: null });
  deps.workspaceGraders.mockResolvedValue([]);
  const html = renderToStaticMarkup(await Graders());
  expect(html).toContain('Claim a publishing handle');
  expect(html).not.toContain('name="manifest"');
});

test('a member sees what the workspace published and no publish form', async () => {
  deps.workspace.mockResolvedValue({ id: 'w', name: 'W', role: 'member', handle: 'acme' });
  deps.workspaceGraders.mockResolvedValue([
    { graderId: 'acme/test-coverage', version: '0.1.0', title: 'Test Coverage', publishedAt: new Date('2026-09-15'), verifiedAt: null, withdrawnAt: null },
  ]);
  const html = renderToStaticMarkup(await Graders());
  expect(html).toContain('Test Coverage');
  expect(html).toContain('Not reviewed');
  expect(html).not.toContain('name="manifest"');
});
```

- [ ] **Step 5: Run and commit**

Run: `pnpm vitest run "src/app/app/settings" && pnpm typecheck && pnpm lint`, then the integration file.

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
- Consumes: `browsableGraders`, `graderVersion`, `latestPublishedVersion` (Task 2); `needsHash`, `consentSentences` (Task 2).
- Produces:
  - `installGrader(graderId: string, version: string): Promise<void>`
  - `<ConsentScreen manifest={…} author={…} version={…} action={…} cancelHref={…} />` in `src/components/grading/consent.tsx`

- [ ] **Step 1: Write the failing consent-screen test**

Create `src/components/grading/consent.test.ts`:

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { ConsentScreen } from './consent';
import { AGENT_READINESS_MANIFEST } from '../../domain/grading/graders/agent-readiness';
import { DELIVERY_HEALTH_MANIFEST } from '../../domain/grading/graders/delivery-health';

const render = (manifest: typeof AGENT_READINESS_MANIFEST) =>
  renderToStaticMarkup(
    createElement(ConsentScreen, {
      manifest,
      author: 'fieldnote',
      version: manifest.version,
      action: vi.fn(),
      cancelHref: '/app/settings/graders',
    }),
  );

test('a file grader asks for the files it declared, and nothing about file lists', () => {
  const html = render(AGENT_READINESS_MANIFEST);
  expect(html).toContain('The contents of files matching README.md');
  expect(html).not.toContain('list of file names');
});

test('a metrics grader asks for the window it declared', () => {
  expect(render(DELIVERY_HEALTH_MANIFEST)).toContain(
    'Your merged pull request and CI record over 30 days',
  );
});

test('the screen names the grader, its author and the version being installed', () => {
  const html = render(AGENT_READINESS_MANIFEST);
  expect(html).toContain(AGENT_READINESS_MANIFEST.card.title);
  expect(html).toContain('fieldnote');
  expect(html).toContain(AGENT_READINESS_MANIFEST.version);
});

test('it says plainly that nothing else is collected', () => {
  expect(render(AGENT_READINESS_MANIFEST)).toContain('Nothing else is collected.');
});
```

- [ ] **Step 2: Write the failing install tests**

Create `src/db/grader-installs.integration.test.ts` with the same harness as Task 7's file, plus a helper that publishes a fixture version directly into `graders`/`grader_versions` (no session needed):

```ts
async function publishFixture(over: Record<string, unknown> = {}, ownedBy: string | null = null) {
  const manifest = parseManifest({ /* the acme/test-coverage manifest from Task 8, with `over` applied */ });
  await db().insert(graders).values({ id: manifest.id, ownedByWorkspaceId: ownedBy }).onConflictDoNothing();
  await db().insert(graderVersions).values({
    graderId: manifest.id,
    version: manifest.version,
    evaluatorVersion: manifest.evaluatorVersion,
    manifest,
  }).onConflictDoNothing();
  return manifest;
}

test('installing pins the version and records the needs the workspace agreed to', async () => {
  const manifest = await publishFixture();
  await installGrader(manifest.id, manifest.version);
  const [row] = await db()
    .select()
    .from(graderInstalls)
    .where(and(eq(graderInstalls.workspaceId, workspace), eq(graderInstalls.graderId, manifest.id)));
  expect(row.version).toBe(manifest.version);
  expect(row.consentedNeeds).toBe(needsHash(manifest.needs));
  expect(row.installedBy).toBe(owner);
});

test('installing twice keeps the first install and its consent', async () => {
  const manifest = await publishFixture();
  await installGrader(manifest.id, manifest.version);
  await installGrader(manifest.id, manifest.version);
  const rows = await db()
    .select()
    .from(graderInstalls)
    .where(eq(graderInstalls.workspaceId, workspace));
  expect(rows).toHaveLength(1);
});

test('a member cannot install', async () => {
  const manifest = await publishFixture();
  context.user = member;
  await expect(installGrader(manifest.id, manifest.version)).rejects.toThrow('not found');
  expect(await db().select().from(graderInstalls).where(eq(graderInstalls.workspaceId, workspace))).toEqual([]);
});

test('a withdrawn version cannot be newly installed', async () => {
  const manifest = await publishFixture();
  await db()
    .update(graderVersions)
    .set({ withdrawnAt: new Date() })
    .where(eq(graderVersions.graderId, manifest.id));
  await expect(installGrader(manifest.id, manifest.version)).rejects.toThrow('Version unavailable');
});

test('an unknown grader or version cannot be installed', async () => {
  await expect(installGrader('nobody/nothing', '0.1.0')).rejects.toThrow('Version unavailable');
});

test('an unreviewed version installs, and the install records no verification of its own', async () => {
  const manifest = await publishFixture();
  await installGrader(manifest.id, manifest.version);
  const installed = await installedGrader(workspace, manifest.id);
  expect(installed?.verifiedAt).toBeNull();
  expect(installed?.manifest).toEqual(manifest);
});
```

- [ ] **Step 3: Implement**

Create `src/db/queries/grader-installs.ts`:

```ts
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../index';
import { graderInstalls, graderVersions } from '../schema';
import { requireWorkspace } from '../../workspaces/access';
import { currentUser } from '../../auth/session';
import { parseManifest } from '../../domain/grading/registry';
import { needsHash } from '../../domain/grading/needs-consent';

async function installable(graderId: string, version: string) {
  const [row] = await db()
    .select({ manifest: graderVersions.manifest })
    .from(graderVersions)
    .where(
      and(
        eq(graderVersions.graderId, graderId),
        eq(graderVersions.version, version),
        isNull(graderVersions.withdrawnAt),
      ),
    );
  if (!row) throw new Error('Version unavailable');
  return parseManifest(row.manifest);
}

/**
 * Install one version into this workspace, recording what it may read. Owners
 * only: an install is a permission grant over every repository the workspace
 * has connected, which is a bigger step than running a grade.
 */
export async function installGrader(graderId: string, version: string): Promise<void> {
  const workspace = await requireWorkspace(undefined, 'owner');
  const manifest = await installable(graderId, version);
  const user = await currentUser();
  await db()
    .insert(graderInstalls)
    .values({
      workspaceId: workspace.id,
      graderId,
      version,
      installedBy: user.id,
      consentedNeeds: needsHash(manifest.needs),
    })
    .onConflictDoNothing();
}
```

Create `src/components/grading/consent.tsx` — a server component, no `'use client'`:

```tsx
import { Button, Surface } from '@fieldnote/design-system';
import { consentSentences } from '../../domain/grading/needs-consent';
import type { GraderManifest } from '../../domain/grading/manifest';

/**
 * What a grader may read, in the grader's own declaration and fieldnote's
 * words. Every sentence is generated from `needs` — an author never describes
 * their own permissions — and the collector enforces the same declaration at
 * grading time, so this screen and the runtime cannot drift.
 */
export function ConsentScreen({
  manifest,
  author,
  version,
  action,
  cancelHref,
}: {
  manifest: GraderManifest;
  author: string;
  version: string;
  action: (form: FormData) => Promise<{ error?: string }>;
  cancelHref: string;
}) {
  return (
    <Surface className="grader-consent">
      <h2>Install {manifest.card.title}</h2>
      <p>
        {author} · version {version}
      </p>
      <p>{manifest.card.tagline}</p>
      <h3>This grader will be allowed to read</h3>
      <ul>
        {consentSentences(manifest.needs).map((sentence) => (
          <li key={sentence}>{sentence}</li>
        ))}
      </ul>
      <p>Nothing else is collected. It runs against every repository in this workspace.</p>
      <form action={action}>
        <input type="hidden" name="graderId" value={manifest.id} />
        <input type="hidden" name="version" value={version} />
        <Button type="submit">Install</Button>
      </form>
      <a href={cancelHref}>Cancel</a>
    </Surface>
  );
}
```

Add `installGraderVersion(form)` to the graders actions (same `save()` wrapper, messages `'Version unavailable': 'That version is no longer available to install.'`), and on the page: a **Browse** section from `browsableGraders(workspace.id)` where each uninstalled entry links to `?install=<graderId>@<version>`, and when that query is present the page renders `<ConsentScreen>` instead of the list.

- [ ] **Step 4: Run and commit**

Run: `pnpm vitest run src/components/grading "src/app/app/settings" && pnpm typecheck && pnpm lint`, then the integration file.

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
- Produces: `updateInstall(graderId: string, version: string): Promise<void>` and `uninstallGrader(graderId: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```ts
test('an update whose needs are unchanged re-pins the version', async () => {
  const first = await publishFixture();
  await installGrader(first.id, first.version);
  const second = await publishFixture({ version: '0.2.0', disclaimer: 'Reworded.' });
  await updateInstall(second.id, second.version);
  const installed = await installedGrader(workspace, second.id);
  expect(installed?.version).toBe('0.2.0');
  expect(installed?.consentedNeeds).toBe(needsHash(second.needs));
});

test('an update that widens needs records the new consent', async () => {
  const first = await publishFixture();
  await installGrader(first.id, first.version);
  const wider = await publishFixture({
    version: '0.3.0',
    needs: { 'repo.files': ['README.md', 'src/**/*.ts'] },
  });
  await updateInstall(wider.id, wider.version);
  const installed = await installedGrader(workspace, wider.id);
  expect(installed?.consentedNeeds).toBe(needsHash(wider.needs));
  expect(installed?.consentedNeeds).not.toBe(needsHash(first.needs));
});

test('uninstalling clears this workspace nightly schedules and public sharing for that grader', async () => {
  const manifest = await publishFixture();
  await installGrader(manifest.id, manifest.version);
  const repositoryId = await fixtureRepository();
  await db().insert(gradeSchedules).values({ repositoryId, graderId: manifest.id, enabledBy: owner, workspaceId: workspace });
  await db()
    .insert(publicGrades)
    .values({ repositoryId, graderId: manifest.id, enabledBy: owner, workspaceId: workspace });
  await uninstallGrader(manifest.id);
  expect(await db().select().from(graderInstalls).where(eq(graderInstalls.workspaceId, workspace))).toEqual([]);
  expect(await db().select().from(gradeSchedules).where(eq(gradeSchedules.graderId, manifest.id))).toEqual([]);
  expect(await db().select().from(publicGrades).where(eq(publicGrades.graderId, manifest.id))).toEqual([]);
});

test('uninstalling leaves another workspace rows for the same repository alone', async () => {
  const manifest = await publishFixture();
  await installGrader(manifest.id, manifest.version);
  const repositoryId = await fixtureRepository();
  await db().insert(gradeSchedules).values({ repositoryId, graderId: manifest.id, enabledBy: secondOwner, workspaceId: otherWorkspace });
  await uninstallGrader(manifest.id);
  const rows = await db().select().from(gradeSchedules).where(eq(gradeSchedules.graderId, manifest.id));
  expect(rows.map((row) => row.workspaceId)).toEqual([otherWorkspace]);
});

test('uninstalling leaves grade history intact', async () => {
  const manifest = await publishFixture();
  await installGrader(manifest.id, manifest.version);
  const repositoryId = await fixtureRepository();
  const runId = randomUUID();
  await db().insert(gradeRuns).values({ /* a complete run for manifest.id, as the public-grades fixture does */ });
  await uninstallGrader(manifest.id);
  expect(await db().select().from(gradeRuns).where(eq(gradeRuns.id, runId))).toHaveLength(1);
});

test('a member cannot update or uninstall', async () => {
  const manifest = await publishFixture();
  await installGrader(manifest.id, manifest.version);
  context.user = member;
  await expect(updateInstall(manifest.id, manifest.version)).rejects.toThrow('not found');
  await expect(uninstallGrader(manifest.id)).rejects.toThrow('not found');
});
```

(`public_grades` takes `repositoryId`, `graderId`, `enabledBy` and `workspaceId`; `enabledAt` defaults and `revokedAt` stays null, which is what "shared" means.)

- [ ] **Step 2: Implement**

```ts
/** Re-pin an install to another version, recording the consent that version needs. */
export async function updateInstall(graderId: string, version: string): Promise<void> {
  const workspace = await requireWorkspace(undefined, 'owner');
  const manifest = await installable(graderId, version);
  await db()
    .update(graderInstalls)
    .set({ version, consentedNeeds: needsHash(manifest.needs) })
    .where(
      and(eq(graderInstalls.workspaceId, workspace.id), eq(graderInstalls.graderId, graderId)),
    );
}

/**
 * Remove a grader from this workspace, and with it the things this workspace
 * turned on through it: nightly schedules and public sharing. Both tables carry
 * a workspace_id, so another workspace sharing the same repository is untouched.
 * Grade history is never rewritten.
 */
export async function uninstallGrader(graderId: string): Promise<void> {
  const workspace = await requireWorkspace(undefined, 'owner');
  await db().transaction(async (tx) => {
    await tx
      .delete(graderInstalls)
      .where(
        and(eq(graderInstalls.workspaceId, workspace.id), eq(graderInstalls.graderId, graderId)),
      );
    await tx
      .delete(gradeSchedules)
      .where(and(eq(gradeSchedules.workspaceId, workspace.id), eq(gradeSchedules.graderId, graderId)));
    await tx
      .delete(publicGrades)
      .where(and(eq(publicGrades.workspaceId, workspace.id), eq(publicGrades.graderId, graderId)));
  });
}
```

On the page, an installed entry whose `latestVersion` differs from its `version` shows "Update available — version X"; the update link goes to `?install=<id>@<latest>` so the consent screen is always what confirms it, and the action calls `updateInstall`. The uninstall form sits beside it with the sentence "Uninstalling also turns off this workspace's nightly grading and public sharing for this grader. Grades already produced stay."

Add both actions to `src/app/app/settings/graders/actions.ts` through the same `save()` wrapper.

- [ ] **Step 3: Run and commit**

Run: `pnpm vitest run "src/app/app/settings" && pnpm typecheck && pnpm lint`, then the integration file.

```bash
git add src/db/queries/grader-installs.ts src/db/grader-installs.integration.test.ts "src/app/app/settings/graders"
git commit -m "feat(grading): updating asks again when a grader wants more, and uninstalling clears up

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: The review queue

**Files:**
- Create: `src/workspaces/staff.ts`, `src/app/app/admin/graders/page.tsx`, `src/app/app/admin/graders/actions.ts`
- Modify: `src/db/queries/grader-publishing.ts`, `src/app/app/settings/graders/page.tsx`
- Test: `src/app/app/admin/graders/page.test.ts` (create), `src/db/grader-publishing.integration.test.ts`

**Interfaces:**
- Produces: `requireStaff(): Promise<{ id: string }>`; `reviewQueue(): Promise<QueuedVersion[]>` and `verifyVersion(graderId: string, version: string): Promise<void>` in `grader-publishing.ts`; `QueuedVersion = { graderId: string; version: string; manifest: GraderManifest; author: string; publishedAt: Date }`.

- [ ] **Step 1: Write the failing integration tests**

```ts
test('the queue holds every unreviewed, unwithdrawn version, newest first', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await publishGrader(JSON.stringify(manifest({ version: '0.2.0' })));
  await db().update(users).set({ staff: true }).where(eq(users.id, owner));
  const queue = await reviewQueue();
  expect(queue.map((entry) => entry.version)).toEqual(['0.2.0', '0.1.0']);
  expect(queue[0].manifest.card.title).toBe('Test Coverage');
  expect(queue[0].author).toBe('acme');
});

test('a non-staff user cannot read the queue or verify', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await db().update(users).set({ staff: false }).where(eq(users.id, owner));
  await expect(reviewQueue()).rejects.toThrow('not found');
  await expect(verifyVersion('acme/test-coverage', '0.1.0')).rejects.toThrow('not found');
  const [row] = await db().select().from(graderVersions);
  expect(row.verifiedAt).toBeNull();
});

test('verifying records the reviewer and the date, and takes it out of the queue', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await db().update(users).set({ staff: true }).where(eq(users.id, owner));
  await verifyVersion('acme/test-coverage', '0.1.0');
  const [row] = await db().select().from(graderVersions);
  expect(row.verifiedAt).toBeInstanceOf(Date);
  expect(row.verifiedBy).toBe(owner);
  expect(await reviewQueue()).toEqual([]);
});

test('a new version starts unreviewed however many predecessors were read', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await db().update(users).set({ staff: true }).where(eq(users.id, owner));
  await verifyVersion('acme/test-coverage', '0.1.0');
  await publishGrader(JSON.stringify(manifest({ version: '0.2.0' })));
  expect((await reviewQueue()).map((entry) => entry.version)).toEqual(['0.2.0']);
});

test('a withdrawn version leaves the queue without being verified', async () => {
  await claimHandle('acme');
  await publishGrader(JSON.stringify(manifest()));
  await withdrawVersion('acme/test-coverage', '0.1.0', 'Not ready.');
  await db().update(users).set({ staff: true }).where(eq(users.id, owner));
  expect(await reviewQueue()).toEqual([]);
});
```

- [ ] **Step 2: Implement**

Create `src/workspaces/staff.ts`:

```ts
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '../db';
import { users } from '../db/schema';
import { currentUser } from '../auth/session';

/**
 * fieldnote staff. The flag is set directly in the database — there is no
 * screen for granting it, which the design records as knowingly wrong. A
 * non-staff caller gets notFound(), not a refusal: the review queue does not
 * advertise that it exists.
 */
export async function requireStaff(): Promise<{ id: string }> {
  const user = await currentUser();
  const [row] = await db().select({ staff: users.staff }).from(users).where(eq(users.id, user.id));
  if (!row?.staff) notFound();
  return { id: user.id };
}
```

Add to `grader-publishing.ts`:

```ts
/** Versions nobody has read yet, newest first. Staff only. */
export async function reviewQueue(): Promise<QueuedVersion[]> {
  await requireStaff();
  const rows = await db()
    .select({
      graderId: graderVersions.graderId,
      version: graderVersions.version,
      manifest: graderVersions.manifest,
      publishedAt: graderVersions.publishedAt,
      handle: workspaces.handle,
    })
    .from(graderVersions)
    .innerJoin(graders, eq(graders.id, graderVersions.graderId))
    .leftJoin(workspaces, eq(workspaces.id, graders.ownedByWorkspaceId))
    .where(and(isNull(graderVersions.verifiedAt), isNull(graderVersions.withdrawnAt)))
    .orderBy(desc(graderVersions.publishedAt));
  return rows.map((row) => ({
    graderId: row.graderId,
    version: row.version,
    manifest: parseManifest(row.manifest),
    author: row.handle ?? 'fieldnote',
    publishedAt: row.publishedAt,
  }));
}

/** A person read this version. Not "it is correct" — the card says which. */
export async function verifyVersion(graderId: string, version: string): Promise<void> {
  const staff = await requireStaff();
  await db()
    .update(graderVersions)
    .set({ verifiedAt: new Date(), verifiedBy: staff.id })
    .where(and(eq(graderVersions.graderId, graderId), eq(graderVersions.version, version)));
}
```

`withdrawVersion` currently requires ownership. Staff must be able to withdraw from the queue too: add an early `const staff = await currentUser()` staff check that skips the ownership requirement — read `requireStaff`'s shape and make the ownership branch apply only to non-staff. Say in your report how you expressed it.

Create the page at `src/app/app/admin/graders/page.tsx` (`export const dynamic = 'force-dynamic'`), rendering each queued version: the grader id, author, version, the card's title and tagline, the checks with their points and explanations, `consentSentences(manifest.needs)`, and two forms — verify, and withdraw with a `note` field. Its actions live in `src/app/app/admin/graders/actions.ts` with the same `save()` shape.

- [ ] **Step 3: The page test**

```ts
test('a non-staff visitor gets a 404 rather than a hint that the page exists', async () => {
  deps.reviewQueue.mockRejectedValue(new Error('NEXT_HTTP_ERROR_FALLBACK;404'));
  await expect(AdminGraders()).rejects.toThrow('404');
});

test('staff see the manifest a reviewer has to judge', async () => {
  deps.reviewQueue.mockResolvedValue([
    { graderId: 'acme/test-coverage', version: '0.1.0', manifest: fixtureManifest, author: 'acme', publishedAt: new Date('2026-09-15') },
  ]);
  const html = renderToStaticMarkup(await AdminGraders());
  expect(html).toContain('acme/test-coverage');
  expect(html).toContain('Project documentation');          // a check title
  expect(html).toContain('The contents of files matching README.md');
  expect(html).toContain('Mark verified');
  expect(html).toContain('name="note"');
});

test('an empty queue says so and offers nothing to press', async () => {
  deps.reviewQueue.mockResolvedValue([]);
  const html = renderToStaticMarkup(await AdminGraders());
  expect(html).toContain('Nothing waiting for review.');
  expect(html).not.toContain('Mark verified');
});
```

- [ ] **Step 4: Show the state where a grader is named**

On `/app/settings/graders`, every browse entry and every installed entry renders one of:

```tsx
{entry.verifiedAt ? (
  <span className="grader-state">Read by fieldnote on {entry.verifiedAt.toISOString().slice(0, 10)}</span>
) : entry.withdrawnAt ? (
  <span className="grader-state">Withdrawn</span>
) : (
  <span className="grader-state">Not reviewed</span>
)}
```

and the consent screen shows the same line beneath the author. The grade card itself is not touched: the design system's card has no slot for this, and inventing one is out of scope.

- [ ] **Step 5: Run and commit**

Run: `pnpm vitest run "src/app/app" && pnpm typecheck && pnpm lint && pnpm build`, then the integration file.

```bash
git add src/workspaces/staff.ts "src/app/app/admin" src/db/queries/grader-publishing.ts src/db/grader-publishing.integration.test.ts "src/app/app/settings/graders"
git commit -m "feat(grading): a person reads a grader before it wears the mark

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: The whole path, end to end

**Files:**
- Create: `src/db/grader-lifecycle.integration.test.ts`
- Modify: `scripts/seed.ts`

- [ ] **Step 1: Write the test**

Create `src/db/grader-lifecycle.integration.test.ts` with the same harness (two workspaces, an owner each, a member, `fixtureRepository`, and the `collect-files` mock from `src/db/grade-schedules.integration.test.ts` so a run can be driven through the worker):

```ts
test('publish, verify, install, grade, widen, update, uninstall', async () => {
  // acme publishes.
  context.user = secondOwner;
  context.workspace = otherWorkspace;
  await claimHandle('acme');
  const first = await publishGrader(JSON.stringify(manifest()));

  // fieldnote reads it.
  await db().update(users).set({ staff: true }).where(eq(users.id, staffUser));
  context.user = staffUser;
  await verifyVersion(first.id, first.version);

  // The other workspace installs it and grades with it.
  context.user = owner;
  context.workspace = workspace;
  await installGrader(first.id, first.version);
  const repositoryId = await fixtureRepository();
  github.collect.mockResolvedValueOnce({ sha: HEAD_SHA, complete: true, documents: [{ path: 'README.md', blobSha: 'b'.repeat(40), text: 'hi' }] });
  const run = await requestGrade(repositoryId, first.id);
  await beginGrade(run.id);
  await resolveGradeCommit(run.id);
  await evaluateGradeRun(run.id);
  const graded = await loadGradeRun(run.id);
  expect(graded?.state).toBe('complete');
  expect(graded?.rubricVersion).toBe(first.version);

  // acme publishes a version that reads more. The install does not move.
  context.user = secondOwner;
  context.workspace = otherWorkspace;
  const wider = await publishGrader(
    JSON.stringify(manifest({ version: '0.2.0', needs: { 'repo.files': ['README.md', 'src/**/*.ts'] } })),
  );
  context.user = owner;
  context.workspace = workspace;
  expect((await installedGrader(workspace, first.id))?.version).toBe(first.version);

  // A run still grades against the pinned version, and its evidence is the old one.
  github.collect.mockResolvedValueOnce({ sha: HEAD_SHA, complete: true, documents: [] });
  const second = await requestGrade(repositoryId, first.id);
  expect((await loadGradeRun(second.id))?.rubricVersion).toBe(first.version);

  // Updating re-pins and re-consents.
  await updateInstall(wider.id, wider.version);
  const updated = await installedGrader(workspace, wider.id);
  expect(updated?.version).toBe('0.2.0');
  expect(updated?.consentedNeeds).toBe(needsHash(wider.needs));

  // Uninstalling takes this workspace's schedule and sharing with it, and leaves history.
  await writeGradeSchedule(repositoryId, first.id, true);
  await writePublicGrade(repositoryId, first.id, true);
  await uninstallGrader(first.id);
  expect(await db().select().from(gradeSchedules).where(eq(gradeSchedules.graderId, first.id))).toEqual([]);
  expect(await db().select().from(publicGrades).where(eq(publicGrades.graderId, first.id))).toEqual([]);
  expect((await loadGradeRun(run.id))?.state).toBe('complete');

  // And a run can no longer be requested.
  await expect(requestGrade(repositoryId, first.id)).rejects.toThrow();
});
```

- [ ] **Step 2: Fix the seed**

`scripts/seed.ts` inserts three `gradingRubrics` rows. Replace them with:

```ts
import { seedBuiltInGraders, installBuiltIns } from '../src/db/queries/graders';
…
  await seedBuiltInGraders();
  await installBuiltIns('demo-workspace');
```

and delete the now-unused `gradingRubrics` and `rubricView` imports. The demo's three grade runs stay exactly as they are.

- [ ] **Step 3: Run the whole gate**

```bash
pnpm lint && pnpm typecheck && pnpm test && DEMO_MODE=false pnpm test:integration && pnpm build
```

Expected: green apart from the 2 known `dispatch-import` failures. Also run `DEMO_MODE=true pnpm db:seed` against the local database once and confirm it completes — the demo is the only place the seed path is exercised.

- [ ] **Step 4: Commit**

```bash
git add src/db/grader-lifecycle.integration.test.ts scripts/seed.ts
git commit -m "test(grading): publish, verify, install, grade, update, uninstall

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Final gate

`pnpm lint && pnpm typecheck && pnpm test && DEMO_MODE=false pnpm test:integration && pnpm build`, the readiness diff empty, and `pnpm vitest run src/domain/grading/graders/frozen-rubrics.test.ts` passing — the built-ins' manifests must not have moved while becoming rows.
