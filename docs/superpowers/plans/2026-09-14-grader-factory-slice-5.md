# Grader Factory Slice 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A team can show a grade to the world, and take it back, without showing anything it did not choose to — a public page and a README badge per repository per grader, opt-in, owner-only, revocable.

**Architecture:** One session-free query module (`src/db/queries/public-grades.ts`) is the only thing the public page, badge and share image read; it returns `private` unless every condition holds and copies out a narrow view rather than the stored result. Sharing state is a `public_grades` row whose `revoked_at` keeps a revoked link resolvable. Staleness is measured from the last time fieldnote confirmed a grade still holds — the grade's own completion, or a nightly skip that matched it, recorded in a new `grade_runs.confirmed_at`.

**Tech Stack:** Next.js 16 App Router (route handlers, `generateMetadata`, `opengraph-image` + `next/og`), React 19, Drizzle ORM + Postgres, Zod 4, Vitest 4, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-14-grader-factory-slice-5-design.md`

## Global Constraints

- `src/domain/grading/readiness-v01.test.ts` must stay **byte-identical to `main`** and pass. Editing it is never the fix.
- No `if` naming a grader id inside `src/domain/grading` or `src/grading`. The public page, badge and share image branch on view state, never on a grader id.
- **`src/db/queries/public-grades.ts` must import nothing from `../../auth/session` or `../../workspaces/access`**, directly or transitively through a query module that does. A test enforces it.
- Keep the side-effect `import '../../domain/grading/graders';` in `src/db/queries/grade-runs.ts` and `src/db/queries/grade-schedules.ts`, and add the same import to every new query module that resolves a grader.
- Exact values from the spec: `STALE_AFTER_DAYS = 30`; badge `Cache-Control: public, max-age=300, s-maxage=300`; badge right sides `82 · Very good` (score, space, `·`, space, label), `stale`, `not graded`, `private`; badge left side for a private view is `fieldnote`; labels **Early** (0–49) and **Improving** (50–69); private page copy `This grade is private.`; ungraded page copy `Not graded yet.`
- URL shape: `/r/<owner>/<repo>/<graderOwner>/<graderName>`, with `/badge.svg` beneath it.
- Never `git add -A` or `git add .`; stage explicit paths. Do not touch `.agents/`, `.claude/`, `skills-lock.json`. Do not change `grader.mjs` or any manifest — slice 4's frozen-rubric hashes must not move.
- Every commit message ends with exactly `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` and no other Co-Authored-By line. Never write your own model name.
- `eslint .` walks sibling worktrees under `.claude/worktrees/`; failures there are not yours.
- Gate: `pnpm check` with `DEMO_MODE=false` on the command line for the integration run. Known baseline: 2 integration failures in `src/inngest/dispatch-import.integration.test.ts` that also fail on `main`. Another session may share the test database — re-run before concluding a failure is real.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/domain/grading/presentation.ts` (modify) | The two softened labels |
| `src/db/schema.ts` (modify) | `grade_runs.confirmed_at`; `public_grades` table |
| `drizzle/0015_grade_confirmed_at.sql`, `drizzle/0016_public_grades.sql` (generated) | Migrations |
| `src/db/queries/grade-runs.ts` (modify) | `confirmGrade()`, `latestFinishedGrade()` gains the run id |
| `src/inngest/functions/schedule-grades.ts` (modify) | A skip confirms the run it matched |
| `src/db/queries/public-grade-settings.ts` (create) | Session-bound: read and write sharing (owner only) |
| `src/app/app/repos/[repoId]/grading/actions.ts` (modify) | `setPublicGrade` server action |
| `src/domain/grading/public-grade.ts` (create) | Pure: the public view types, `freshAt`, `isStale`, `publicGrader`, `publicGradeFrom` |
| `src/db/queries/public-grades.ts` (create) | Session-free: `publicGrade(owner, repo, graderId, now)` |
| `src/domain/grading/badge.ts` (create) | Pure: `badgeParts`, `renderBadge` |
| `src/app/r/[owner]/[repo]/[graderOwner]/[graderName]/page.tsx` (create) | The public page + `generateMetadata` |
| `.../[graderName]/public-grade.css` (create) | Its layout |
| `.../[graderName]/badge.svg/route.ts` (create) | The badge |
| `.../[graderName]/opengraph-image.tsx` (create) | The share image |
| `src/components/grading/og-card.tsx` (create) | Pure JSX for the share image |
| `src/components/grading/share-toggle.tsx` (create) | The switch and the Markdown to copy |
| `src/components/grading/report.tsx` (modify) | `GradeReport` accepts a grade without a run id |
| `src/lib/app-routes.ts` (modify) | `publicGradePath`, `publicBadgePath` |
| `src/db/public-grades.integration.test.ts` (create) | Sharing, the lookup, and the indistinguishability proof |

---

### Task 1: The softened labels

**Files:**
- Modify: `src/domain/grading/presentation.ts:18-20`
- Modify: `src/domain/grading/presentation.test.ts`, `src/components/grading/grade-presentation.test.ts`, `src/app/page.test.ts`, `src/components/marketing/sample-grades.ts`

**Interfaces:**
- Produces: `gradePresentation(score).label` is `'Early'` for 0–49 and `'Improving'` for 50–69. Every other field is unchanged.

- [ ] **Step 1: Change the tests first**

In `src/domain/grading/presentation.test.ts`, in the "consistent presentation" table, replace `[0, 'Bad', …]` with `[0, 'Early', 'circle', 1, '#b54740']` and `[50, 'Mediocre', …]` with `[50, 'Improving', 'circle', 1, '#548eae']`, and add two boundary rows so the ranges are pinned:

```ts
  [49, 'Early', 'circle', 1, '#b54740'],
  [69, 'Improving', 'circle', 1, '#548eae'],
```

In `src/components/grading/grade-presentation.test.ts`, change `[32, 'common', 'Bad', 'circle', 1]` to `[32, 'common', 'Early', 'circle', 1]` and `[61, 'shimmer', 'Mediocre', 'circle', 1]` to `[61, 'shimmer', 'Improving', 'circle', 1]`.

In `src/app/page.test.ts`, change `expect(html).toContain('Mediocre');` to `expect(html).toContain('Improving');`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/domain/grading/presentation.test.ts src/components/grading/grade-presentation.test.ts src/app/page.test.ts`
Expected: FAIL — the labels are still `Bad` and `Mediocre`.

- [ ] **Step 3: Change the labels**

In `src/domain/grading/presentation.ts`, the last two branches become:

```ts
  if (score >= 50)
    return { label: 'Improving', finish: 'shimmer', color: '#548eae', symbol: 'circle', count: 1 };
  return { label: 'Early', finish: 'common', color: '#b54740', symbol: 'circle', count: 1 };
```

In `src/components/marketing/sample-grades.ts:20`, the comment becomes:

```ts
/** Where the hero's climb rests before it starts: Improving, a Shimmer card. */
```

- [ ] **Step 4: Run the full unit suite**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: PASS. If another test quotes the old words, update that quotation — the thresholds, finishes and colours must not move.

- [ ] **Step 5: Commit**

```bash
git add src/domain/grading/presentation.ts src/domain/grading/presentation.test.ts src/components/grading/grade-presentation.test.ts src/app/page.test.ts src/components/marketing/sample-grades.ts
git commit -m "feat(grading): the bottom two rungs say Early and Improving

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: A nightly skip confirms the grade it matched

**Files:**
- Modify: `src/db/schema.ts` (the `gradeRuns` table)
- Create: `drizzle/0015_grade_confirmed_at.sql` (generated)
- Modify: `src/db/queries/grade-runs.ts` (`latestFinishedGrade`, new `confirmGrade`)
- Modify: `src/inngest/functions/schedule-grades.ts`
- Test: `src/inngest/functions/schedule-grades.test.ts`, `src/db/grade-schedules.integration.test.ts`

**Interfaces:**
- Produces:
  - `grade_runs.confirmed_at`, nullable timestamptz
  - `latestFinishedGrade(repositoryId, graderId): Promise<{ id: string; sha: string; rubricVersion: string } | null>`
  - `confirmGrade(runId: string, at?: Date): Promise<void>` — trusted worker primitive, updates only a `complete` or `insufficient` run

- [ ] **Step 1: Write the failing scheduler tests**

In `src/inngest/functions/schedule-grades.test.ts`, add `confirmGrade: vi.fn()` to the hoisted `runs` mock, give the existing `latestFinishedGrade` results an `id` (for example `{ id: 'run-old', sha: 'a'.repeat(40), rubricVersion: agentReadinessManifest.version }`), and append:

```ts
test('a skip confirms the finished run it matched', async () => {
  runs.latestFinishedGrade.mockResolvedValue({
    id: 'run-old',
    sha: 'a'.repeat(40),
    rubricVersion: agentReadinessManifest.version,
  });
  expect(await scheduleIfDue(readinessRow)).toBeNull();
  expect(runs.confirmGrade).toHaveBeenCalledWith('run-old');
});

test('a run that is scheduled is not confirmed', async () => {
  runs.latestFinishedGrade.mockResolvedValue({
    id: 'run-old',
    sha: 'b'.repeat(40),
    rubricVersion: agentReadinessManifest.version,
  });
  expect(await scheduleIfDue(readinessRow)).toBe('run-1');
  expect(runs.confirmGrade).not.toHaveBeenCalled();
});

test('a grader whose evidence changes over time confirms nothing', async () => {
  expect(await scheduleIfDue(deliveryRow)).toBe('run-1');
  expect(runs.confirmGrade).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/inngest/functions/schedule-grades.test.ts`
Expected: FAIL — `confirmGrade` is not exported and never called.

- [ ] **Step 3: Add the column**

In `src/db/schema.ts`, inside `gradeRuns`, after `completedAt`:

```ts
    // The last time fieldnote confirmed this run still describes its
    // repository: its own completion, or a nightly skip that matched it —
    // same head commit, same grader version. Outside `result`, so a completed
    // grade's content never changes. The public badge's staleness rule is its
    // only reader.
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
```

Run: `pnpm db:generate --name grade_confirmed_at`
Expected: `drizzle/0015_grade_confirmed_at.sql` adding one nullable column, plus its meta snapshot and journal entry. Read the SQL before continuing; it must contain no other statement.

- [ ] **Step 4: Add the query and the call**

In `src/db/queries/grade-runs.ts`, change `latestFinishedGrade` to select and return the id:

```ts
export async function latestFinishedGrade(
  repositoryId: string,
  graderId: string,
): Promise<{ id: string; sha: string; rubricVersion: string } | null> {
  const [run] = await db()
    .select({ id: runs.id, sha: runs.sha, rubricVersion: runs.rubricVersion })
    .from(runs)
    .where(
      and(
        eq(runs.repositoryId, repositoryId),
        eq(runs.graderId, graderId),
        inArray(runs.state, ['complete', 'insufficient']),
        isNotNull(runs.sha),
      ),
    )
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(1);
  return run?.sha ? { id: run.id, sha: run.sha, rubricVersion: run.rubricVersion } : null;
}

/**
 * Trusted worker primitive: record that a finished run still describes its
 * repository. The nightly skip is the evidence — same head commit, same grader
 * version — and this is where that evidence is kept, so a badge can say `stale`
 * without a GitHub call. Only a run that finished with a result can be
 * confirmed; nothing about the stored result changes.
 */
export async function confirmGrade(runId: string, at = new Date()): Promise<void> {
  await db()
    .update(runs)
    .set({ confirmedAt: at })
    .where(and(eq(runs.id, runId), inArray(runs.state, ['complete', 'insufficient'])));
}
```

In `src/inngest/functions/schedule-grades.ts`, add `confirmGrade` to the `../../db/queries/grade-runs` import and change the skip:

```ts
    const latest = await latestFinishedGrade(row.repositoryId, row.graderId);
    if (latest?.sha === head && latest.rubricVersion === manifest.version) {
      // The skip is the evidence that this grade still holds, and the public
      // badge's staleness rule reads it.
      await confirmGrade(latest.id);
      return null;
    }
```

- [ ] **Step 5: Write the failing integration assertions**

In `src/db/grade-schedules.integration.test.ts`, extend the existing test `the second night skips a repository whose head sha has not moved`: after `expect(await scheduleIfDue(row)).toBeNull();` add

```ts
  const confirmed = await loadGradeRun(runId);
  expect(confirmed?.confirmedAt).toBeInstanceOf(Date);
  // Confirmation is provenance, not content: the stored result is untouched.
  expect(confirmed?.result).toEqual(
    expect.objectContaining({ rubricVersion: agentReadinessManifest.version }),
  );
```

and append:

```ts
test('a failed run is never confirmed', async () => {
  const repositoryId = await fixtureRepository();
  await writeGradeSchedule(repositoryId, AGENT_READINESS, true);
  const row = (await listGradeSchedules()).find((entry) => entry.repositoryId === repositoryId)!;
  const runId = (await scheduleIfDue(row))!;
  await beginGrade(runId);
  await pinGradeSha(runId, HEAD_SHA);
  await failGrade(runId, 'grader_failed');
  await confirmGrade(runId);
  expect((await loadGradeRun(runId))?.confirmedAt).toBeNull();
});
```

Add `confirmGrade` to that file's `./queries/grade-runs` import.

- [ ] **Step 6: Run everything**

Run: `pnpm vitest run src/inngest/functions/schedule-grades.test.ts && pnpm typecheck && pnpm lint`
Then: `DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/grade-schedules.integration.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts drizzle src/db/queries/grade-runs.ts src/inngest/functions/schedule-grades.ts src/inngest/functions/schedule-grades.test.ts src/db/grade-schedules.integration.test.ts
git commit -m "feat(grading): a nightly skip records that a grade still holds

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The sharing row and the owner-only switch

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0016_public_grades.sql` (generated)
- Create: `src/db/queries/public-grade-settings.ts`
- Modify: `src/app/app/repos/[repoId]/grading/actions.ts`
- Test: `src/db/public-grades.integration.test.ts` (new)

**Interfaces:**
- Consumes: `requireRepository`, `requireWorkspace(undefined, 'owner')` from `src/workspaces/access.ts`; `getGrader` from the registry.
- Produces:
  - table `public_grades` — `(repository_id, grader_id)` primary key, `enabled_by`, `workspace_id`, `enabled_at`, nullable `revoked_at`
  - `publicGradeSettings(repositoryId: string): Promise<Record<string, { shared: boolean }>>`
  - `writePublicGrade(repositoryId: string, graderId: string, shared: boolean): Promise<void>`
  - server action `setPublicGrade(repositoryId, graderId, shared): Promise<void>`

- [ ] **Step 1: Add the table**

In `src/db/schema.ts`, after `gradeSchedules`:

```ts
// One row per (repository, grader) a workspace owner has made public. A row
// with revoked_at NULL is shared. Turning sharing off sets revoked_at and keeps
// the row, so a README's badge renders `private` rather than breaking, and
// turning it back on revives the same link. Keyed by repository, not by
// workspace, exactly as grade_schedules is: one repository connected to two
// workspaces has one sharing state per grader.
export const publicGrades = pgTable(
  'public_grades',
  {
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    graderId: text('grader_id').notNull(),
    enabledBy: text('enabled_by')
      .notNull()
      .references(() => users.id),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    enabledAt: timestamp('enabled_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.graderId] })],
);
```

Run: `pnpm db:generate --name public_grades`
Expected: `drizzle/0016_public_grades.sql` creating one table with its three foreign keys and primary key. Read it before continuing.

- [ ] **Step 2: Write the failing integration tests**

Create `src/db/public-grades.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDb } from './index';
import {
  installations,
  publicGrades as publicGradeRows,
  repositories,
  users,
  workspaces,
  workspaceMemberships,
  workspaceRepositories,
  gradeRuns,
} from './schema';
import { publicGradeSettings, writePublicGrade } from './queries/public-grade-settings';
import { AGENT_READINESS } from '../domain/grading/graders/agent-readiness';

// A signed-out visitor is a session that throws, which is what currentUser()
// does in the real application; requireWorkspace() calls it first.
const context = vi.hoisted(() => ({ user: '', workspace: '', demo: false }));
vi.mock('../auth/session', () => ({
  currentUser: async () => {
    if (!context.user) throw new Error('Not signed in');
    return { id: context.user };
  },
  cookieOptions: {},
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: context.workspace }) }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
}));
vi.mock('../lib/env', () => ({ env: () => ({ DEMO_MODE: context.demo ? 'true' : 'false' }) }));

let owner = '';
let secondOwner = '';
let member = '';
let workspace = '';
beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
  owner = randomUUID();
  secondOwner = randomUUID();
  member = randomUUID();
  workspace = randomUUID();
  await db()
    .insert(users)
    .values([
      { id: owner, login: 'owner', credentials: 'fixture' },
      { id: secondOwner, login: 'owner-two', credentials: 'fixture' },
      { id: member, login: 'member', credentials: 'fixture' },
    ]);
  await db().insert(workspaces).values({ id: workspace, name: 'Public', defaultForUserId: owner });
  await db()
    .insert(workspaceMemberships)
    .values([
      { workspaceId: workspace, userId: owner, role: 'owner' },
      { workspaceId: workspace, userId: secondOwner, role: 'owner' },
      { workspaceId: workspace, userId: member, role: 'member' },
    ]);
});

const fixtureRepositories: string[] = [];
afterAll(async () => {
  if (fixtureRepositories.length) {
    await db()
      .delete(publicGradeRows)
      .where(inArray(publicGradeRows.repositoryId, fixtureRepositories));
    await db().delete(gradeRuns).where(inArray(gradeRuns.repositoryId, fixtureRepositories));
    await db()
      .delete(workspaceRepositories)
      .where(inArray(workspaceRepositories.repositoryId, fixtureRepositories));
    await db().delete(repositories).where(inArray(repositories.id, fixtureRepositories));
    await db().delete(installations).where(inArray(installations.id, fixtureRepositories));
  }
  await db().delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, workspace));
  await db().delete(workspaces).where(eq(workspaces.id, workspace));
  await db().delete(users).where(inArray(users.id, [owner, secondOwner, member]));
  await closeDb();
});

type RepoOptions = { isPrivate?: boolean; active?: boolean; installationActive?: boolean; isDemo?: boolean; linked?: boolean; owner?: string; name?: string };
async function fixtureRepository(options: RepoOptions = {}): Promise<string> {
  const id = randomUUID();
  fixtureRepositories.push(id);
  await db().insert(installations).values({
    id,
    githubInstallationId: id,
    accountLogin: 'test',
    accountType: 'User',
    active: options.installationActive ?? true,
  });
  await db()
    .insert(repositories)
    .values({
      id,
      installationId: id,
      githubRepositoryId: id,
      owner: options.owner ?? `owner-${id.slice(0, 8)}`,
      name: options.name ?? 'repo',
      defaultBranch: 'main',
      isPrivate: options.isPrivate ?? false,
      active: options.active ?? true,
      isDemo: options.isDemo ?? false,
    });
  if (options.linked ?? true)
    await db()
      .insert(workspaceRepositories)
      .values({ workspaceId: workspace, repositoryId: id, connectedBy: owner });
  return id;
}

beforeEach(() => {
  context.user = owner;
  context.workspace = workspace;
  context.demo = false;
});

test('an owner shares, revokes and shares again, and the row survives', async () => {
  const repositoryId = await fixtureRepository();
  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  expect(await publicGradeSettings(repositoryId)).toEqual({ [AGENT_READINESS]: { shared: true } });

  await writePublicGrade(repositoryId, AGENT_READINESS, false);
  expect(await publicGradeSettings(repositoryId)).toEqual({ [AGENT_READINESS]: { shared: false } });
  const [revoked] = await db()
    .select()
    .from(publicGradeRows)
    .where(eq(publicGradeRows.repositoryId, repositoryId));
  expect(revoked.revokedAt).toBeInstanceOf(Date);

  context.user = secondOwner;
  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  const [reshared] = await db()
    .select()
    .from(publicGradeRows)
    .where(eq(publicGradeRows.repositoryId, repositoryId));
  expect(reshared.revokedAt).toBeNull();
  expect(reshared.enabledBy).toBe(secondOwner);
});

test('a member cannot share', async () => {
  const repositoryId = await fixtureRepository();
  context.user = member;
  await expect(writePublicGrade(repositoryId, AGENT_READINESS, true)).rejects.toThrow('not found');
  expect(await db().select().from(publicGradeRows).where(eq(publicGradeRows.repositoryId, repositoryId))).toEqual([]);
});

test('a signed-out visitor cannot share', async () => {
  const repositoryId = await fixtureRepository();
  context.user = '';
  await expect(writePublicGrade(repositoryId, AGENT_READINESS, true)).rejects.toThrow();
});

test('the demo workspace cannot share', async () => {
  const repositoryId = await fixtureRepository();
  context.demo = true;
  await expect(writePublicGrade(repositoryId, AGENT_READINESS, true)).rejects.toThrow();
});

test('an unknown grader cannot be shared', async () => {
  const repositoryId = await fixtureRepository();
  await expect(writePublicGrade(repositoryId, 'nobody/nothing', true)).rejects.toThrow();
});

test('a repository the workspace is not connected to cannot be shared', async () => {
  const repositoryId = await fixtureRepository({ linked: false });
  await expect(writePublicGrade(repositoryId, AGENT_READINESS, true)).rejects.toThrow();
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/public-grades.integration.test.ts`
Expected: FAIL — `./queries/public-grade-settings` does not exist.

- [ ] **Step 4: Implement the settings module**

Create `src/db/queries/public-grade-settings.ts`:

```ts
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../index';
import { installations, publicGrades, repositories, workspaceRepositories } from '../schema';
import { requireRepository, requireWorkspace } from '../../workspaces/access';
import { currentUser } from '../../auth/session';
// The same deliberate side-effect import grade-runs.ts documents: importing a
// grader module registers it, and a serverless entry point has no boot step.
import '../../domain/grading/graders';
import { getGrader } from '../../domain/grading/registry';

/**
 * Session-bound half of public sharing: what the grades page draws, and what
 * its switch writes. The public page, badge and share image read none of this —
 * they go through src/db/queries/public-grades.ts, which has no session at all.
 */
export type PublicGradeSetting = { shared: boolean };

/** Every sharing row on one repository, keyed by grader id. Absent means never shared. */
export async function publicGradeSettings(
  repositoryId: string,
): Promise<Record<string, PublicGradeSetting>> {
  await requireRepository(repositoryId);
  const rows = await db()
    .select({ graderId: publicGrades.graderId, revokedAt: publicGrades.revokedAt })
    .from(publicGrades)
    .where(eq(publicGrades.repositoryId, repositoryId));
  return Object.fromEntries(rows.map((row) => [row.graderId, { shared: row.revokedAt === null }]));
}

/**
 * Share a grade publicly, or stop. **Owners only** — making something public is
 * a bigger step than running a grade, and requireWorkspace(undefined, 'owner')
 * is where that is enforced, including for the demo workspace, which it refuses
 * outright.
 *
 * Turning it off keeps the row and sets revoked_at, so a badge already in a
 * README renders `private` rather than breaking; turning it on again clears it
 * and records whoever did so.
 */
export async function writePublicGrade(
  repositoryId: string,
  graderId: string,
  shared: boolean,
): Promise<void> {
  getGrader(graderId);
  const repository = await requireRepository(repositoryId);
  const workspace = await requireWorkspace(undefined, 'owner');
  if (workspace.id === 'demo' || repository.isDemo) throw new Error('Demo workspace is read-only');
  const user = await currentUser();
  const [available] = await db()
    .select({ id: repositories.id })
    .from(repositories)
    .innerJoin(installations, eq(installations.id, repositories.installationId))
    .innerJoin(
      workspaceRepositories,
      and(
        eq(workspaceRepositories.repositoryId, repositories.id),
        eq(workspaceRepositories.workspaceId, workspace.id),
      ),
    )
    .where(
      and(
        eq(repositories.id, repositoryId),
        eq(repositories.active, true),
        eq(repositories.isDemo, false),
        eq(installations.active, true),
      ),
    );
  if (!available) throw new Error('Repository unavailable');
  if (!shared) {
    await db()
      .update(publicGrades)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(publicGrades.repositoryId, repositoryId),
          eq(publicGrades.graderId, graderId),
          isNull(publicGrades.revokedAt),
        ),
      );
    return;
  }
  await db()
    .insert(publicGrades)
    .values({
      repositoryId,
      graderId,
      enabledBy: user.id,
      workspaceId: workspace.id,
      enabledAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [publicGrades.repositoryId, publicGrades.graderId],
      set: {
        enabledBy: user.id,
        workspaceId: workspace.id,
        enabledAt: new Date(),
        revokedAt: null,
      },
    });
}
```

Add the action to `src/app/app/repos/[repoId]/grading/actions.ts`:

```ts
// writePublicGrade resolves the grader through the registry, requires the
// owner role, and refuses the demo workspace and a repository this workspace
// is not connected to.
export async function setPublicGrade(
  repositoryId: string,
  graderId: string,
  shared: boolean,
): Promise<void> {
  await writePublicGrade(repositoryId, graderId, shared);
}
```

with `import { writePublicGrade } from '../../../../../db/queries/public-grade-settings';` at the top.

- [ ] **Step 5: Run it to see it pass**

Run: `DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/public-grades.integration.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle src/db/queries/public-grade-settings.ts "src/app/app/repos/[repoId]/grading/actions.ts" src/db/public-grades.integration.test.ts
git commit -m "feat(grading): an owner can share a grade publicly, and take it back

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The public view, pure

**Files:**
- Create: `src/domain/grading/public-grade.ts`
- Test: `src/domain/grading/public-grade.test.ts`

**Interfaces:**
- Produces:
  - `const STALE_AFTER_DAYS = 30`
  - `type PublicRepository = { owner: string; name: string; isPrivate: boolean }`
  - `type PublicGrader = { id; title; author; mode; category; disclaimer; version; evaluatorVersion; checkTitles: Record<string, string> }`
  - `type PublicGrade = { score: number; sha: string; computedAt: Date; rubricVersion: string; evaluatorVersion: string; window?: { start: string; endExclusive: string; days: number }; checks: CheckResult[] }`
  - `type PublicGradeView = { state: 'private' } | { state: 'ungraded'; repository; grader } | { state: 'graded'; repository; grader; grade; stale: boolean }`
  - `publicGrader(manifest: GraderManifest): PublicGrader`
  - `freshAt(completedAt: Date, confirmedAt: Date | null): Date`
  - `isStale(freshAt: Date, now: Date): boolean`
  - `publicGradeFrom(result: GradeResult, run: { sha: string; completedAt: Date }, repositoryIsPrivate: boolean): PublicGrade`

- [ ] **Step 1: Write the failing tests**

Create `src/domain/grading/public-grade.test.ts`:

```ts
import { expect, test } from 'vitest';
import { agentReadinessManifest } from './graders/agent-readiness';
import { deliveryHealthManifest } from './graders/delivery-health';
import {
  freshAt,
  isStale,
  publicGradeFrom,
  publicGrader,
  STALE_AFTER_DAYS,
} from './public-grade';
import type { GradeResult } from './types';

const DAY = 86_400_000;
const result: GradeResult = {
  score: 80,
  rubricVersion: '0.1.0',
  evaluatorVersion: '1.0.0',
  checks: [
    {
      id: 'root-readme',
      points: 20,
      maxPoints: 20,
      status: 'pass',
      paths: ['README.md'],
      lineRanges: [{ path: 'README.md', blobSha: 'b'.repeat(40), start: 1, end: 1 }],
      explanation: 'Found a root README.md. Evidence, not certification.',
    },
  ],
};
const run = { sha: 'a'.repeat(40), completedAt: new Date('2026-09-01T00:00:00.000Z') };

test('a public grader is the manifest identity a visitor may read', () => {
  expect(publicGrader(agentReadinessManifest)).toEqual({
    id: 'fieldnote/agent-readiness',
    title: agentReadinessManifest.card.title,
    author: 'fieldnote',
    mode: 'deterministic',
    category: 'agent-readiness',
    disclaimer: agentReadinessManifest.disclaimer,
    version: agentReadinessManifest.version,
    evaluatorVersion: agentReadinessManifest.evaluatorVersion,
    checkTitles: Object.fromEntries(
      agentReadinessManifest.checks.map((check) => [check.id, check.title]),
    ),
  });
});

test('a public repository keeps its evidence paths, and never its line ranges', () => {
  const grade = publicGradeFrom(result, run, false);
  expect(grade.checks[0].paths).toEqual(['README.md']);
  expect(grade.checks[0].lineRanges).toEqual([]);
});

test('a private repository keeps no path at all', () => {
  const grade = publicGradeFrom(result, run, true);
  expect(grade.checks[0].paths).toEqual([]);
  expect(JSON.stringify(grade)).not.toContain('README.md');
});

test('a public grade carries exactly the fields a visitor may read', () => {
  expect(Object.keys(publicGradeFrom(result, run, false)).sort()).toEqual([
    'checks',
    'computedAt',
    'evaluatorVersion',
    'rubricVersion',
    'score',
    'sha',
  ]);
  expect(Object.keys(publicGradeFrom(result, run, false).checks[0]).sort()).toEqual([
    'explanation',
    'id',
    'lineRanges',
    'maxPoints',
    'paths',
    'points',
    'status',
  ]);
});

test('a window grader carries the dates it scored', () => {
  const windowed: GradeResult = {
    ...result,
    rubricVersion: deliveryHealthManifest.version,
    window: { start: '2026-08-01T00:00:00.000Z', endExclusive: '2026-08-31T00:00:00.000Z', days: 30 },
  };
  expect(publicGradeFrom(windowed, run, false).window).toEqual(windowed.window);
});

test('an unscored result is never a public grade', () => {
  expect(() => publicGradeFrom({ ...result, score: null }, run, false)).toThrow();
});

test('freshness is the later of completion and confirmation', () => {
  const completed = new Date('2026-09-01T00:00:00.000Z');
  const confirmed = new Date('2026-09-20T00:00:00.000Z');
  expect(freshAt(completed, null)).toEqual(completed);
  expect(freshAt(completed, confirmed)).toEqual(confirmed);
  expect(freshAt(confirmed, completed)).toEqual(confirmed);
});

test('a grade goes stale strictly after thirty days', () => {
  const fresh = new Date('2026-09-01T00:00:00.000Z');
  expect(STALE_AFTER_DAYS).toBe(30);
  expect(isStale(fresh, new Date(fresh.getTime() + STALE_AFTER_DAYS * DAY))).toBe(false);
  expect(isStale(fresh, new Date(fresh.getTime() + STALE_AFTER_DAYS * DAY + 1))).toBe(true);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/domain/grading/public-grade.test.ts`
Expected: FAIL — `./public-grade` does not exist.

- [ ] **Step 3: Implement**

Create `src/domain/grading/public-grade.ts`:

```ts
import type { GraderManifest } from './manifest';
import type { CheckResult, GradeResult } from './types';

/**
 * A grade is stale when fieldnote has not confirmed it for this long. The
 * slice 1 design said "older than the grader's minInterval"; no manifest has
 * that field, and adding one would change the hashed rubric of every existing
 * grader. One constant until the registry makes a per-grader interval worth a
 * version bump.
 */
export const STALE_AFTER_DAYS = 30;
const DAY_MS = 86_400_000;

export type PublicRepository = { owner: string; name: string; isPrivate: boolean };

/** The manifest identity a visitor may read. No `needs`, no checks' arguments, no program. */
export type PublicGrader = {
  id: string;
  title: string;
  author: string;
  mode: GraderManifest['mode'];
  category: GraderManifest['category'];
  disclaimer: string;
  version: string;
  evaluatorVersion: string;
  checkTitles: Record<string, string>;
};

export type PublicGrade = {
  score: number;
  sha: string;
  computedAt: Date;
  rubricVersion: string;
  evaluatorVersion: string;
  window?: { start: string; endExclusive: string; days: number };
  checks: CheckResult[];
};

export type PublicGradeView =
  | { state: 'private' }
  | { state: 'ungraded'; repository: PublicRepository; grader: PublicGrader }
  | {
      state: 'graded';
      repository: PublicRepository;
      grader: PublicGrader;
      grade: PublicGrade;
      stale: boolean;
    };

export function publicGrader(manifest: GraderManifest): PublicGrader {
  return {
    id: manifest.id,
    title: manifest.card.title,
    // owner/name: the owner is part of a grader's identity, not decoration.
    author: manifest.id.split('/')[0],
    mode: manifest.mode,
    category: manifest.category,
    disclaimer: manifest.disclaimer,
    version: manifest.version,
    evaluatorVersion: manifest.evaluatorVersion,
    checkTitles: Object.fromEntries(manifest.checks.map((check) => [check.id, check.title])),
  };
}

/** The moment a grade was last known to hold: its completion, or a later confirmation. */
export function freshAt(completedAt: Date, confirmedAt: Date | null): Date {
  return confirmedAt && confirmedAt.getTime() > completedAt.getTime() ? confirmedAt : completedAt;
}

export function isStale(fresh: Date, now: Date): boolean {
  return now.getTime() - fresh.getTime() > STALE_AFTER_DAYS * DAY_MS;
}

/**
 * The stored result, narrowed to what a visitor may read. Built field by field
 * rather than spread, so a field added to GradeResult never reaches a public
 * page by default. Line ranges never cross: an evidence link is a path, and a
 * private repository keeps even that.
 */
export function publicGradeFrom(
  result: GradeResult,
  run: { sha: string; completedAt: Date },
  repositoryIsPrivate: boolean,
): PublicGrade {
  if (result.score === null) throw new Error('A public grade is a scored grade');
  const checks: CheckResult[] = result.checks.map((check) => ({
    id: check.id,
    points: check.points,
    maxPoints: check.maxPoints,
    status: check.status,
    explanation: check.explanation,
    paths: repositoryIsPrivate ? [] : [...check.paths],
    lineRanges: [],
  }));
  return {
    score: result.score,
    sha: run.sha,
    computedAt: run.completedAt,
    rubricVersion: result.rubricVersion,
    evaluatorVersion: result.evaluatorVersion,
    ...(result.window ? { window: { ...result.window } } : {}),
    checks,
  };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm vitest run src/domain/grading/public-grade.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/grading/public-grade.ts src/domain/grading/public-grade.test.ts
git commit -m "feat(grading): what a visitor may read of a grade

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The session-free lookup

**Files:**
- Create: `src/db/queries/public-grades.ts`
- Test: `src/db/public-grades.integration.test.ts` (append), `src/db/queries/public-grades.imports.test.ts` (new)

**Interfaces:**
- Consumes: Task 4's pure module; `grade_runs.confirmed_at` from Task 2; the `public_grades` table from Task 3.
- Produces: `publicGrade(owner: string, repo: string, graderId: string, now?: Date): Promise<PublicGradeView>`

- [ ] **Step 1: Write the failing import test**

Create `src/db/queries/public-grades.imports.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// The public page, badge and share image read this module and nothing else.
// It must not be able to reach a session: a public request has none, and a
// query that silently requires one would 500 for every visitor — or worse,
// resolve the *developer's* session in a test and pass.
test('the public lookup imports no session and no workspace access', () => {
  const source = readFileSync(new URL('./public-grades.ts', import.meta.url), 'utf8');
  expect(source).not.toContain('auth/session');
  expect(source).not.toContain('workspaces/access');
  expect(source).not.toContain('next/headers');
});
```

- [ ] **Step 2: Write the failing lookup tests**

Append to `src/db/public-grades.integration.test.ts` (add `publicGrade` from `./queries/public-grades`, `agentReadinessManifest` and `runDeclarative` to its imports):

```ts
async function completedRun(
  repositoryId: string,
  options: { completedAt: Date; confirmedAt?: Date; state?: 'complete' | 'insufficient' | 'failed'; score?: number } = {
    completedAt: new Date('2026-09-01T00:00:00.000Z'),
  },
): Promise<string> {
  const id = randomUUID();
  const state = options.state ?? 'complete';
  const result = runDeclarative(agentReadinessManifest, {
    sha: 'a'.repeat(40),
    complete: state === 'complete',
    documents: [{ path: 'README.md', blobSha: 'b'.repeat(40), text: 'hello' }],
  });
  await db()
    .insert(gradeRuns)
    .values({
      id,
      repositoryId,
      graderId: AGENT_READINESS,
      rubricVersion: agentReadinessManifest.version,
      evaluatorVersion: agentReadinessManifest.evaluatorVersion,
      requestedBy: owner,
      requestedWorkspaceId: workspace,
      state,
      sha: 'a'.repeat(40),
      result: state === 'failed' ? null : result,
      completedAt: options.completedAt,
      confirmedAt: options.confirmedAt ?? null,
      createdAt: options.completedAt,
    });
  return id;
}

test('a shared, graded, public repository is readable by anyone', async () => {
  const repositoryId = await fixtureRepository({ owner: 'Acme', name: 'Widgets' });
  await completedRun(repositoryId);
  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  const view = await publicGrade('acme', 'widgets', AGENT_READINESS, new Date('2026-09-10T00:00:00.000Z'));
  expect(view.state).toBe('graded');
  if (view.state !== 'graded') throw new Error('expected a graded view');
  expect(view.repository).toEqual({ owner: 'Acme', name: 'Widgets', isPrivate: false });
  expect(view.grader.title).toBe(agentReadinessManifest.card.title);
  expect(view.stale).toBe(false);
  expect(view.grade.checks.some((check) => check.paths.includes('README.md'))).toBe(true);
});

test('a private repository shares its score and never its file names', async () => {
  const repositoryId = await fixtureRepository({ isPrivate: true });
  await completedRun(repositoryId);
  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  const [repo] = await db().select().from(repositories).where(eq(repositories.id, repositoryId));
  const view = await publicGrade(repo.owner, repo.name, AGENT_READINESS);
  expect(JSON.stringify(view)).not.toContain('README.md');
  if (view.state !== 'graded') throw new Error('expected a graded view');
  expect(view.grade.score).toBeGreaterThan(0);
});

test('a later unscored run does not replace the public grade', async () => {
  const repositoryId = await fixtureRepository();
  await completedRun(repositoryId, { completedAt: new Date('2026-09-01T00:00:00.000Z') });
  await completedRun(repositoryId, { completedAt: new Date('2026-09-05T00:00:00.000Z'), state: 'insufficient' });
  await completedRun(repositoryId, { completedAt: new Date('2026-09-06T00:00:00.000Z'), state: 'failed' });
  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  const [repo] = await db().select().from(repositories).where(eq(repositories.id, repositoryId));
  const view = await publicGrade(repo.owner, repo.name, AGENT_READINESS);
  if (view.state !== 'graded') throw new Error('expected a graded view');
  expect(view.grade.computedAt).toEqual(new Date('2026-09-01T00:00:00.000Z'));
});

test('staleness counts from the last confirmation', async () => {
  const completedAt = new Date('2026-09-01T00:00:00.000Z');
  const thirtyOneDays = new Date(completedAt.getTime() + 31 * 86_400_000);
  const stale = await fixtureRepository();
  await completedRun(stale, { completedAt });
  await writePublicGrade(stale, AGENT_READINESS, true);
  const [staleRepo] = await db().select().from(repositories).where(eq(repositories.id, stale));
  const staleView = await publicGrade(staleRepo.owner, staleRepo.name, AGENT_READINESS, thirtyOneDays);
  expect(staleView.state === 'graded' && staleView.stale).toBe(true);

  const confirmed = await fixtureRepository();
  await completedRun(confirmed, {
    completedAt,
    confirmedAt: new Date(completedAt.getTime() + 20 * 86_400_000),
  });
  await writePublicGrade(confirmed, AGENT_READINESS, true);
  const [freshRepo] = await db().select().from(repositories).where(eq(repositories.id, confirmed));
  const freshView = await publicGrade(freshRepo.owner, freshRepo.name, AGENT_READINESS, thirtyOneDays);
  expect(freshView.state === 'graded' && freshView.stale).toBe(false);
});

test('a shared repository that has never scored is ungraded, not private', async () => {
  const repositoryId = await fixtureRepository();
  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  const [repo] = await db().select().from(repositories).where(eq(repositories.id, repositoryId));
  expect((await publicGrade(repo.owner, repo.name, AGENT_READINESS)).state).toBe('ungraded');
});

test('every reason to refuse gives the same private answer', async () => {
  const shared = await fixtureRepository();
  await completedRun(shared);
  await writePublicGrade(shared, AGENT_READINESS, true);
  const [sharedRepo] = await db().select().from(repositories).where(eq(repositories.id, shared));

  const revoked = await fixtureRepository();
  await completedRun(revoked);
  await writePublicGrade(revoked, AGENT_READINESS, true);
  await writePublicGrade(revoked, AGENT_READINESS, false);
  const [revokedRepo] = await db().select().from(repositories).where(eq(repositories.id, revoked));

  const never = await fixtureRepository();
  const [neverRepo] = await db().select().from(repositories).where(eq(repositories.id, never));

  const inactive = await fixtureRepository({ active: false });
  const [inactiveRepo] = await db().select().from(repositories).where(eq(repositories.id, inactive));

  const uninstalled = await fixtureRepository({ installationActive: false });
  const [uninstalledRepo] = await db().select().from(repositories).where(eq(repositories.id, uninstalled));

  // writePublicGrade refuses an unconnected repository, so this row is written
  // directly: the lookup must refuse it too, not rely on the writer having.
  const unlinked = await fixtureRepository({ linked: false });
  await db()
    .insert(publicGradeRows)
    .values({ repositoryId: unlinked, graderId: AGENT_READINESS, enabledBy: owner, workspaceId: workspace });
  const [unlinkedRepo] = await db().select().from(repositories).where(eq(repositories.id, unlinked));

  const views = [
    await publicGrade('nobody', 'nothing', AGENT_READINESS),
    await publicGrade(sharedRepo.owner, 'not-this-repo', AGENT_READINESS),
    await publicGrade(sharedRepo.owner, sharedRepo.name, 'nobody/nothing'),
    await publicGrade(revokedRepo.owner, revokedRepo.name, AGENT_READINESS),
    await publicGrade(neverRepo.owner, neverRepo.name, AGENT_READINESS),
    await publicGrade(inactiveRepo.owner, inactiveRepo.name, AGENT_READINESS),
    await publicGrade(uninstalledRepo.owner, uninstalledRepo.name, AGENT_READINESS),
    await publicGrade(unlinkedRepo.owner, unlinkedRepo.name, AGENT_READINESS),
  ];
  for (const view of views) expect(view).toEqual({ state: 'private' });
});

test('demo mode shares nothing', async () => {
  const repositoryId = await fixtureRepository();
  await completedRun(repositoryId);
  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  const [repo] = await db().select().from(repositories).where(eq(repositories.id, repositoryId));
  const previous = process.env.DEMO_MODE;
  process.env.DEMO_MODE = 'true';
  try {
    expect(await publicGrade(repo.owner, repo.name, AGENT_READINESS)).toEqual({ state: 'private' });
  } finally {
    if (previous === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = previous;
  }
});
```

- [ ] **Step 3: Run both to see them fail**

Run: `pnpm vitest run src/db/queries/public-grades.imports.test.ts` and
`DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/public-grades.integration.test.ts`
Expected: FAIL — `./queries/public-grades` does not exist.

- [ ] **Step 4: Implement**

Create `src/db/queries/public-grades.ts`:

```ts
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../index';
import {
  gradeRuns as runs,
  installations,
  publicGrades,
  repositories,
  workspaceRepositories,
} from '../schema';
// A public page is its own serverless entry point, with its own module graph:
// without this import no grader is registered and every address is private.
import '../../domain/grading/graders';
import { getGrader } from '../../domain/grading/registry';
import {
  freshAt,
  isStale,
  publicGradeFrom,
  publicGrader,
  type PublicGradeView,
} from '../../domain/grading/public-grade';

const PRIVATE: PublicGradeView = { state: 'private' };

/**
 * The only thing the public page, the badge and the share image read. No
 * session, no workspace, no cookie: a public request has none. It answers
 * `private` unless every condition holds, and never says which one failed —
 * an unknown repository, a never-shared grade and a revoked one are one
 * answer, so guessing addresses cannot enumerate fieldnote's repositories.
 *
 * Never hand the caller a stored row: publicGradeFrom() copies out the fields
 * a visitor may read, and drops paths entirely for a private repository.
 */
export async function publicGrade(
  owner: string,
  repo: string,
  graderId: string,
  now = new Date(),
): Promise<PublicGradeView> {
  if (process.env.DEMO_MODE === 'true') return PRIVATE;
  let manifest;
  try {
    manifest = getGrader(graderId);
  } catch {
    return PRIVATE;
  }
  // GitHub names are case-insensitive, and two rows for one name would make
  // "which repository is this" a guess — so anything but exactly one match is
  // private.
  const matches = await db()
    .select({
      id: repositories.id,
      owner: repositories.owner,
      name: repositories.name,
      isPrivate: repositories.isPrivate,
    })
    .from(repositories)
    .innerJoin(installations, eq(installations.id, repositories.installationId))
    .innerJoin(
      workspaceRepositories,
      eq(workspaceRepositories.repositoryId, repositories.id),
    )
    .innerJoin(
      publicGrades,
      and(
        eq(publicGrades.repositoryId, repositories.id),
        eq(publicGrades.graderId, graderId),
        isNull(publicGrades.revokedAt),
      ),
    )
    .where(
      and(
        sql`lower(${repositories.owner}) = lower(${owner})`,
        sql`lower(${repositories.name}) = lower(${repo})`,
        eq(repositories.active, true),
        eq(repositories.isDemo, false),
        eq(installations.active, true),
      ),
    )
    .groupBy(repositories.id)
    .limit(2);
  if (matches.length !== 1) return PRIVATE;
  const [match] = matches;
  const repository = { owner: match.owner, name: match.name, isPrivate: match.isPrivate };
  const grader = publicGrader(manifest);
  const [run] = await db()
    .select({
      result: runs.result,
      sha: runs.sha,
      completedAt: runs.completedAt,
      confirmedAt: runs.confirmedAt,
    })
    .from(runs)
    .where(
      and(
        eq(runs.repositoryId, match.id),
        eq(runs.graderId, graderId),
        eq(runs.state, 'complete'),
      ),
    )
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(1);
  if (!run?.result || !run.sha || !run.completedAt)
    return { state: 'ungraded', repository, grader };
  return {
    state: 'graded',
    repository,
    grader,
    grade: publicGradeFrom(
      run.result,
      { sha: run.sha, completedAt: run.completedAt },
      match.isPrivate,
    ),
    stale: isStale(freshAt(run.completedAt, run.confirmedAt), now),
  };
}
```

- [ ] **Step 5: Run both suites**

Run: `pnpm vitest run src/db/queries/public-grades.imports.test.ts && pnpm typecheck && pnpm lint`
Then: `DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/public-grades.integration.test.ts`
Expected: PASS. If the `groupBy` makes Drizzle complain about selected columns, select the four columns in the group by clause as well — do not drop the workspace-link join.

- [ ] **Step 6: Commit**

```bash
git add src/db/queries/public-grades.ts src/db/queries/public-grades.imports.test.ts src/db/public-grades.integration.test.ts
git commit -m "feat(grading): one session-free lookup behind every public surface

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The badge

**Files:**
- Create: `src/domain/grading/badge.ts`, `src/domain/grading/badge.test.ts`
- Create: `src/app/r/[owner]/[repo]/[graderOwner]/[graderName]/badge.svg/route.ts`, and its `route.test.ts`
- Modify: `src/lib/app-routes.ts`, `src/lib/app-routes.test.ts`

**Interfaces:**
- Consumes: `publicGrade` (Task 5), `PublicGradeView` (Task 4), `gradePresentation`.
- Produces:
  - `badgeParts(view: PublicGradeView): { left: string; right: string; color: string }`
  - `renderBadge(view: PublicGradeView): string` — an SVG document
  - `publicGradePath(owner: string, repo: string, graderId: string): string`
  - `publicBadgePath(owner: string, repo: string, graderId: string): string`
  - `GET` at `/r/[owner]/[repo]/[graderOwner]/[graderName]/badge.svg`

- [ ] **Step 1: Write the failing badge tests**

Create `src/domain/grading/badge.test.ts`:

```ts
import { expect, test } from 'vitest';
import { badgeParts, renderBadge } from './badge';
import type { PublicGradeView } from './public-grade';

const grader = {
  id: 'fieldnote/agent-readiness',
  title: 'Agent Readiness',
  author: 'fieldnote',
  mode: 'deterministic' as const,
  category: 'agent-readiness' as const,
  disclaimer: 'Evidence, not certification.',
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  checkTitles: { 'root-readme': 'Project documentation' },
};
const repository = { owner: 'acme', name: 'widgets', isPrivate: false };
const grade = {
  score: 82,
  sha: 'a'.repeat(40),
  computedAt: new Date('2026-09-01T00:00:00.000Z'),
  rubricVersion: '0.1.0',
  evaluatorVersion: '1.0.0',
  checks: [
    {
      id: 'root-readme',
      points: 0,
      maxPoints: 20,
      status: 'fail' as const,
      paths: [],
      lineRanges: [],
      explanation: 'No nonempty root README.md was found. Evidence, not certification.',
    },
  ],
};
const graded: PublicGradeView = { state: 'graded', repository, grader, grade, stale: false };

test('a fresh grade shows its score and label', () => {
  expect(badgeParts(graded)).toEqual({
    left: 'Agent Readiness',
    right: '82 · Very good',
    color: '#697e8d',
  });
});

test('a stale grade shows no number', () => {
  expect(badgeParts({ ...graded, stale: true }).right).toBe('stale');
});

test('an ungraded pair says so', () => {
  expect(badgeParts({ state: 'ungraded', repository, grader }).right).toBe('not graded');
});

test('a private view echoes nothing about what was asked for', () => {
  expect(badgeParts({ state: 'private' })).toEqual({
    left: 'fieldnote',
    right: 'private',
    color: '#6b7280',
  });
});

test('the badge never names a check', () => {
  const svg = renderBadge(graded);
  expect(svg).not.toContain('Project documentation');
  expect(svg).not.toContain('root-readme');
  expect(svg).not.toContain('README');
});

test('a grader title cannot inject markup', () => {
  const svg = renderBadge({
    ...graded,
    grader: { ...grader, title: '</text><script>alert(1)</script>' },
  });
  expect(svg).not.toContain('<script>');
  expect(svg).toContain('&lt;script&gt;');
});

test('the badge is a complete SVG document with an accessible name', () => {
  const svg = renderBadge(graded);
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(svg.endsWith('</svg>')).toBe(true);
  expect(svg).toContain('role="img"');
  expect(svg).toContain('aria-label="Agent Readiness: 82 · Very good"');
});
```

- [ ] **Step 2: Write the failing route and path tests**

Create `src/app/r/[owner]/[repo]/[graderOwner]/[graderName]/badge.svg/route.test.ts`:

```ts
import { beforeEach, expect, test, vi } from 'vitest';

const deps = vi.hoisted(() => ({ publicGrade: vi.fn() }));
vi.mock('../../../../../../../db/queries/public-grades', () => ({ publicGrade: deps.publicGrade }));

const { GET } = await import('./route');

const params = Promise.resolve({
  owner: 'acme',
  repo: 'widgets',
  graderOwner: 'fieldnote',
  graderName: 'agent-readiness',
});

beforeEach(() => {
  vi.resetAllMocks();
  deps.publicGrade.mockResolvedValue({ state: 'private' });
});

test('the grader id is rebuilt from its two segments', async () => {
  await GET(new Request('https://fieldnote.dev/r/acme/widgets/fieldnote/agent-readiness/badge.svg'), {
    params,
  });
  expect(deps.publicGrade).toHaveBeenCalledWith('acme', 'widgets', 'fieldnote/agent-readiness');
});

test('every state answers 200 with an SVG and the same cache policy', async () => {
  const response = await GET(new Request('https://fieldnote.dev/badge.svg'), { params });
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('image/svg+xml; charset=utf-8');
  expect(response.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=300');
  expect(await response.text()).toContain('private');
});
```

In `src/lib/app-routes.test.ts`, append:

```ts
test('a public grade has one readable address, and its badge sits beneath it', () => {
  expect(publicGradePath('acme', 'widgets', 'fieldnote/agent-readiness')).toBe(
    '/r/acme/widgets/fieldnote/agent-readiness',
  );
  expect(publicBadgePath('acme', 'widgets', 'fieldnote/agent-readiness')).toBe(
    '/r/acme/widgets/fieldnote/agent-readiness/badge.svg',
  );
  expect(publicGradePath('a c', 'w/d', 'fieldnote/agent-readiness')).toBe(
    '/r/a%20c/w%2Fd/fieldnote/agent-readiness',
  );
});
```

(add `publicGradePath, publicBadgePath` to that file's import from `./app-routes`).

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run src/domain/grading/badge.test.ts src/lib/app-routes.test.ts "src/app/r"`
Expected: FAIL — nothing exists yet.

- [ ] **Step 4: Implement the renderer**

Create `src/domain/grading/badge.ts`:

```ts
import { gradePresentation } from './presentation';
import type { PublicGradeView } from './public-grade';

// Not a finish colour: a neutral badge means "no number to show", which is a
// different statement from a low score.
const NEUTRAL = '#6b7280';

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );

// Verdana at 11px averages a little over six pixels a character. Close enough
// for a pill nobody measures, and it needs no font metrics at request time.
const width = (text: string) => Math.round(text.length * 6.5) + 20;

/**
 * What the two halves say. A private view echoes nothing from the address it
 * was asked about — not the repository, not the grader — so every unshared
 * address renders the same bytes.
 */
export function badgeParts(view: PublicGradeView): { left: string; right: string; color: string } {
  if (view.state === 'private') return { left: 'fieldnote', right: 'private', color: NEUTRAL };
  if (view.state === 'ungraded')
    return { left: view.grader.title, right: 'not graded', color: NEUTRAL };
  if (view.stale) return { left: view.grader.title, right: 'stale', color: NEUTRAL };
  const presentation = gradePresentation(view.grade.score);
  return {
    left: view.grader.title,
    right: `${view.grade.score} · ${presentation.label}`,
    color: presentation.color,
  };
}

/**
 * The README pill: a score and a finish, never a failing check. Evidence
 * requires the click, which is the rule slice 1 recorded and the reason this
 * function never reads `grade.checks`.
 */
export function renderBadge(view: PublicGradeView): string {
  const { left, right, color } = badgeParts(view);
  const leftWidth = width(left);
  const rightWidth = width(right);
  const label = `${left}: ${right}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${leftWidth + rightWidth}" height="20" role="img" aria-label="${escape(label)}">` +
    `<title>${escape(label)}</title>` +
    `<rect width="${leftWidth}" height="20" fill="#3c4450"/>` +
    `<rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${color}"/>` +
    `<g fill="#ffffff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">` +
    `<text x="${leftWidth / 2}" y="14">${escape(left)}</text>` +
    `<text x="${leftWidth + rightWidth / 2}" y="14">${escape(right)}</text>` +
    `</g></svg>`
  );
}
```

- [ ] **Step 5: Implement the paths and the route**

In `src/lib/app-routes.ts`, after the repository helpers:

```ts
// The public surface. Readable on purpose: a badge has to be recognisable in a
// README to do its job. A grader id is `owner/name`, and it stays two segments
// here so a route beneath it (badge.svg) is possible at all.
export function publicGradePath(owner: string, repo: string, graderId: string): string {
  const [graderOwner, graderName] = graderId.split('/');
  return `/r/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(graderOwner)}/${encodeURIComponent(graderName)}`;
}

export function publicBadgePath(owner: string, repo: string, graderId: string): string {
  return `${publicGradePath(owner, repo, graderId)}/badge.svg`;
}
```

Create `src/app/r/[owner]/[repo]/[graderOwner]/[graderName]/badge.svg/route.ts`:

```ts
import { publicGrade } from '../../../../../../../db/queries/public-grades';
import { renderBadge } from '../../../../../../../domain/grading/badge';

export const dynamic = 'force-dynamic';

/**
 * The README pill. Always 200, always an SVG, always the same cache policy:
 * a private answer that looked different from a shared one — a 404, a shorter
 * cache — would let anyone enumerate which repositories fieldnote grades.
 *
 * Five minutes is the compromise the design names: GitHub proxies README
 * images, so a busy README must not reach the database on every view, and the
 * cost is that revoking sharing takes up to that long to reach a cached badge.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ owner: string; repo: string; graderOwner: string; graderName: string }> },
) {
  const { owner, repo, graderOwner, graderName } = await params;
  const view = await publicGrade(owner, repo, `${graderOwner}/${graderName}`);
  return new Response(renderBadge(view), {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
```

- [ ] **Step 6: Run them to see them pass**

Run: `pnpm vitest run src/domain/grading/badge.test.ts src/lib/app-routes.test.ts "src/app/r" && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS, and the build lists the new route. If `tsc` rejects the relative import depth, count the segments again from the route file to `src/` — do not switch to a path alias, which vitest does not resolve.

- [ ] **Step 7: Commit**

```bash
git add src/domain/grading/badge.ts src/domain/grading/badge.test.ts src/lib/app-routes.ts src/lib/app-routes.test.ts "src/app/r"
git commit -m "feat(grading): a README badge that shows a score and never a check

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The public page

**Files:**
- Create: `src/app/r/[owner]/[repo]/[graderOwner]/[graderName]/page.tsx`, `public-grade.css`, `page.test.ts`
- Modify: `src/components/grading/report.tsx` (`GradeReport`'s grade prop)

**Interfaces:**
- Consumes: `publicGrade` (Task 5), `gradeCardProps` (`src/components/grading/grade-presentation.ts`), `GradeReport`.
- Produces: the page and `generateMetadata`; `GradeReport` accepts `grade: Omit<CompletedGrade, 'id'>`.

- [ ] **Step 1: Widen `GradeReport`'s prop**

In `src/components/grading/report.tsx`, change the `GradeReport` prop type from `grade: CompletedGrade` to:

```ts
  // Omit<…, 'id'>: the public page builds its own narrow grade with no run id,
  // and this component never reads one.
  grade: Omit<CompletedGrade, 'id'>;
```

Confirm with `grep -n "grade\.id" src/components/grading/report.tsx` that nothing reads it (expected: no output).

- [ ] **Step 2: Write the failing page tests**

Create `src/app/r/[owner]/[repo]/[graderOwner]/[graderName]/page.test.ts`:

```ts
import { expect, test, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const deps = vi.hoisted(() => ({ publicGrade: vi.fn() }));
vi.mock('../../../../../../db/queries/public-grades', () => ({ publicGrade: deps.publicGrade }));

const { default: PublicGrade, generateMetadata } = await import('./page');
const { agentReadinessManifest } = await import('../../../../../../domain/grading/graders/agent-readiness');
const { publicGrader } = await import('../../../../../../domain/grading/public-grade');

const grader = publicGrader(agentReadinessManifest);
const repository = { owner: 'acme', name: 'widgets', isPrivate: false };
const grade = {
  score: 80,
  sha: 'a'.repeat(40),
  computedAt: new Date('2026-09-01T00:00:00.000Z'),
  rubricVersion: agentReadinessManifest.version,
  evaluatorVersion: agentReadinessManifest.evaluatorVersion,
  checks: [
    {
      id: 'root-readme',
      points: 20,
      maxPoints: 20,
      status: 'pass' as const,
      paths: ['README.md'],
      lineRanges: [],
      explanation: 'Found a root README.md. Evidence, not certification.',
    },
  ],
};
const params = (owner = 'acme', repo = 'widgets') =>
  Promise.resolve({ owner, repo, graderOwner: 'fieldnote', graderName: 'agent-readiness' });

beforeEach(() => {
  vi.resetAllMocks();
});

test('a graded page shows the card, the commit and the checks', async () => {
  deps.publicGrade.mockResolvedValue({ state: 'graded', repository, grader, grade, stale: false });
  const html = renderToStaticMarkup(await PublicGrade({ params: params() }));
  expect(html).toContain('Agent Readiness');
  expect(html).toContain('acme / widgets');
  expect(html).toContain('aaaaaaa');
  expect(html).toContain('Found a root README.md');
  expect(html).not.toContain('more than 30 days');
});

test('a stale grade says so on the page', async () => {
  deps.publicGrade.mockResolvedValue({ state: 'graded', repository, grader, grade, stale: true });
  const html = renderToStaticMarkup(await PublicGrade({ params: params() }));
  expect(html).toContain('more than 30 days');
});

test('an ungraded pair invites nothing and claims nothing', async () => {
  deps.publicGrade.mockResolvedValue({ state: 'ungraded', repository, grader });
  const html = renderToStaticMarkup(await PublicGrade({ params: params() }));
  expect(html).toContain('Not graded yet.');
  expect(html).not.toContain('out of 100');
});

test('every private address renders the same page, whatever was asked for', async () => {
  deps.publicGrade.mockResolvedValue({ state: 'private' });
  const first = renderToStaticMarkup(await PublicGrade({ params: params('acme', 'widgets') }));
  const second = renderToStaticMarkup(await PublicGrade({ params: params('someone', 'secret-repo') }));
  expect(first).toBe(second);
  expect(first).toContain('This grade is private.');
  expect(first).not.toContain('secret-repo');
  expect(first).not.toContain('acme');
});

test('a private page is not indexed, and a graded one is', async () => {
  deps.publicGrade.mockResolvedValue({ state: 'private' });
  expect(await generateMetadata({ params: params() })).toMatchObject({
    robots: { index: false, follow: false },
  });
  deps.publicGrade.mockResolvedValue({ state: 'graded', repository, grader, grade, stale: false });
  const metadata = await generateMetadata({ params: params() });
  expect(metadata.robots).toBeUndefined();
  expect(metadata.title).toContain('Agent Readiness');
});

test('the grader id is rebuilt from its two segments', async () => {
  deps.publicGrade.mockResolvedValue({ state: 'private' });
  await PublicGrade({ params: params() });
  expect(deps.publicGrade).toHaveBeenCalledWith('acme', 'widgets', 'fieldnote/agent-readiness');
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm vitest run "src/app/r"`
Expected: FAIL — `./page` does not exist.

- [ ] **Step 4: Implement the page**

Create `src/app/r/[owner]/[repo]/[graderOwner]/[graderName]/public-grade.css`:

```css
.public-grade {
  max-width: 960px;
  margin: 0 auto;
  padding: 32px 16px;
  display: grid;
  gap: 24px;
}
.public-grade-stale {
  color: #6b7280;
}
.public-grade-footer {
  color: #6b7280;
  font-size: 14px;
}
```

Create `src/app/r/[owner]/[repo]/[graderOwner]/[graderName]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { GradeCard, Surface } from '@fieldnote/design-system';
import { publicGrade } from '../../../../../../db/queries/public-grades';
import type { PublicGradeView } from '../../../../../../domain/grading/public-grade';
import { gradeCardProps } from '../../../../../../components/grading/grade-presentation';
import { GradeReport } from '../../../../../../components/grading/report';
import './public-grade.css';

export const dynamic = 'force-dynamic';

type Params = Promise<{ owner: string; repo: string; graderOwner: string; graderName: string }>;

async function view(params: Params): Promise<PublicGradeView> {
  const { owner, repo, graderOwner, graderName } = await params;
  return publicGrade(owner, repo, `${graderOwner}/${graderName}`);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const resolved = await view(params);
  // A private page says nothing and is not indexed — including nothing about
  // the address that was asked for.
  if (resolved.state === 'private')
    return { title: 'Private grade', robots: { index: false, follow: false } };
  return {
    title: `${resolved.grader.title} · ${resolved.repository.owner}/${resolved.repository.name}`,
    description: `${resolved.grader.title}, graded by fieldnote.`,
  };
}

export default async function PublicGrade({ params }: { params: Params }) {
  const resolved = await view(params);
  return (
    <main id="main-content" className="public-grade">
      {resolved.state === 'private' ? (
        <Surface className="public-grade-private">
          <h1>This grade is private.</h1>
          <p>Nobody has shared this grade publicly, or it does not exist.</p>
        </Surface>
      ) : resolved.state === 'ungraded' ? (
        <Surface>
          <h1>{resolved.grader.title}</h1>
          <p>Not graded yet.</p>
        </Surface>
      ) : (
        <>
          <GradeCard
            {...gradeCardProps({
              score: resolved.grade.score,
              repositoryName: `${resolved.repository.owner} / ${resolved.repository.name}`,
              sha: resolved.grade.sha,
              rubricVersion: resolved.grade.rubricVersion,
              checks: resolved.grade.checks,
              graderId: resolved.grader.id,
            })}
          />
          {resolved.stale && (
            <p className="public-grade-stale">
              This grade is more than 30 days old and has not been re-checked since.
            </p>
          )}
          <GradeReport
            grade={resolved.grade}
            owner={resolved.repository.owner}
            name={resolved.repository.name}
            checkTitles={resolved.grader.checkTitles}
            graderTitle={resolved.grader.title}
            disclaimer={resolved.grader.disclaimer}
            outdated={
              resolved.grade.rubricVersion !== resolved.grader.version ||
              resolved.grade.evaluatorVersion !== resolved.grader.evaluatorVersion
            }
          />
        </>
      )}
      <p className="public-grade-footer">
        <Link href="/">Graded by fieldnote</Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `pnpm vitest run "src/app/r" src/components/grading && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS. If the private-page test fails only because the footer link differs between renders, it must not — the footer is identical; investigate what else in the markup varies with the params.

- [ ] **Step 6: Commit**

```bash
git add "src/app/r" src/components/grading/report.tsx
git commit -m "feat(grading): a public page for a shared grade

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The switch on the grades page

**Files:**
- Create: `src/components/grading/share-toggle.tsx`
- Modify: `src/app/app/repos/[repoId]/grading/page.tsx`, `src/components/grading/report.css`
- Test: `src/app/app/repos/[repoId]/grading/page.test.ts`, `src/components/grading/share-toggle.test.ts` (new)

**Interfaces:**
- Consumes: `setPublicGrade` (Task 3), `publicGradeSettings` (Task 3), `publicGradePath`/`publicBadgePath` (Task 6).
- Produces: `<ShareToggle repositoryId graderId graderTitle shared canShare isPrivate pagePath badgePath baseUrl />`

- [ ] **Step 1: Write the failing component tests**

Create `src/components/grading/share-toggle.test.ts`:

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

vi.mock('../../app/app/repos/[repoId]/grading/actions', () => ({ setPublicGrade: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { ShareToggle } = await import('./share-toggle');

const props = {
  repositoryId: 'repo',
  graderId: 'fieldnote/agent-readiness',
  graderTitle: 'Agent Readiness',
  pagePath: '/r/acme/widgets/fieldnote/agent-readiness',
  badgePath: '/r/acme/widgets/fieldnote/agent-readiness/badge.svg',
  baseUrl: 'https://fieldnote.dev',
  isPrivate: false,
  shared: false,
  canShare: true,
};
const render = (over: Partial<typeof props> = {}) =>
  renderToStaticMarkup(createElement(ShareToggle, { ...props, ...over }));

test('an owner is offered the switch', () => {
  expect(render()).toContain('Share publicly');
});

test('a shared grade shows the link and the Markdown to paste', () => {
  const html = render({ shared: true });
  expect(html).toContain('Stop sharing publicly');
  expect(html).toContain('https://fieldnote.dev/r/acme/widgets/fieldnote/agent-readiness');
  expect(html).toContain(
    '[![Agent Readiness](https://fieldnote.dev/r/acme/widgets/fieldnote/agent-readiness/badge.svg)](https://fieldnote.dev/r/acme/widgets/fieldnote/agent-readiness)',
  );
});

test('a member sees the state and no control', () => {
  const off = render({ canShare: false });
  expect(off).toContain('A workspace owner');
  expect(off).not.toContain('<button');
  expect(render({ canShare: false, shared: true })).toContain('Shared publicly');
});

test('a private repository is told what sharing reveals', () => {
  expect(render({ isPrivate: true })).toContain('never file names');
  expect(render({ isPrivate: false })).not.toContain('never file names');
});
```

- [ ] **Step 2: Write the failing page tests**

In `src/app/app/repos/[repoId]/grading/page.test.ts`: add `requireWorkspace: deps.workspace` to the `workspaces/access` mock and `workspace: vi.fn()` plus `publicSettings: vi.fn()` to `deps`; mock the new query module and component:

```ts
vi.mock('../../../../../db/queries/public-grade-settings', () => ({
  publicGradeSettings: deps.publicSettings,
}));
vi.mock('../../../../../components/grading/share-toggle', () => ({
  ShareToggle: ({ graderId, shared, canShare }: { graderId: string; shared: boolean; canShare: boolean }) =>
    createElement('p', null, `share:${graderId}:${shared ? 'on' : 'off'}:${canShare ? 'owner' : 'member'}`),
}));
```

In `beforeEach`, add `deps.workspace.mockResolvedValue({ id: 'workspace', name: 'W', role: 'owner' });` and `deps.publicSettings.mockResolvedValue({});`, then append:

```ts
test('an owner gets the sharing switch for the selected grader', async () => {
  deps.publicSettings.mockResolvedValue({ 'fieldnote/agent-readiness': { shared: true } });
  const html = renderToStaticMarkup(await call());
  expect(html).toContain('share:fieldnote/agent-readiness:on:owner');
});

test('a member gets the state without the control', async () => {
  deps.workspace.mockResolvedValue({ id: 'workspace', name: 'W', role: 'member' });
  const html = renderToStaticMarkup(await call());
  expect(html).toContain('share:fieldnote/agent-readiness:off:member');
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run src/components/grading/share-toggle.test.ts "src/app/app/repos/[repoId]/grading"`
Expected: FAIL — the component and the wiring do not exist.

- [ ] **Step 4: Implement the component**

Create `src/components/grading/share-toggle.tsx`:

```tsx
'use client';
import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@fieldnote/design-system';
import { setPublicGrade } from '../../app/app/repos/[repoId]/grading/actions';

/**
 * Sharing one grader's grade publicly, for one repository.
 *
 * Owners only — making something public is a bigger step than running a grade —
 * and a member sees the state rather than a control that would refuse them.
 * Turning it off keeps the link alive as `private`, so the copy says "stop
 * sharing", not "delete".
 */
export function ShareToggle({
  repositoryId,
  graderId,
  graderTitle,
  shared,
  canShare,
  isPrivate,
  pagePath,
  badgePath,
  baseUrl,
}: {
  repositoryId: string;
  graderId: string;
  graderTitle: string;
  shared: boolean;
  canShare: boolean;
  isPrivate: boolean;
  pagePath: string;
  badgePath: string;
  baseUrl: string;
}) {
  const router = useRouter();
  const [error, action, pending] = useActionState(async () => {
    try {
      await setPublicGrade(repositoryId, graderId, !shared);
      router.refresh();
      return '';
    } catch {
      return 'Could not change sharing. A workspace owner can share a grade publicly.';
    }
  }, '');
  const pageUrl = `${baseUrl}${pagePath}`;
  const markdown = `[![${graderTitle}](${baseUrl}${badgePath})](${pageUrl})`;
  return (
    <div className="grade-share">
      {canShare ? (
        <form action={action}>
          <Button disabled={pending}>
            {pending ? 'Saving…' : shared ? 'Stop sharing publicly' : 'Share publicly'}
          </Button>
        </form>
      ) : (
        <p className="muted">
          {shared
            ? 'Shared publicly. A workspace owner can stop sharing it.'
            : 'Not shared. A workspace owner can share this grade publicly.'}
        </p>
      )}
      {shared && (
        <>
          <p>
            Public page: <a href={pageUrl}>{pageUrl}</a>
          </p>
          <pre className="grade-share-markdown">
            <code>{markdown}</code>
          </pre>
        </>
      )}
      {canShare && !shared && isPrivate && (
        <p className="muted">
          This repository is private. Sharing shows its score, check names and counts — never file
          names.
        </p>
      )}
      <p role="status">{error}</p>
    </div>
  );
}
```

Append to `src/components/grading/report.css` (px and physical properties, as that file already does):

```css
.grade-share {
  margin-top: 16px;
}
.grade-share-markdown {
  overflow-x: auto;
  padding: 8px;
  font-size: 13px;
}
```

- [ ] **Step 5: Wire the page**

In `src/app/app/repos/[repoId]/grading/page.tsx`:

```ts
import { requireRepository, requireWorkspace } from '../../../../../workspaces/access';
import { publicGradeSettings } from '../../../../../db/queries/public-grade-settings';
import { ShareToggle } from '../../../../../components/grading/share-toggle';
import { publicBadgePath, publicGradePath, repoSectionPath } from '../../../../../lib/app-routes';
```

Add `publicGradeSettings(repoId)` and `requireWorkspace()` to the existing `Promise.all` (destructure as `sharing` and `workspace`), and render after `<ScheduleToggle …>`:

```tsx
      <ShareToggle
        repositoryId={repoId}
        graderId={selectedGrader.id}
        graderTitle={selectedGrader.card.title}
        shared={sharing[selectedGrader.id]?.shared ?? false}
        canShare={workspace.role === 'owner' && !repo.isDemo}
        isPrivate={repo.isPrivate}
        pagePath={publicGradePath(repo.owner, repo.name, selectedGrader.id)}
        badgePath={publicBadgePath(repo.owner, repo.name, selectedGrader.id)}
        // A README needs an absolute URL. APP_URL is absent in demo mode, where
        // sharing is refused anyway, so an empty base is never pasted anywhere.
        baseUrl={process.env.APP_URL ?? ''}
      />
```

- [ ] **Step 6: Run them to see them pass**

Run: `pnpm vitest run src/components/grading "src/app/app/repos/[repoId]/grading" && pnpm typecheck && pnpm lint`
Expected: PASS. If the page test's repository fixture lacks `isPrivate`, add it there rather than defaulting it in the page.

- [ ] **Step 7: Commit**

```bash
git add src/components/grading/share-toggle.tsx src/components/grading/share-toggle.test.ts src/components/grading/report.css "src/app/app/repos/[repoId]/grading/page.tsx" "src/app/app/repos/[repoId]/grading/page.test.ts"
git commit -m "feat(grading): an owner's switch, and the Markdown to paste

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The share image

**Files:**
- Create: `src/components/grading/og-card.tsx`, `src/components/grading/og-card.test.ts`
- Create: `src/app/r/[owner]/[repo]/[graderOwner]/[graderName]/opengraph-image.tsx`

**Interfaces:**
- Consumes: `publicGrade` (Task 5), `gradePresentation`.
- Produces: `OgCard({ view }: { view: PublicGradeView })` — plain JSX with inline styles; the `opengraph-image` route.

- [ ] **Step 1: Read the reference**

Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/opengraph-image.md` (the `params`, `alt`, `size`, `contentType` sections) and `…/04-functions/image-response.md`. This repository's Next is not the one in your memory; follow what those files say.

- [ ] **Step 2: Write the failing card tests**

Create `src/components/grading/og-card.test.ts`:

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { OgCard } from './og-card';
import { publicGrader } from '../../domain/grading/public-grade';
import { agentReadinessManifest } from '../../domain/grading/graders/agent-readiness';

const grader = publicGrader(agentReadinessManifest);
const repository = { owner: 'acme', name: 'widgets', isPrivate: false };
const grade = {
  score: 80,
  sha: 'a'.repeat(40),
  computedAt: new Date('2026-09-01T00:00:00.000Z'),
  rubricVersion: '0.1.0',
  evaluatorVersion: '1.0.0',
  checks: [
    {
      id: 'root-readme',
      points: 20,
      maxPoints: 20,
      status: 'pass' as const,
      paths: ['README.md'],
      lineRanges: [],
      explanation: 'Found a root README.md.',
    },
  ],
};
const render = (view: Parameters<typeof OgCard>[0]['view']) =>
  renderToStaticMarkup(createElement(OgCard, { view }));

test('a graded image shows the score, the grader and the repository', () => {
  const html = render({ state: 'graded', repository, grader, grade, stale: false });
  expect(html).toContain('80');
  expect(html).toContain('Very good');
  expect(html).toContain('Agent Readiness');
  expect(html).toContain('acme/widgets');
});

test('an image never carries a check or a file name', () => {
  const html = render({ state: 'graded', repository, grader, grade, stale: false });
  expect(html).not.toContain('README.md');
  expect(html).not.toContain('Project documentation');
});

test('a stale image says stale and no number', () => {
  const html = render({ state: 'graded', repository, grader, grade, stale: true });
  expect(html).toContain('stale');
  expect(html).not.toContain('>80<');
});

test('a private image says only fieldnote', () => {
  const html = render({ state: 'private' });
  expect(html).toContain('fieldnote');
  expect(html).not.toContain('acme');
  expect(html).not.toContain('Agent Readiness');
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm vitest run src/components/grading/og-card.test.ts`
Expected: FAIL — `./og-card` does not exist.

- [ ] **Step 4: Implement the card and the route**

Create `src/components/grading/og-card.tsx`:

```tsx
import { gradePresentation } from '../../domain/grading/presentation';
import type { PublicGradeView } from '../../domain/grading/public-grade';

/**
 * The image a pasted link shows in Slack or X. The card and nothing else: no
 * check, no file name, and for a private view nothing about the address that
 * was asked for.
 *
 * Every element sets `display: flex` because satori — the renderer behind
 * ImageResponse — supports no other layout for a container with children.
 */
export function OgCard({ view }: { view: PublicGradeView }) {
  const row = { display: 'flex', flexDirection: 'column' as const, gap: '16px' };
  const frame = {
    display: 'flex',
    width: '100%',
    height: '100%',
    padding: '64px',
    background: '#faf7f0',
    color: '#1f2933',
    fontSize: '40px',
    alignItems: 'center',
    justifyContent: 'space-between',
  };
  if (view.state === 'private')
    return (
      <div style={frame}>
        <div style={row}>
          <div style={{ display: 'flex', fontSize: '64px' }}>fieldnote</div>
          <div style={{ display: 'flex' }}>A private grade.</div>
        </div>
      </div>
    );
  const headline =
    view.state === 'ungraded'
      ? 'Not graded yet'
      : view.stale
        ? 'stale'
        : `${view.grade.score} · ${gradePresentation(view.grade.score).label}`;
  const colour =
    view.state === 'graded' && !view.stale ? gradePresentation(view.grade.score).color : '#6b7280';
  return (
    <div style={frame}>
      <div style={row}>
        <div style={{ display: 'flex', fontSize: '32px', color: '#6b7280' }}>
          {view.repository.owner}/{view.repository.name}
        </div>
        <div style={{ display: 'flex', fontSize: '64px' }}>{view.grader.title}</div>
        <div style={{ display: 'flex', fontSize: '32px', color: '#6b7280' }}>fieldnote</div>
      </div>
      <div style={{ display: 'flex', fontSize: '96px', color: colour }}>{headline}</div>
    </div>
  );
}
```

Create `src/app/r/[owner]/[repo]/[graderOwner]/[graderName]/opengraph-image.tsx`:

```tsx
import { ImageResponse } from 'next/og';
import { publicGrade } from '../../../../../../db/queries/public-grades';
import { OgCard } from '../../../../../../components/grading/og-card';

export const alt = 'A grade, by fieldnote';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({
  params,
}: {
  params: Promise<{ owner: string; repo: string; graderOwner: string; graderName: string }>;
}) {
  const { owner, repo, graderOwner, graderName } = await params;
  const view = await publicGrade(owner, repo, `${graderOwner}/${graderName}`);
  return new ImageResponse(<OgCard view={view} />, size);
}
```

- [ ] **Step 5: Run and build**

Run: `pnpm vitest run src/components/grading/og-card.test.ts && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS, and the build lists the `opengraph-image` route. If `next/og` needs a runtime export in this version, add exactly what the reference file says and note it in your report.

- [ ] **Step 6: Commit**

```bash
git add src/components/grading/og-card.tsx src/components/grading/og-card.test.ts "src/app/r"
git commit -m "feat(grading): a share image that shows the card and nothing else

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: The indistinguishability proof, end to end

**Files:**
- Modify: `src/db/public-grades.integration.test.ts`

**Interfaces:**
- Consumes: everything above: the page component, the badge route, `writePublicGrade`, the fixtures already in this file.

- [ ] **Step 1: Write the test**

Append to `src/db/public-grades.integration.test.ts` (add `renderToStaticMarkup` from `react-dom/server`, the page and the route):

```ts
import { renderToStaticMarkup } from 'react-dom/server';
const { default: PublicGradePage } = await import(
  '../app/r/[owner]/[repo]/[graderOwner]/[graderName]/page'
);
const { GET: badge } = await import(
  '../app/r/[owner]/[repo]/[graderOwner]/[graderName]/badge.svg/route'
);

const address = (owner: string, repo: string, graderId = AGENT_READINESS) => {
  const [graderOwner, graderName] = graderId.split('/');
  return Promise.resolve({ owner, repo, graderOwner, graderName });
};
const pageHtml = async (owner: string, repo: string, graderId = AGENT_READINESS) =>
  renderToStaticMarkup(await PublicGradePage({ params: address(owner, repo, graderId) }));
const badgeSvg = async (owner: string, repo: string, graderId = AGENT_READINESS) => {
  const response = await badge(new Request('https://fieldnote.dev/badge.svg'), {
    params: address(owner, repo, graderId),
  });
  return { status: response.status, body: await response.text() };
};

test('every private answer is byte-identical, page and badge alike', async () => {
  const revoked = await fixtureRepository();
  await completedRun(revoked);
  await writePublicGrade(revoked, AGENT_READINESS, true);
  await writePublicGrade(revoked, AGENT_READINESS, false);
  const [revokedRepo] = await db().select().from(repositories).where(eq(repositories.id, revoked));
  const never = await fixtureRepository();
  const [neverRepo] = await db().select().from(repositories).where(eq(repositories.id, never));
  const inactive = await fixtureRepository({ active: false });
  const [inactiveRepo] = await db().select().from(repositories).where(eq(repositories.id, inactive));
  const uninstalled = await fixtureRepository({ installationActive: false });
  const [uninstalledRepo] = await db()
    .select()
    .from(repositories)
    .where(eq(repositories.id, uninstalled));
  const unlinked = await fixtureRepository({ linked: false });
  await db()
    .insert(publicGradeRows)
    .values({ repositoryId: unlinked, graderId: AGENT_READINESS, enabledBy: owner, workspaceId: workspace });
  const [unlinkedRepo] = await db().select().from(repositories).where(eq(repositories.id, unlinked));

  const cases: [string, string, string?][] = [
    ['nobody', 'nothing'],
    [revokedRepo.owner, revokedRepo.name],
    [neverRepo.owner, neverRepo.name],
    [inactiveRepo.owner, inactiveRepo.name],
    [uninstalledRepo.owner, uninstalledRepo.name],
    [unlinkedRepo.owner, unlinkedRepo.name],
    [revokedRepo.owner, revokedRepo.name, 'nobody/nothing'],
  ];
  const pages = await Promise.all(cases.map(([owner, repo, grader]) => pageHtml(owner, repo, grader)));
  const badges = await Promise.all(cases.map(([owner, repo, grader]) => badgeSvg(owner, repo, grader)));
  for (const html of pages) expect(html).toBe(pages[0]);
  for (const svg of badges) expect(svg).toEqual(badges[0]);
  expect(pages[0]).toContain('This grade is private.');
  expect(badges[0].status).toBe(200);
  expect(badges[0].body).toContain('private');
});

test('sharing, revoking and sharing again is visible end to end', async () => {
  const repositoryId = await fixtureRepository();
  await completedRun(repositoryId);
  const [repo] = await db().select().from(repositories).where(eq(repositories.id, repositoryId));

  expect(await pageHtml(repo.owner, repo.name)).toContain('This grade is private.');

  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  const shared = await pageHtml(repo.owner, repo.name);
  expect(shared).toContain(agentReadinessManifest.card.title);
  expect((await badgeSvg(repo.owner, repo.name)).body).toContain('·');

  await writePublicGrade(repositoryId, AGENT_READINESS, false);
  expect(await pageHtml(repo.owner, repo.name)).toContain('This grade is private.');

  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  expect(await pageHtml(repo.owner, repo.name)).toContain(agentReadinessManifest.card.title);
});

test("a private repository's public page shows no file name", async () => {
  const repositoryId = await fixtureRepository({ isPrivate: true });
  await completedRun(repositoryId);
  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  const [repo] = await db().select().from(repositories).where(eq(repositories.id, repositoryId));
  const html = await pageHtml(repo.owner, repo.name);
  expect(html).toContain(agentReadinessManifest.card.title);
  expect(html).not.toContain('README.md');
});
```

- [ ] **Step 2: Run it**

Run: `DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/public-grades.integration.test.ts`
Expected: PASS. If rendering the page inside the integration runner fails because a component needs a browser API, mock only that component in this file and say so in your report — do not weaken the byte-identical assertions.

- [ ] **Step 3: Commit**

```bash
git add src/db/public-grades.integration.test.ts
git commit -m "test(grading): every private address answers with the same bytes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Final gate

```bash
pnpm lint && pnpm typecheck && pnpm test && DEMO_MODE=false pnpm test:integration && pnpm build
```

Expected: lint, typecheck, test and build green; integration green apart from the 2 known `dispatch-import.integration.test.ts` failures. `git diff main -- src/domain/grading/readiness-v01.test.ts` prints nothing, and `pnpm vitest run src/domain/grading/graders/frozen-rubrics.test.ts` passes unchanged — no manifest moved.
