# Grader Factory Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a grader receive exactly the evidence it declared, and make a run say what it was pinned to — then let a schedule create those runs nightly without a session.

**Architecture:** The hardcoded readiness collector becomes a general `repo.files` collector that matches the globs a manifest declared, and `src/grading/evidence.ts` becomes the broker that fans a manifest's `needs` out to collectors and pins a metrics window to the run's `created_at`. A floor miss stops being a failed run and becomes its own `insufficient` state that stores its result. A new `grade_schedules` table and a nightly Inngest cron create runs through a session-free half of `requestGrade()`.

**Tech Stack:** TypeScript, Next.js 16 (App Router), Drizzle ORM + Postgres, Inngest, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-14-grader-factory-slice-3-design.md`

## Global Constraints

- **`src/domain/grading/readiness-v01.test.ts` must stay byte-identical to `main` and pass.** It is the acceptance test for every slice. If it fails, the production change is wrong. Editing it is never the fix. Verify with `git diff main -- src/domain/grading/readiness-v01.test.ts` returning empty.
- **A built-in grader is an ordinary grader.** No `if` naming a grader id inside `src/domain/grading` or `src/grading`. No private interface, no extra evidence, no code path of its own.
- **Do not remove the side-effect import `import '../../domain/grading/graders';` in `src/db/queries/grade-runs.ts`.** It has no bindings because its job is the import. Removing it silently brings back `unknown_grader` in the Inngest worker. It is regression-tested.
- **Never run `git add -A` or `git add .`.** Stage explicit paths only.
- **Do not touch `.agents/`, `.claude/` or `skills-lock.json`.** Untracked, belonging to other concerns.
- **`eslint .` walks sibling worktrees under `.claude/worktrees/`.** Failures reported from paths under `.claude/` are not ours.
- **Every commit message ends with these two lines**, separated from the body by a blank line:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XYMLqoucHKuCv2mpJeEJXL
  ```
- **Caps are fixed and stay exactly as they are:** 10 000 tree entries, 200 documents, 128 KiB per file, 2 MiB in total, 30 s wall clock per request.
- **The gate** is `pnpm check` (lint, typecheck, test, test:integration, build). The integration run needs `DEMO_MODE=false` on the command line: `DEMO_MODE=false pnpm test:integration`.
- **Known baseline:** 2 failures of 171 in `src/inngest/dispatch-import.integration.test.ts` (a `LIMIT 100` assertion against an accumulated test database). They reproduce on `main` and are not yours. Another session may share the test database — re-run before concluding a `grade-runs.integration.test.ts` failure is real.
- **Branch:** work continues on `feat/grader-factory`, stacked under PR #26, by the user's explicit decision.
- Run unit tests with `pnpm vitest run <path>` for a single file; `pnpm test` for the whole unit suite.

---

## File Structure

**The broker**

| File | Responsibility |
| --- | --- |
| `src/github/collect-files.ts` *(renamed from `collect-readiness.ts`)* | The `repo.files` collector. Fetches the documents matching a caller's glob patterns at a pinned sha, under fixed caps. Exports `collectFiles`, `resolveHeadSha`, `FileCollectionError`, `FileCollectionErrorCode`. |
| `src/github/collect-files.test.ts` *(renamed and edited)* | Every case the readiness collector test had, driven through declared globs, plus the new glob cases. |
| `src/grading/evidence.ts` *(body replaced, path and export kept)* | The broker. Fans a manifest's `needs` out to collectors, pins the metrics window to the run's request time, and reports which failure to name. |
| `src/grading/evidence.test.ts` *(edited)* | Broker behaviour: which collectors a manifest reaches, what it is pinned to, which code a partial read produces. |

**The contract**

| File | Responsibility |
| --- | --- |
| `src/domain/grading/manifest.ts` *(modified)* | Two new registration invariants (`needs_too_broad`, `subject_mismatch`) and a second accepted `subject`. |
| `src/domain/grading/manifest.test.ts` *(edited)* | One case per new invariant, each distinguishable by code. |
| `src/domain/grading/graders/delivery-health.ts` *(modified)* | Version 0.2.0, `subject: repository_window`. |

**The `insufficient` state**

| File | Responsibility |
| --- | --- |
| `src/db/schema.ts` *(modified)* | The widened state union, the two rewritten check constraints, the `trigger` column, the `grade_schedules` table. |
| `drizzle/0013_grade_insufficient.sql` *(new)* | State and result constraints. |
| `drizzle/0014_grade_schedules.sql` *(new)* | `grade_schedules`, and `grade_runs.trigger`. |
| `src/db/queries/grade-runs.ts` *(modified)* | `insufficientGrade()`, `unscored()`, `GradeSummary.unscored`, `activeGradeRun()`, `insertGradeRun()`, `scheduleGrade()`. |
| `src/inngest/functions/grade-repository.ts` *(modified)* | The three-way branch on the broker's `incompleteCode`. |
| `src/components/grading/report.tsx` *(modified)* | The widened `Status` union, the insufficient status line, a report that prints measurements without points. |
| `src/app/app/repos/[repoId]/grading/page.tsx` *(modified)* | A *Not scored* card, and the schedule toggle. |

**The schedule**

| File | Responsibility |
| --- | --- |
| `src/db/queries/grade-schedules.ts` *(new)* | Everything that reads or writes `grade_schedules`: the page's view, the session-bound writer, and the two worker primitives the scheduler needs. |
| `src/components/grading/schedule-toggle.tsx` *(new)* | The one client component that turns a schedule on and off. |
| `src/app/app/repos/[repoId]/grading/actions.ts` *(modified)* | The `setGradeSchedule` server action. |
| `src/inngest/functions/schedule-grades.ts` *(new)* | The nightly cron and its per-schedule decision, exported for unit testing. |
| `src/app/api/inngest/route.ts` *(modified)* | Registers the new function. |
| `src/db/grade-schedules.integration.test.ts` *(new)* | A scheduled run created and completed with no session. |

---

### Task 1: Rename the readiness collector to the file collector

Pure rename. No behaviour changes at all — the diff should contain no new logic. This is separated from Task 2 so a reviewer can confirm the rename touched nothing, and so Task 2's diff is only the behaviour change.

**Files:**
- Rename: `src/github/collect-readiness.ts` → `src/github/collect-files.ts`
- Rename: `src/github/collect-readiness.test.ts` → `src/github/collect-files.test.ts`
- Modify: `src/grading/evidence.ts` (import and call)
- Modify: `src/grading/evidence.test.ts` (mock path and variable names)
- Modify: `src/inngest/functions/grade-repository.ts:12,29,41`
- Modify: `src/inngest/functions/plan-repository.ts:14,34`
- Modify: `src/inngest/functions/plan-repository.test.ts:22`
- Modify: `src/db/grade-runs.integration.test.ts:109-112`
- Modify: `src/db/queries/grade-metrics.ts:35` (a comment mentions `collectReadiness()`)

**Interfaces:**
- Consumes: nothing.
- Produces: `src/github/collect-files.ts` exporting `collectFiles(repositoryId: string, sha?: string): Promise<RepositorySnapshot>`, `resolveHeadSha(repositoryId: string): Promise<string>`, `class FileCollectionError extends Error { code: FileCollectionErrorCode; retryable: boolean }`, `type FileCollectionErrorCode = 'repository_unavailable' | 'installation_unavailable' | 'empty_repository' | 'github_unavailable' | 'collection_failed'`.

- [ ] **Step 1: Move both files with git**

```bash
git mv src/github/collect-readiness.ts src/github/collect-files.ts
git mv src/github/collect-readiness.test.ts src/github/collect-files.test.ts
```

- [ ] **Step 2: Rename the four symbols inside the moved files**

In `src/github/collect-files.ts` and `src/github/collect-files.test.ts`, replace every occurrence:

| Old | New |
| --- | --- |
| `ReadinessCollectionErrorCode` | `FileCollectionErrorCode` |
| `ReadinessCollectionError` | `FileCollectionError` |
| `resolveReadinessSha` | `resolveHeadSha` |
| `collectReadiness` | `collectFiles` |

Rename `ReadinessCollectionErrorCode` before `ReadinessCollectionError`, or a substring replacement will corrupt the type name.

Also update the two docstrings that name the old symbols:

`src/github/collect-files.ts:46` — `this.name = 'ReadinessCollectionError';` becomes `this.name = 'FileCollectionError';`

`src/github/collect-files.ts:80` — the comment `/** Resolve in a durable step, persist the SHA, then pass it to collectReadiness. */` becomes:

```ts
/** Resolve in a durable step, persist the SHA, then pass it to collectFiles. */
```

And the class docstring at line 39 stays as it is.

- [ ] **Step 3: Update every caller**

`src/grading/evidence.ts` line 1 and line 42:

```ts
import { collectFiles } from '../github/collect-files';
```
```ts
  const files = filesNeed ? await collectFiles(repositoryId, sha) : null;
```

`src/inngest/functions/grade-repository.ts` line 12, 29, 41:

```ts
import { resolveHeadSha, FileCollectionError } from '../../github/collect-files';
```
```ts
  if (error instanceof FileCollectionError && !error.retryable) {
```
```ts
    return await pinGradeSha(runId, await resolveHeadSha(run.repositoryId));
```

`src/inngest/functions/plan-repository.ts` line 14 and 34:

```ts
import { resolveHeadSha } from '../../github/collect-files';
```
```ts
    return await pinAuthoringSha(runId, await resolveHeadSha(run.repositoryId));
```

`src/inngest/functions/plan-repository.test.ts` line 22:

```ts
vi.mock('../../github/collect-files', () => ({ resolveHeadSha: deps.sha }));
```

`src/grading/evidence.test.ts` lines 3, 5 and every use of the `collectReadiness` local:

```ts
const collectFiles = vi.fn();
```
```ts
vi.mock('../github/collect-files', () => ({ collectFiles }));
```

Then rename the remaining `collectReadiness` identifiers in that file to `collectFiles`.

`src/db/grade-runs.integration.test.ts` lines 109-112:

```ts
vi.mock('../github/collect-files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../github/collect-files')>()),
  resolveHeadSha: github.resolve,
  collectFiles: github.collect,
}));
```

`src/db/queries/grade-metrics.ts` line 35 — inside the docstring, `collectReadiness()` becomes `collectFiles()`.

- [ ] **Step 4: Verify nothing is left**

Run:

```bash
grep -rn "collectReadiness\|resolveReadinessSha\|ReadinessCollectionError\|collect-readiness" --include="*.ts" --include="*.tsx" src/
```

Expected: no output.

- [ ] **Step 5: Run the full unit suite**

Run: `pnpm test`
Expected: PASS, with exactly the same number of passing tests as before the rename. No test file changed its assertions, only its identifiers.

- [ ] **Step 6: Confirm the acceptance test is untouched**

Run: `git diff main -- src/domain/grading/readiness-v01.test.ts`
Expected: empty output.

- [ ] **Step 7: Commit**

```bash
git add src/github/collect-files.ts src/github/collect-files.test.ts \
  src/grading/evidence.ts src/grading/evidence.test.ts \
  src/inngest/functions/grade-repository.ts \
  src/inngest/functions/plan-repository.ts src/inngest/functions/plan-repository.test.ts \
  src/db/grade-runs.integration.test.ts src/db/queries/grade-metrics.ts
git commit -F - <<'MSG'
refactor(grading): the readiness collector is a file collector

It was never a readiness collector wearing a general name — it is the
generic repo.files collector with the first grader's name on it. The
same reason slice 1 gave when it deleted check-titles.ts.

No behaviour change: identifiers only.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XYMLqoucHKuCv2mpJeEJXL
MSG
```

---

### Task 2: The collector matches declared globs

**Files:**
- Modify: `src/github/collect-files.ts` (delete `relevant()`, add a compiled matcher, change the signature)
- Modify: `src/github/collect-files.test.ts`
- Modify: `src/grading/evidence.ts` (pass the declared patterns)
- Modify: `src/grading/evidence.test.ts` (the call assertion)

**Interfaces:**
- Consumes: `globToRegExp(pattern: string, caseInsensitive?: boolean): RegExp` from `src/domain/grading/glob.ts`. `collectFiles` / `resolveHeadSha` / `FileCollectionError` from Task 1.
- Produces: `collectFiles(repositoryId: string, sha: string, patterns: string[]): Promise<RepositorySnapshot>`. **`sha` is now required** and the internal fallback to `resolveHeadSha()` is gone — the broker never resolves a sha, it receives a pinned one from the worker's `pin-commit` step.

**Matching is always case-insensitive.** The `needs` globs say *what to fetch*; the checks do the real matching and each already carries its own `caseInsensitive` flag (`file-exists.args`, `glob-count.args`, `heading-has-fence.args.scope[]`). Over-fetching a case variant of a file the grader explicitly asked for is within what it asked for.

**The one known difference from the old predicate:** `relevant()` required `AGENTS.md` and `CLAUDE.md` to match exactly, and now `agents.md` also matches. That is over-fetch, not under-fetch: the `file-exists` check for those two declares `caseInsensitive: false`, so the extra document cannot change a score. The readiness document set is otherwise identical, which is what keeps `readiness-v01.test.ts` passing.

- [ ] **Step 1: Write the failing tests**

Add to `src/github/collect-files.test.ts`. The existing `beforeEach` in that file already mocks `repositoryClient`, `getCommit`, `getTree` and `getBlob`; these use it. Add at the top of the file, beside the existing imports:

```ts
import { agentReadinessManifest } from '../domain/grading/graders/agent-readiness';

const READINESS_GLOBS = agentReadinessManifest.needs['repo.files']!;
```

Then append these tests:

```ts
test('collects the files a manifest declared and nothing else', async () => {
  mocks.getTree.mockResolvedValue({
    data: {
      truncated: false,
      tree: [blob('README.md', 'b1'), blob('src/index.ts', 'b2'), blob('src/deep/a.ts', 'b3')],
    },
  });
  const snapshot = await collectFiles('fixture-repo', 'abc', ['src/**/*.ts']);
  expect(snapshot.documents.map((d) => d.path)).toEqual(['src/index.ts', 'src/deep/a.ts']);
});

test('the readiness globs reproduce the hardcoded predicate, case variants included', async () => {
  mocks.getTree.mockResolvedValue({
    data: {
      truncated: false,
      tree: [
        blob('README.md', 'b1'),
        blob('readme.md', 'b2'),
        blob('AGENTS.md', 'b3'),
        blob('CLAUDE.md', 'b4'),
        blob('docs/guide.md', 'b5'),
        blob('docs/deep/nested.markdown', 'b6'),
        blob('Docs/case.md', 'b7'),
        blob('src/index.ts', 'b8'),
        blob('package.json', 'b9'),
      ],
    },
  });
  const snapshot = await collectFiles('fixture-repo', 'abc', READINESS_GLOBS);
  expect(snapshot.documents.map((d) => d.path)).toEqual([
    'README.md',
    'readme.md',
    'AGENTS.md',
    'CLAUDE.md',
    'docs/guide.md',
    'docs/deep/nested.markdown',
    'Docs/case.md',
  ]);
});

test('an empty pattern list collects nothing and stays complete', async () => {
  mocks.getTree.mockResolvedValue({
    data: { truncated: false, tree: [blob('README.md', 'b1')] },
  });
  expect(await collectFiles('fixture-repo', 'abc', [])).toEqual({
    sha: 'abc',
    complete: true,
    documents: [],
  });
});

test('a tree over the document cap reports an incomplete snapshot', async () => {
  mocks.getTree.mockResolvedValue({
    data: {
      truncated: false,
      tree: Array.from({ length: 201 }, (_unused, index) =>
        blob(`docs/file-${index}.md`, `b${index}`),
      ),
    },
  });
  const snapshot = await collectFiles('fixture-repo', 'abc', READINESS_GLOBS);
  expect(snapshot.complete).toBe(false);
  expect(snapshot.documents).toHaveLength(200);
});
```

Then update every existing `collectFiles('fixture-repo', 'abc')` call in the file to pass patterns. The existing cases all use `README.md` fixtures, so `READINESS_GLOBS` is the right third argument for all of them. The one existing case that calls `collectFiles('fixture-repo')` with no sha (around line 69, "resolves the head sha when none is pinned") is deleted — the fallback it tested is gone. `resolveHeadSha` keeps its own direct test in the same file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/github/collect-files.test.ts`
Expected: FAIL — `collectFiles` takes two arguments, so the third is ignored and `src/**/*.ts` returns `README.md` instead of the `src` files.

- [ ] **Step 3: Replace the predicate with a compiled matcher**

In `src/github/collect-files.ts`, add the import at the top:

```ts
import { globToRegExp } from '../domain/grading/glob';
```

Delete `relevant()` (lines 97-104) and replace it with:

```ts
// Always case-insensitive. The `needs` globs say what to fetch; each check
// carries its own caseInsensitive flag and does the real matching. Over-
// fetching a case variant of a file the grader explicitly asked for is
// within what it asked for, and it is what the hardcoded predicate already
// did for README.md and docs/.
function matcher(patterns: string[]): (path: string) => boolean {
  const expressions = patterns.map((pattern) => globToRegExp(pattern, true));
  return (path) => expressions.some((expression) => expression.test(path));
}
```

Change the signature and thread the matcher through `consider()`:

```ts
/** Server-side evidence collection only; callers must not serialize raw documents to clients. */
export async function collectFiles(
  repositoryId: string,
  sha: string,
  patterns: string[],
): Promise<RepositorySnapshot> {
  const relevant = matcher(patterns);
  try {
    const pinnedSha = sha;
```

and delete the old first line of the `try` block (`const pinnedSha = sha ?? (await resolveHeadSha(repositoryId));`). Everything below is unchanged: `consider()` still calls `relevant(path)`, which is now the closure rather than the module function.

- [ ] **Step 4: Pass the declared patterns from the broker**

`src/grading/evidence.ts` line 42:

```ts
  const files = filesNeed ? await collectFiles(repositoryId, sha, filesNeed) : null;
```

And in `src/grading/evidence.test.ts`, the two assertions that read `expect(collectFiles).toHaveBeenCalledWith('repo', 'abc')` become:

```ts
  expect(collectFiles).toHaveBeenCalledWith('repo', 'abc', agentReadinessManifest.needs['repo.files']);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/github/collect-files.test.ts src/grading/evidence.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the acceptance test and confirm it is untouched**

Run: `pnpm vitest run src/domain/grading/readiness-v01.test.ts && git diff main -- src/domain/grading/readiness-v01.test.ts`
Expected: PASS, then empty diff output.

- [ ] **Step 7: Run the full unit suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/github/collect-files.ts src/github/collect-files.test.ts \
  src/grading/evidence.ts src/grading/evidence.test.ts
git commit -F - <<'MSG'
feat(grading): a grader receives the files it declared

collectFiles matched a hardcoded predicate, so a third-party grader
asking for src/**/*.ts received an empty document list and failed every
check. It now compiles the manifest's own globs through globToRegExp,
which was written for this.

Matching is always case-insensitive: the needs globs say what to fetch,
and every check already carries its own caseInsensitive flag for the
matching that decides a score. The readiness document set is unchanged.

The sha is now required. The broker never resolves one — it receives a
pinned one from the worker's pin-commit step.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XYMLqoucHKuCv2mpJeEJXL
MSG
```

---

### Task 3: `needs_too_broad`

**Files:**
- Modify: `src/domain/grading/manifest.ts`
- Modify: `src/domain/grading/manifest.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ManifestErrorCode` gains `'needs_too_broad'`.

A manifest is untrusted input and every pattern is a regular expression run against every tree entry. Twenty is four times what either built-in needs. This is a post-parse invariant rather than a Zod `.max(20)` so it carries its own error code instead of the generic `schema` one.

- [ ] **Step 1: Write the failing test**

Append to `src/domain/grading/manifest.test.ts`. Match the fixture style already in that file — read the existing tests first and reuse whatever manifest-building helper they use. If the file builds manifests inline, use this shape:

```ts
test('more than twenty repo.files patterns is needs_too_broad', () => {
  const manifest = {
    id: 'someone/broad',
    version: '0.1.0',
    evaluatorVersion: '1.0.0',
    subject: 'repository',
    mode: 'deterministic',
    category: 'documentation',
    kind: 'declarative',
    needs: { 'repo.files': Array.from({ length: 21 }, (_u, i) => `dir-${i}/**/*.md`) },
    disclaimer: 'A disclaimer.',
    card: { title: 'Broad', tagline: 'Too much.', groups: [{ title: 'G', checks: ['only'] }] },
    checks: [
      {
        id: 'only',
        title: 'Only check',
        points: 100,
        explain: { pass: 'Yes.', fail: 'No.' },
        primitive: 'file-exists',
        args: { anyOf: ['README.md'] },
      },
    ],
  };
  expect(() => parseManifest(manifest)).toThrow(ManifestError);
  try {
    parseManifest(manifest);
  } catch (error) {
    expect((error as ManifestError).code).toBe('needs_too_broad');
    return;
  }
  throw new Error('expected needs_too_broad');
});

test('exactly twenty repo.files patterns is accepted', () => {
  expect(() =>
    parseManifest({
      id: 'someone/wide',
      version: '0.1.0',
      evaluatorVersion: '1.0.0',
      subject: 'repository',
      mode: 'deterministic',
      category: 'documentation',
      kind: 'declarative',
      needs: { 'repo.files': Array.from({ length: 20 }, (_u, i) => `dir-${i}/**/*.md`) },
      disclaimer: 'A disclaimer.',
      card: { title: 'Wide', tagline: 'Enough.', groups: [{ title: 'G', checks: ['only'] }] },
      checks: [
        {
          id: 'only',
          title: 'Only check',
          points: 100,
          explain: { pass: 'Yes.', fail: 'No.' },
          primitive: 'file-exists',
          args: { anyOf: ['README.md'] },
        },
      ],
    }),
  ).not.toThrow();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/domain/grading/manifest.test.ts`
Expected: FAIL — no error is thrown for twenty-one patterns.

- [ ] **Step 3: Add the error code and the invariant**

In `src/domain/grading/manifest.ts`, add to the `ManifestErrorCode` union after `'needs_mismatch'`:

```ts
  | 'needs_too_broad'
```

And add this invariant in `parseManifest`, immediately after the `needs_empty` check and before the `required`/`undeclared` block:

```ts
  // A manifest is untrusted input and every pattern is a regular expression
  // run against every tree entry. Twenty is four times what either built-in
  // needs. Its own code rather than a Zod .max(), so an author is told which
  // rule they broke.
  const patterns = manifest.needs['repo.files'];
  if (patterns && patterns.length > 20)
    throw new ManifestError(
      'needs_too_broad',
      `Manifest declares ${patterns.length} repo.files patterns; the limit is 20.`,
    );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/domain/grading/manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/grading/manifest.ts src/domain/grading/manifest.test.ts
git commit -F - <<'MSG'
feat(grading): cap a manifest at twenty repo.files patterns

Every pattern is a regular expression run against every tree entry, and
a manifest is untrusted input. Twenty is four times what either built-in
needs.

Its own error code rather than a Zod .max(), so an author is told which
rule they broke instead of reading a schema dump.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XYMLqoucHKuCv2mpJeEJXL
MSG
```

---

### Task 4: `subject: repository_window` and the delivery-health bump

**Files:**
- Modify: `src/domain/grading/manifest.ts`
- Modify: `src/domain/grading/manifest.test.ts`
- Modify: `src/domain/grading/graders/delivery-health.ts`
- Modify: `src/domain/grading/graders/delivery-health.test.ts` (any assertion naming `0.1.0` or `subject`)

**Interfaces:**
- Consumes: `ManifestErrorCode` from Task 3.
- Produces: `ManifestErrorCode` gains `'subject_mismatch'`. `deliveryHealthManifest.version === '0.2.0'`, `deliveryHealthManifest.subject === 'repository_window'`.

`subject` is **immutable for the life of a grader**. Today both graders are ours and nobody has published against the contract, so changing it costs a version bump. After slice 5 it is a breaking change to other people's work — which is why this lands now and not later.

**Why 0.2.0 and not 0.1.0:** `subject` is part of the hashed rubric definition (`registerRubric` compares `manifestHash(withoutCard(stored.manifest))` against the incoming one). Leaving the version at 0.1.0 throws `Rubric version definition mismatch` on the first grade request against any database that already holds the 0.1.0 row. Runs recorded against 0.1.0 keep pointing at the 0.1.0 rubric row, which still exists and still renders.

`fieldnote/agent-readiness` does not move. It declares only `repo.files`, its subject stays `repository`, and its version is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `src/domain/grading/manifest.test.ts`, reusing the fixture shape from Task 3:

```ts
const metricsNeed = {
  windowDays: 30 as const,
  minMergedPullRequests: 10,
  insufficientReason: 'Not enough merged work to judge.',
};
const metricCheck = {
  id: 'rate',
  title: 'Rate',
  points: 100,
  explain: { pass: 'Yes.', fail: 'No.' },
  primitive: 'metric-threshold',
  args: { metric: 'first-pass-rate', atLeastPercent: 60 },
};
const windowManifest = (overrides: Record<string, unknown>) => ({
  id: 'someone/window',
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository_window',
  mode: 'deterministic',
  category: 'delivery-health',
  kind: 'declarative',
  needs: { 'fieldnote.metrics': metricsNeed },
  disclaimer: 'A disclaimer.',
  card: { title: 'Window', tagline: 'A window.', groups: [{ title: 'G', checks: ['rate'] }] },
  checks: [metricCheck],
  ...overrides,
});

test('a metrics grader may say repository_window', () => {
  expect(() => parseManifest(windowManifest({}))).not.toThrow();
});

test('a metrics grader claiming subject repository is subject_mismatch', () => {
  try {
    parseManifest(windowManifest({ subject: 'repository' }));
  } catch (error) {
    expect((error as ManifestError).code).toBe('subject_mismatch');
    return;
  }
  throw new Error('expected subject_mismatch');
});

test('a file grader claiming repository_window is subject_mismatch', () => {
  try {
    parseManifest({
      id: 'someone/files',
      version: '0.1.0',
      evaluatorVersion: '1.0.0',
      subject: 'repository_window',
      mode: 'deterministic',
      category: 'documentation',
      kind: 'declarative',
      needs: { 'repo.files': ['README.md'] },
      disclaimer: 'A disclaimer.',
      card: { title: 'Files', tagline: 'Files.', groups: [{ title: 'G', checks: ['only'] }] },
      checks: [
        {
          id: 'only',
          title: 'Only check',
          points: 100,
          explain: { pass: 'Yes.', fail: 'No.' },
          primitive: 'file-exists',
          args: { anyOf: ['README.md'] },
        },
      ],
    });
  } catch (error) {
    expect((error as ManifestError).code).toBe('subject_mismatch');
    return;
  }
  throw new Error('expected subject_mismatch');
});

test('an unrecognised subject is still subject_unsupported', () => {
  try {
    parseManifest(windowManifest({ subject: 'pull_request' }));
  } catch (error) {
    expect((error as ManifestError).code).toBe('subject_unsupported');
    return;
  }
  throw new Error('expected subject_unsupported');
});
```

And in `src/domain/grading/graders/delivery-health.test.ts`, add:

```ts
test('delivery health grades a pinned window at version 0.2.0', () => {
  expect(deliveryHealthManifest.version).toBe('0.2.0');
  expect(deliveryHealthManifest.subject).toBe('repository_window');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/domain/grading/manifest.test.ts src/domain/grading/graders/delivery-health.test.ts`
Expected: FAIL — `repository_window` throws `subject_unsupported`, and the delivery-health manifest still says `0.1.0` / `repository`.

- [ ] **Step 3: Accept the second subject and add the invariant**

In `src/domain/grading/manifest.ts`, add to `ManifestErrorCode`:

```ts
  | 'subject_mismatch'
```

Replace the existing `subject_unsupported` guard (currently lines 157-161) with:

```ts
  if (manifest.subject !== 'repository' && manifest.subject !== 'repository_window')
    throw new ManifestError(
      'subject_unsupported',
      `Subject '${manifest.subject}' is not yet supported; v1 grades a repository or a window over one.`,
    );
```

Then, at the **end** of `parseManifest`, after the `unread` check and immediately before `return manifest;`, add:

```ts
  // The subject and the evidence cannot disagree. A grader that reads a
  // moving window while claiming to grade a commit is the bug open question 6
  // described; after this it is unregistrable rather than merely undocumented.
  // Placed after the needs invariants so a broken `needs` reports its own
  // error rather than this one.
  const window = manifest.needs['fieldnote.metrics'] !== undefined;
  if (window && manifest.subject !== 'repository_window')
    throw new ManifestError(
      'subject_mismatch',
      "A grader reading 'fieldnote.metrics' grades a window and must say subject: repository_window.",
    );
  if (!window && manifest.subject !== 'repository')
    throw new ManifestError(
      'subject_mismatch',
      "Only a grader reading 'fieldnote.metrics' may say subject: repository_window.",
    );
```

- [ ] **Step 4: Bump delivery-health**

In `src/domain/grading/graders/delivery-health.ts`, lines 14 and 16:

```ts
  version: '0.2.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository_window',
```

And add above the manifest, after the existing comment block:

```ts
// 0.2.0 changes only the subject, which is part of the hashed rubric
// definition — leaving it at 0.1.0 throws `Rubric version definition
// mismatch` on the first grade request against a database that already holds
// the 0.1.0 row. Runs recorded against 0.1.0 keep pointing at the 0.1.0
// rubric, which still exists and still renders.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/domain/grading/manifest.test.ts src/domain/grading/graders/delivery-health.test.ts src/domain/grading/registry.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full unit suite and the acceptance test**

Run: `pnpm test && git diff main -- src/domain/grading/readiness-v01.test.ts`
Expected: PASS, then empty diff output. If another test asserted delivery-health's version, update that assertion — it is not the acceptance test.

- [ ] **Step 7: Commit**

```bash
git add src/domain/grading/manifest.ts src/domain/grading/manifest.test.ts \
  src/domain/grading/graders/delivery-health.ts src/domain/grading/graders/delivery-health.test.ts
git commit -F - <<'MSG'
feat(grading): a grader that reads a window says so

subject gains repository_window, and a registration invariant ties it to
the evidence: declaring fieldnote.metrics requires it, and not declaring
it forbids it. A grader that reads a moving window while claiming to
grade a commit is now unregistrable rather than merely undocumented.

Now rather than in slice 5, because subject is immutable for the life of
a grader. Today both graders are ours and nobody has published against
the contract, so it costs a version bump. After slice 5 it is a breaking
change to other people's work.

delivery-health goes to 0.2.0: subject is part of the hashed rubric
definition, so 0.1.0 would throw Rubric version definition mismatch
against any database that already holds the row.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XYMLqoucHKuCv2mpJeEJXL
MSG
```

---

### Task 5: The pinned window

**Files:**
- Modify: `src/grading/evidence.ts`
- Modify: `src/grading/evidence.test.ts`
- Modify: `src/inngest/functions/grade-repository.ts:52`

**Interfaces:**
- Consumes: `collectFiles(repositoryId, sha, patterns)` from Task 2. `collectMetrics(repositoryId: string, need: MetricsNeed, now?: Date): Promise<MetricsCollection>` from `src/db/queries/grade-metrics.ts` — it already accepts the moment it measures from, defaulting to `new Date()`.
- Produces: `collectEvidence(manifest: GraderManifest, repositoryId: string, sha: string, requestedAt: Date): Promise<CollectedEvidence>`.

`requestedAt` is `grade_runs.created_at`, which is already stored and already loaded by `evaluateGradeRun()`. **The pinning itself needs no migration and no new column.**

What this fixes: a single run now scores one window for its whole life. A run created at 23:58 and executed at 00:03, and an Inngest retry of a failed run hours later, both score the window the requester asked for. What it does not fix — and is not a bug — is that re-running the grade tomorrow scores tomorrow's window. That is what a delivery grade is.

- [ ] **Step 1: Write the failing test**

Append to `src/grading/evidence.test.ts`:

```ts
test('the metrics window is pinned to the request time, not the wall clock', async () => {
  collectMetrics.mockResolvedValue({ metrics, complete: true });
  const requestedAt = new Date('2026-09-13T23:58:00.000Z');
  await collectEvidence(deliveryHealthManifest, 'repo', 'abc', requestedAt);
  expect(collectMetrics).toHaveBeenCalledWith(
    'repo',
    deliveryHealthManifest.needs['fieldnote.metrics'],
    requestedAt,
  );
});
```

And update every existing `collectEvidence(...)` call in that file to pass a fourth argument — `new Date('2026-09-14T12:00:00.000Z')` is fine for the cases that do not assert on it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/grading/evidence.test.ts`
Expected: FAIL — `collectMetrics` is called with two arguments, so the third assertion does not match.

- [ ] **Step 3: Thread the request time through the broker**

`src/grading/evidence.ts`, the signature and the metrics call:

```ts
export async function collectEvidence(
  manifest: GraderManifest,
  repositoryId: string,
  sha: string,
  requestedAt: Date,
): Promise<CollectedEvidence> {
```
```ts
  const metrics = metricsNeed ? await collectMetrics(repositoryId, metricsNeed, requestedAt) : null;
```

Replace the file's docstring (currently lines 14-20) with:

```ts
/**
 * The broker. A grader gets exactly the evidence it declared and nothing else:
 * the families it named, the file globs it named, and a metrics window pinned
 * to the moment the run was requested rather than the moment it executed.
 *
 * This is the one place a consent check belongs when slice 5 builds the
 * install flow, because it is the one place that knows both the manifest's
 * `needs` and the repository it is about to read. Do not put it anywhere else.
 */
```

- [ ] **Step 4: Pass the run's `created_at` from the worker**

`src/inngest/functions/grade-repository.ts` line 52:

```ts
    const { snapshot, incompleteCode } = await collectEvidence(
      manifest,
      run.repositoryId,
      run.sha,
      run.createdAt,
    );
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/grading/evidence.test.ts && pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/grading/evidence.ts src/grading/evidence.test.ts src/inngest/functions/grade-repository.ts
git commit -F - <<'MSG'
feat(grading): a run is pinned to the window it asked for

A delivery grade computed its window from the wall clock at execution
time, so a run queued at 23:58 and executed at 00:03 scored a different
month than the one it was requested for, and an Inngest retry hours
later scored a third.

collectMetrics already accepted the moment it measures from. The broker
now passes the run's created_at, which is already stored — no migration
and no new column.

Answers open question 6 together with subject: repository_window.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XYMLqoucHKuCv2mpJeEJXL
MSG
```

---

### Task 6: The `insufficient` state — schema, migration and writer

**Files:**
- Modify: `src/db/schema.ts:653` (state union), `:661-665` (constraints)
- Create: `drizzle/0013_grade_insufficient.sql`
- Modify: `src/db/queries/grade-runs.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `GradeRun['state']` is `'queued' | 'running' | 'complete' | 'failed' | 'insufficient'`.
  - `export type UnscoredGrade = GradeResult & { id: string; sha: string; computedAt: Date }`
  - `export async function insufficientGrade(runId: string, result: GradeResult): Promise<void>`
  - `GradeSummary` gains `unscored: UnscoredGrade | null`.

**Why a state and not a failure.** `runDeclarative()` already builds the complete result when there is no score — every check, what it measured, and the grader's own sentence. `evaluateGradeRun()` throws all of it away because `grade_runs_result` forbids a non-complete run from storing a result. That is open question 7, and this is its answer: a floor miss is not a failure.

**A collection failure stays `failed` and stores nothing.** Its check results are noise — they failed because the evidence was missing, not because the repository is lacking.

**History stays scored runs only.** `CompletedGrade` and `completed()` do not change, so `latestGrade()`, `latestCompletedGrade()`, `gradeHistory()` and `gradeSummaries().latest` all continue to mean *a grade*. An unscored run on the score-over-time list is the same lie as scoring a partial read. `UnscoredGrade` is structurally identical to `CompletedGrade` on purpose — the report renders either — and separately named so a call site cannot confuse them.

- [ ] **Step 1: Write the failing test**

Append to `src/db/grade-runs.integration.test.ts`. Read the file's existing fixture helpers first and reuse them for creating a repository and a run; this is the assertion shape:

```ts
test('an insufficient run stores its unscored result', async () => {
  const repositoryId = await fixtureRepository();
  const run = await requestGrade(repositoryId, DELIVERY_HEALTH);
  await beginGrade(run.id);
  await pinGradeSha(run.id, 'a'.repeat(40));
  await insufficientGrade(run.id, {
    score: null,
    checks: [],
    rubricVersion: deliveryHealthManifest.version,
    evaluatorVersion: deliveryHealthManifest.evaluatorVersion,
    incompleteReason: deliveryHealthManifest.needs['fieldnote.metrics']!.insufficientReason,
  });
  const stored = await loadGradeRun(run.id);
  expect(stored?.state).toBe('insufficient');
  expect(stored?.result?.score).toBeNull();
  expect(stored?.result?.incompleteReason).toBe(
    deliveryHealthManifest.needs['fieldnote.metrics']!.insufficientReason,
  );
  expect(stored?.completedAt).toBeInstanceOf(Date);
});

test('insufficientGrade refuses a result that has a score', async () => {
  const repositoryId = await fixtureRepository();
  const run = await requestGrade(repositoryId, DELIVERY_HEALTH);
  await beginGrade(run.id);
  await pinGradeSha(run.id, 'b'.repeat(40));
  await expect(
    insufficientGrade(run.id, {
      score: 80,
      checks: [],
      rubricVersion: deliveryHealthManifest.version,
      evaluatorVersion: deliveryHealthManifest.evaluatorVersion,
    }),
  ).rejects.toThrow('Invalid grade result');
});

test('a complete run still cannot store a null score', async () => {
  const repositoryId = await fixtureRepository();
  const run = await requestGrade(repositoryId, DELIVERY_HEALTH);
  await beginGrade(run.id);
  await pinGradeSha(run.id, 'c'.repeat(40));
  await expect(
    db()
      .update(gradeRuns)
      .set({ state: 'complete', result: { score: null, checks: [], rubricVersion: deliveryHealthManifest.version, evaluatorVersion: deliveryHealthManifest.evaluatorVersion }, completedAt: new Date() })
      .where(eq(gradeRuns.id, run.id)),
  ).rejects.toThrow();
});
```

```ts
test('a failed run still cannot store a result', async () => {
  const repositoryId = await fixtureRepository();
  const run = await requestGrade(repositoryId, DELIVERY_HEALTH);
  await beginGrade(run.id);
  await pinGradeSha(run.id, 'd'.repeat(40));
  await expect(
    db()
      .update(gradeRuns)
      .set({
        state: 'failed',
        result: {
          score: null,
          checks: [],
          rubricVersion: deliveryHealthManifest.version,
          evaluatorVersion: deliveryHealthManifest.evaluatorVersion,
        },
        completedAt: new Date(),
      })
      .where(eq(gradeRuns.id, run.id)),
  ).rejects.toThrow();
});

test('history and the latest grade ignore an insufficient run', async () => {
  const repositoryId = await fixtureRepository();
  const run = await requestGrade(repositoryId, DELIVERY_HEALTH);
  await beginGrade(run.id);
  await pinGradeSha(run.id, 'e'.repeat(40));
  await insufficientGrade(run.id, {
    score: null,
    checks: [],
    rubricVersion: deliveryHealthManifest.version,
    evaluatorVersion: deliveryHealthManifest.evaluatorVersion,
    incompleteReason: 'Not enough delivery record to judge.',
  });
  expect(await latestCompletedGrade(repositoryId, DELIVERY_HEALTH)).toBeNull();
  expect(await gradeHistory(repositoryId, DELIVERY_HEALTH)).toEqual([]);
  const [summary] = await gradeSummaries([repositoryId], [DELIVERY_HEALTH]);
  expect(summary.latest).toBeNull();
  // The current state, though, is exactly what `unscored` is for.
  expect(summary.unscored?.incompleteReason).toBe('Not enough delivery record to judge.');
});
```

If `fixtureRepository()` does not already exist in that file, extract it from whatever the existing tests inline — every test in the file already creates a repository, an installation and a workspace link.

- [ ] **Step 2: Run the test to verify it fails**

Run: `DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/grade-runs.integration.test.ts`
Expected: FAIL — `insufficientGrade` is not exported.

- [ ] **Step 3: Widen the state and rewrite the constraints**

`src/db/schema.ts` line 653:

```ts
    state: text('state')
      .$type<'queued' | 'running' | 'complete' | 'failed' | 'insufficient'>()
      .notNull(),
```

And the two check constraints (lines 661-665):

```ts
    check(
      'grade_runs_state',
      sql`${t.state} IN ('queued','running','complete','failed','insufficient')`,
    ),
    // Unchanged: a SQL check passes on NULL, so this already tolerates the
    // null score an insufficient run stores.
    check('grade_runs_score', sql`(${t.result}->>'score')::integer BETWEEN 0 AND 100`),
    check(
      'grade_runs_result',
      sql`(${t.state} = 'complete' AND ${t.sha} IS NOT NULL AND ${t.completedAt} IS NOT NULL AND ${t.result} IS NOT NULL AND ${t.result}->>'score' IS NOT NULL) OR (${t.state} = 'insufficient' AND ${t.sha} IS NOT NULL AND ${t.completedAt} IS NOT NULL AND ${t.result} IS NOT NULL AND ${t.result}->>'score' IS NULL) OR (${t.state} NOT IN ('complete','insufficient') AND ${t.result} IS NULL)`,
    ),
```

`grade_runs_one_active` needs no change: it names only `queued` and `running`.

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate`

Rename the generated file to `drizzle/0013_grade_insufficient.sql`, updating `drizzle/meta/_journal.json` to match the new name. Its contents must be exactly:

```sql
ALTER TABLE "grade_runs" DROP CONSTRAINT "grade_runs_state";--> statement-breakpoint
ALTER TABLE "grade_runs" DROP CONSTRAINT "grade_runs_result";--> statement-breakpoint
ALTER TABLE "grade_runs" ADD CONSTRAINT "grade_runs_state" CHECK ("grade_runs"."state" IN ('queued','running','complete','failed','insufficient'));--> statement-breakpoint
-- A floor miss is not a failure. An insufficient run stores its full result
-- with a null score, so the grader's own sentence and its measurements reach
-- a reader. A collection failure still stores nothing: its check results
-- failed because the evidence was missing, not because the repository is
-- lacking.
ALTER TABLE "grade_runs" ADD CONSTRAINT "grade_runs_result" CHECK (("grade_runs"."state" = 'complete' AND "grade_runs"."sha" IS NOT NULL AND "grade_runs"."completed_at" IS NOT NULL AND "grade_runs"."result" IS NOT NULL AND "grade_runs"."result"->>'score' IS NOT NULL) OR ("grade_runs"."state" = 'insufficient' AND "grade_runs"."sha" IS NOT NULL AND "grade_runs"."completed_at" IS NOT NULL AND "grade_runs"."result" IS NOT NULL AND "grade_runs"."result"->>'score' IS NULL) OR ("grade_runs"."state" NOT IN ('complete','insufficient') AND "grade_runs"."result" IS NULL));
```

If `pnpm db:generate` produced different SQL, hand-edit the file to match this exactly. No existing row changes state, so there is no backfill.

- [ ] **Step 5: Add the writer and the summary field**

In `src/db/queries/grade-runs.ts`, beside `CompletedGrade` (line 37):

```ts
/** Structurally the same as a CompletedGrade and deliberately not the same
 *  thing: an insufficient run has a null score, is the repository's current
 *  state, and never joins the history list. */
export type UnscoredGrade = GradeResult & { id: string; sha: string; computedAt: Date };
```

Add to `GradeSummary`:

```ts
  /** The current run when it ended without a score. Null otherwise — including
   *  when an older run was insufficient and a newer one scored. */
  unscored: UnscoredGrade | null;
```

Beside `completed()` (line 181):

```ts
function unscored(run: GradeRun): UnscoredGrade | null {
  return run.state === 'insufficient' && run.result && run.sha && run.completedAt
    ? { ...run.result, id: run.id, sha: run.sha, computedAt: run.completedAt }
    : null;
}
```

In `gradeSummaries()`, inside the returned object, after `latest`:

```ts
        unscored: current ? unscored(current) : null,
```

Beside `completeGrade()` (line 363):

```ts
// The mirror image of completeGrade: same guards, opposite assertion about
// the score. A floor miss is not a failure — runDeclarative already built the
// full result, and this is where it lands.
export async function insufficientGrade(runId: string, result: GradeResult) {
  const run = await loadGradeRun(runId);
  if (!run || run.state !== 'running') return;
  if (
    result.score !== null ||
    result.rubricVersion !== run.rubricVersion ||
    result.evaluatorVersion !== run.evaluatorVersion
  )
    throw new Error('Invalid grade result');
  await db()
    .update(runs)
    .set({ state: 'insufficient', result, completedAt: new Date() })
    .where(and(eq(runs.id, runId), eq(runs.state, 'running')));
}
```

Leave `failGrade()`'s `insufficient_evidence` entry in its whitelist. It becomes unreachable from this path, and a `kind: code` grader in slice 4 can still fail a floor with no result to store. Add that as a comment above the array:

```ts
  // insufficient_evidence is unreachable from the declarative path after the
  // insufficient state — kept because a kind: code grader in slice 4 can still
  // fail a floor with no result to store.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/grade-runs.integration.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. If `src/components/grading/report.tsx` fails on the widened state union, leave it — Task 8 fixes it. If it blocks, add `'insufficient'` to that file's `Status` union now and let Task 8 do the rest.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts drizzle/0013_grade_insufficient.sql drizzle/meta \
  src/db/queries/grade-runs.ts src/db/grade-runs.integration.test.ts
git commit -F - <<'MSG'
feat(grading): a run that is not a failure

A grader's insufficientReason was required, validated and threaded all
the way to the result, then dropped — because a run without a score was
failed, and a failed run stores no result. What a reader saw was
fieldnote's generic copy keyed off an error code.

A floor miss now has its own state. It stores the full result that
runDeclarative already built: every check, what it measured, and the
grader's own sentence. A collection failure stays failed and stores
nothing, because its check results failed for want of evidence rather
than for want of the thing they measure.

History is unchanged and still means scored runs only.

Answers open question 7.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XYMLqoucHKuCv2mpJeEJXL
MSG
```

---

### Task 7: The worker branches on the broker's code

**Files:**
- Modify: `src/inngest/functions/grade-repository.ts:46-68`
- Create: `src/inngest/functions/grade-repository.test.ts` if it does not already exist; otherwise modify it

**Interfaces:**
- Consumes: `insufficientGrade(runId, result)` from Task 6. `collectEvidence(manifest, repositoryId, sha, requestedAt)` from Task 5.
- Produces: nothing later tasks consume.

The branch table:

| `incompleteCode` | State | Stored |
| --- | --- | --- |
| `null` (complete) | `complete` | the result, with a score |
| `insufficient_evidence` | `insufficient` | the result, score null |
| `incomplete_collection` | `failed` | nothing; `error_code` only |

- [ ] **Step 1: Write the failing test**

Create or extend `src/inngest/functions/grade-repository.test.ts`. Mock the query module and the broker:

```ts
import { beforeEach, expect, test, vi } from 'vitest';

const queries = vi.hoisted(() => ({
  loadGradeRun: vi.fn(),
  validateGradeRun: vi.fn(),
  completeGrade: vi.fn(),
  failGrade: vi.fn(),
  insufficientGrade: vi.fn(),
  beginGrade: vi.fn(),
  pinGradeSha: vi.fn(),
}));
const broker = vi.hoisted(() => ({ collectEvidence: vi.fn() }));
vi.mock('../../db/queries/grade-runs', () => queries);
vi.mock('../../grading/evidence', () => broker);
vi.mock('../../github/collect-files', () => ({
  resolveHeadSha: vi.fn(),
  FileCollectionError: class extends Error {},
}));

const { evaluateGradeRun } = await import('./grade-repository');
const { agentReadinessManifest } = await import('../../domain/grading/graders/agent-readiness');

const run = {
  id: 'run-1',
  repositoryId: 'repo-1',
  graderId: agentReadinessManifest.id,
  state: 'running',
  sha: 'a'.repeat(40),
  createdAt: new Date('2026-09-13T23:58:00.000Z'),
  rubricVersion: agentReadinessManifest.version,
  evaluatorVersion: agentReadinessManifest.evaluatorVersion,
};

beforeEach(() => {
  vi.resetAllMocks();
  queries.loadGradeRun.mockResolvedValue(run);
  queries.validateGradeRun.mockResolvedValue(undefined);
});

test('a grader floor miss is stored, not failed', async () => {
  broker.collectEvidence.mockResolvedValue({
    snapshot: {
      sha: run.sha,
      complete: false,
      documents: [],
      metrics: null,
      incompleteReason: 'Not enough merged work to judge.',
    },
    incompleteCode: 'insufficient_evidence',
  });
  await evaluateGradeRun('run-1');
  expect(queries.insufficientGrade).toHaveBeenCalledWith(
    'run-1',
    expect.objectContaining({ score: null, incompleteReason: 'Not enough merged work to judge.' }),
  );
  expect(queries.failGrade).not.toHaveBeenCalled();
});

test('a collection failure fails the run and stores nothing', async () => {
  broker.collectEvidence.mockResolvedValue({
    snapshot: { sha: run.sha, complete: false, documents: [], metrics: null },
    incompleteCode: 'incomplete_collection',
  });
  await evaluateGradeRun('run-1');
  expect(queries.failGrade).toHaveBeenCalledWith('run-1', 'incomplete_collection');
  expect(queries.insufficientGrade).not.toHaveBeenCalled();
});

test('the broker is handed the run request time', async () => {
  broker.collectEvidence.mockResolvedValue({
    snapshot: { sha: run.sha, complete: true, documents: [], metrics: null },
    incompleteCode: null,
  });
  await evaluateGradeRun('run-1');
  expect(broker.collectEvidence).toHaveBeenCalledWith(
    expect.objectContaining({ id: agentReadinessManifest.id }),
    'repo-1',
    run.sha,
    run.createdAt,
  );
  expect(queries.completeGrade).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/inngest/functions/grade-repository.test.ts`
Expected: FAIL — `insufficientGrade` is never called; `failGrade` is.

- [ ] **Step 3: Branch on the code**

`src/inngest/functions/grade-repository.ts` — add `insufficientGrade` to the import list from `../../db/queries/grade-runs`, then replace the `if (result.score === null)` block (lines 54-61) with:

```ts
    if (result.score === null) {
      // Two reasons a run has no score, and they belong to different authors.
      // "Not enough merged work to judge" is the grader's, and its result is
      // worth storing and reading. Collection failing is fieldnote's, and its
      // check results are noise — they failed for want of evidence, not for
      // want of the thing they measure.
      if (incompleteCode === 'insufficient_evidence') {
        // Recheck authorization before storing, as the complete path does.
        if (!(await validated(runId))) return;
        await insufficientGrade(runId, result);
        return;
      }
      await failGrade(runId, incompleteCode ?? undefined);
      return;
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/inngest/functions/grade-repository.test.ts && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/inngest/functions/grade-repository.ts src/inngest/functions/grade-repository.test.ts
git commit -F - <<'MSG'
feat(grading): store a floor miss instead of discarding it

The worker branches on the code the broker already returned, which is
what the incomplete_collection / insufficient_evidence split in slice 2
was for.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XYMLqoucHKuCv2mpJeEJXL
MSG
```

---

### Task 8: Where an unscored run shows

**Files:**
- Modify: `src/components/grading/report.tsx`
- Modify: `src/components/grading/report.test.ts`
- Modify: `src/app/app/repos/[repoId]/grading/page.tsx`

**Interfaces:**
- Consumes: `GradeSummary.unscored: UnscoredGrade | null` from Task 6.
- Produces: nothing later tasks consume.

**The one rule: the report shows whatever the card shows.** A completed grade wins if there is one. Otherwise, if the current run is `insufficient`, the card reads *Not scored* with the grader's sentence and the report renders that run's measurements without points. `?run=` continues to pin a completed historical run and overrides both.

That rule follows the existing failure path, which does not replace a card either: a `failed` run leaves the last completed grade on screen and says so in the status line. An insufficient run with no prior grade is the common case — a quiet repository has never scored a delivery grade — and that is where *Not scored* does its work.

**Points are suppressed, not zeroed.** The measurements are real and worth reading; the points are not, because nothing was scored, and printing `40 / 40` beside no score invites arithmetic a reader would then do wrong.

- [ ] **Step 1: Write the failing test**

Append to `src/components/grading/report.test.ts`. That file is a `.ts` file and renders with `createElement`, not JSX — follow it. `sha`, `renderToStaticMarkup` and `createElement` are already in scope there.

```ts
test('an unscored report prints measurements and no points', () => {
  const html = renderToStaticMarkup(
    createElement(GradeReport, {
      grade: {
        id: 'run-1',
        sha,
        computedAt: new Date('2026-09-14T03:00:00Z'),
        score: null,
        rubricVersion: '0.2.0',
        evaluatorVersion: '1.0.0',
        incompleteReason: 'Fewer than ten pull requests merged in this window.',
        checks: [
          {
            id: 'merges-land-clean',
            points: 0,
            maxPoints: 40,
            status: 'fail',
            paths: [],
            lineRanges: [],
            explanation: 'Too few merged pull requests passed on the first attempt.',
          },
        ],
      },
      owner: 'owner',
      name: 'repo',
      outdated: false,
      checkTitles: { 'merges-land-clean': 'Merges land clean' },
      graderTitle: 'Delivery Health',
      disclaimer: 'A disclaimer.',
    }),
  );
  expect(html).toContain('Fewer than ten pull requests merged in this window.');
  expect(html).toContain('Merges land clean');
  expect(html).not.toContain('0 / 40');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/grading/report.test.ts`
Expected: FAIL — the markup contains `0 / 40` and not the grader's sentence.

- [ ] **Step 3: Widen the client status union and stop the poll on the new state**

`src/components/grading/report.tsx` line 11:

```ts
  state: 'queued' | 'running' | 'complete' | 'failed' | 'insufficient';
```

Line 65, the poll's validation list:

```ts
          !['queued', 'running', 'complete', 'failed', 'insufficient'].includes(next.state)
```

Line 69, the terminal-state check:

```ts
        if (next.state === 'complete' || next.state === 'failed' || next.state === 'insufficient') {
```

Line 100, the button label — an insufficient run is finished, and running it again is the reasonable next move:

```ts
                : run?.state === 'failed' || run?.state === 'insufficient'
                  ? 'Run grader again'
                  : 'Run grader'}
```

And the status line (lines 113-121) gains a branch before the `failed` one:

```ts
          (run?.state === 'queued'
            ? 'Queued. Waiting to collect repository evidence.'
            : run?.state === 'running'
              ? 'Collecting and checking evidence at a pinned commit.'
              : run?.state === 'insufficient'
                ? 'There was not enough evidence to score this run. The measurements below are still worth reading.'
                : run?.state === 'failed'
                  ? run.errorCode === 'insufficient_evidence'
                    ? 'There is not enough record in this window to score. Try again once more work has merged.'
                    : 'The grader could not finish. Your last completed report is unchanged. Try again.'
                  : '')}
```

- [ ] **Step 4: Suppress points and surface the sentence in the report**

In `GradeReport`, add above the `return`:

```ts
  const scored = grade.score !== null;
```

Add the grader's sentence after the `outdated` block:

```ts
      {!scored && grade.incompleteReason && (
        <p className="grading-unscored">{grade.incompleteReason}</p>
      )}
```

And change the per-check heading (lines 157-160):

```ts
            <span>
              {check.status === 'pass' ? 'Pass' : 'Missing'}
              {scored && ` · ${check.points} / ${check.maxPoints}`}
            </span>
```

- [ ] **Step 5: Render the unscored run on the page**

`src/app/app/repos/[repoId]/grading/page.tsx`:

Line 79 — an unscored current run stands in when there is no grade:

```ts
  const grade = run ? historical : (summary?.latest ?? summary?.unscored ?? null);
```

Line 119 — the same fallback for every other card:

```ts
          const entryGrade = isSelected
            ? grade
            : (summaryFor(entry.id)?.latest ?? summaryFor(entry.id)?.unscored ?? null);
```

And the ungraded Surface (lines 139-146) distinguishes *not yet* from *not scored*:

```tsx
                  <Surface className="grading-ungraded">
                    <h2>{entry.card.title}</h2>
                    <p>{entry.card.tagline}</p>
                    <p>
                      {entryGrade
                        ? `Not scored. ${entryGrade.incompleteReason ?? ''}`
                        : 'Not graded yet. A score appears only after all evidence is collected. Run the grader to create the first report.'}
                    </p>
                  </Surface>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run src/components/grading/report.test.ts && pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/grading/report.tsx src/components/grading/report.test.ts \
  src/app/app/repos/[repoId]/grading/page.tsx
git commit -F - <<'MSG'
feat(grading): an unscored run reaches a reader

The card reads Not scored with the grader's own sentence beneath it
rather than fieldnote's generic error copy, and the report prints the
measurements without points — the numbers are real and worth reading,
the points are not, and printing 40 / 40 beside no score invites
arithmetic a reader would then do wrong.

The report shows whatever the card shows: a completed grade when there
is one, the unscored run otherwise, and a pinned ?run= over both.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XYMLqoucHKuCv2mpJeEJXL
MSG
```

---

### Task 9: `grade_schedules` and the `trigger` column

**Files:**
- Modify: `src/db/schema.ts` (new table after `gradeRuns`, new column on `gradeRuns`)
- Create: `drizzle/0014_grade_schedules.sql`

**Interfaces:**
- Consumes: the widened state from Task 6.
- Produces: `gradeSchedules` Drizzle table; `gradeRuns.trigger: 'manual' | 'schedule'`.

**One switch per card, not one per repository.** The graders answer different questions and move at different speeds — a delivery grade changes on its own every day, a readiness grade only when someone edits a file — and a repository-wide switch would silently start grading with a grader installed in slice 5 that nobody chose. `repositories.act_enabled` is the precedent for a per-repository opt-in and is the wrong shape here.

**Presence means on.** Turning it off deletes the row.

**`enabled_by` and `workspace_id` are not decoration.** `grade_runs.requested_by` and `requested_workspace_id` are both NOT NULL, and a scheduled run has to be somebody's. They are the provenance it copies.

**`trigger` exists so "nobody asked for this run" is answerable.** Without it a nightly run is indistinguishable from one the enabler clicked.

- [ ] **Step 1: Add the table and the column**

In `src/db/schema.ts`, add `trigger` to `gradeRuns` immediately after `retryOf`:

```ts
    // Provenance. Without it a nightly run is indistinguishable from one the
    // enabler clicked, and "nobody asked for this run" stops being answerable.
    trigger: text('trigger').$type<'manual' | 'schedule'>().notNull().default('manual'),
```

and its constraint, in the same array as the others:

```ts
    check('grade_runs_trigger', sql`${t.trigger} IN ('manual','schedule')`),
```

Then add the new table immediately after the `gradeRuns` definition:

```ts
// One row per (repository, grader) that grades nightly. Presence means on;
// turning it off deletes the row. Per grader rather than per repository
// because the graders answer different questions and move at different
// speeds — and because a repository-wide switch would silently start grading
// with a grader installed later that nobody chose.
export const gradeSchedules = pgTable(
  'grade_schedules',
  {
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    graderId: text('grader_id').notNull(),
    // Not decoration: grade_runs.requested_by and requested_workspace_id are
    // both NOT NULL, and a scheduled run has to be somebody's. This is the
    // provenance it copies.
    enabledBy: text('enabled_by')
      .notNull()
      .references(() => users.id),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.graderId] })],
);
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`

Rename the generated file to `drizzle/0014_grade_schedules.sql`, updating `drizzle/meta/_journal.json` to match. Its contents must be:

```sql
CREATE TABLE "grade_schedules" (
	"repository_id" text NOT NULL,
	"grader_id" text NOT NULL,
	"enabled_by" text NOT NULL,
	"workspace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grade_schedules_repository_id_grader_id_pk" PRIMARY KEY("repository_id","grader_id")
);
--> statement-breakpoint
ALTER TABLE "grade_schedules" ADD CONSTRAINT "grade_schedules_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_schedules" ADD CONSTRAINT "grade_schedules_enabled_by_users_id_fk" FOREIGN KEY ("enabled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_schedules" ADD CONSTRAINT "grade_schedules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Every existing run was clicked by somebody, which is what the default says.
ALTER TABLE "grade_runs" ADD COLUMN "trigger" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "grade_runs" ADD CONSTRAINT "grade_runs_trigger" CHECK ("grade_runs"."trigger" IN ('manual','schedule'));
```

Compare against the generated output and reconcile: the exact `created_at` default and the foreign-key constraint names must match whatever this codebase's `created()` helper and Drizzle version produce. Take Drizzle's spelling where they differ, and keep the two comments.

- [ ] **Step 3: Verify the migration applies**

Run: `DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/grade-runs.integration.test.ts`
Expected: PASS. That suite calls `migrate()` in `beforeAll`, so a broken migration fails here.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/0014_grade_schedules.sql drizzle/meta
git commit -F - <<'MSG'
feat(grading): a table for nightly schedules

One row per (repository, grader); presence means on. Per grader rather
than per repository because the graders answer different questions and
move at different speeds, and because a repository-wide switch would
silently start grading with a grader installed later that nobody chose.

enabled_by and workspace_id are the provenance a scheduled run copies:
grade_runs.requested_by and requested_workspace_id are both NOT NULL, and
a scheduled run has to be somebody's.

grade_runs.trigger records which kind of run it was, so "nobody asked for
this run" is answerable.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XYMLqoucHKuCv2mpJeEJXL
MSG
```

---

### Task 10: The session-free request path

**Files:**
- Modify: `src/db/queries/grade-runs.ts`

**Interfaces:**
- Consumes: `gradeRuns.trigger` from Task 9.
- Produces:
  ```ts
  export async function insertGradeRun(input: {
    repositoryId: string;
    graderId: string;
    manifest: GraderManifest;
    userId: string;
    workspaceId: string;
    trigger: 'manual' | 'schedule';
  }): Promise<{ id: string; state: GradeRun['state'] }>

  export async function scheduleGrade(input: {
    repositoryId: string;
    graderId: string;
    enabledBy: string;
    workspaceId: string;
  }): Promise<{ id: string; state: GradeRun['state'] }>

  export async function activeGradeRun(repositoryId: string, graderId: string): Promise<boolean>
  ```

`requestGrade()` cannot be reused: it calls `currentUser()` and `requireWorkspace()` on its first two lines. Its transaction body is exactly right, though — the advisory lock keyed by grader, the workspace `for update`, the availability join, the `retryOf` lookup and the conflict fallback. That body is what moves.

**The availability join inside the extracted body still re-checks membership, connection, installation and demo mode**, so the scheduler cannot create a run the session path would have refused. That is the security property this extraction must not lose.

`requestGrade()` keeps its signature exactly. A caller cannot tell it changed.

- [ ] **Step 1: Write the failing test**

Append to `src/db/grade-runs.integration.test.ts`:

```ts
test('a scheduled run is created with no session and records its trigger', async () => {
  const repositoryId = await fixtureRepository();
  const run = await scheduleGrade({
    repositoryId,
    graderId: AGENT_READINESS,
    enabledBy: context.user,
    workspaceId: context.workspace,
  });
  const stored = await loadGradeRun(run.id);
  expect(stored?.state).toBe('queued');
  expect(stored?.trigger).toBe('schedule');
  expect(stored?.requestedBy).toBe(context.user);
  expect(stored?.requestedWorkspaceId).toBe(context.workspace);
});

test('a manual run still records trigger manual', async () => {
  const repositoryId = await fixtureRepository();
  const run = await requestGrade(repositoryId, AGENT_READINESS);
  expect((await loadGradeRun(run.id))?.trigger).toBe('manual');
});

test('the scheduler cannot create a run for a repository the workspace lost', async () => {
  const repositoryId = await fixtureRepository();
  await db()
    .delete(workspaceRepositories)
    .where(eq(workspaceRepositories.repositoryId, repositoryId));
  await expect(
    scheduleGrade({
      repositoryId,
      graderId: AGENT_READINESS,
      enabledBy: context.user,
      workspaceId: context.workspace,
    }),
  ).rejects.toThrow('Repository unavailable');
});

test('activeGradeRun sees a queued run and not a completed one', async () => {
  const repositoryId = await fixtureRepository();
  const run = await requestGrade(repositoryId, AGENT_READINESS);
  expect(await activeGradeRun(repositoryId, AGENT_READINESS)).toBe(true);
  await failGrade(run.id);
  expect(await activeGradeRun(repositoryId, AGENT_READINESS)).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/grade-runs.integration.test.ts`
Expected: FAIL — `scheduleGrade` and `activeGradeRun` are not exported.

- [ ] **Step 3: Extract the transaction body**

In `src/db/queries/grade-runs.ts`, replace `requestGrade()` (lines 96-180) with these three functions, in this order:

```ts
/**
 * The half of a grade request that has no session: the advisory lock keyed by
 * grader, the workspace lock, the availability join, the retry lookup and the
 * conflict fallback. Both callers go through it, so a scheduled run cannot be
 * created where a clicked one would have been refused.
 *
 * Trusted primitive. The caller is responsible for having resolved the grader
 * and registered its rubric; the availability join here re-checks repository,
 * installation, workspace link, membership and demo mode regardless.
 */
export async function insertGradeRun(input: {
  repositoryId: string;
  graderId: string;
  manifest: GraderManifest;
  userId: string;
  workspaceId: string;
  trigger: 'manual' | 'schedule';
}): Promise<{ id: string; state: GradeRun['state'] }> {
  const { repositoryId, graderId, manifest, userId, workspaceId, trigger } = input;
  return db().transaction(async (tx) => {
    // The lock key names the grader too: two graders on one repository must
    // not serialise against each other now that the unique index no longer
    // makes them conflict.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${repositoryId}:grade:${graderId}`},0))`,
    );
    // Match workspace mutations' lock and recheck membership/link after initial authorization.
    await tx.execute(sql`select id from workspaces where id = ${workspaceId} for update`);
    const [available] = await tx
      .select({ id: repositories.id })
      .from(repositories)
      .innerJoin(installations, eq(installations.id, repositories.installationId))
      .innerJoin(
        workspaceRepositories,
        and(
          eq(workspaceRepositories.repositoryId, repositories.id),
          eq(workspaceRepositories.workspaceId, workspaceId),
        ),
      )
      .innerJoin(
        workspaceMemberships,
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(workspaceMemberships.userId, userId),
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
    const [latest] = await tx
      .select()
      .from(runs)
      .where(and(eq(runs.repositoryId, repositoryId), eq(runs.graderId, graderId)))
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(1);
    const [inserted] = await tx
      .insert(runs)
      .values({
        id: randomUUID(),
        repositoryId,
        graderId,
        rubricVersion: manifest.version,
        evaluatorVersion: manifest.evaluatorVersion,
        requestedBy: userId,
        requestedWorkspaceId: workspaceId,
        retryOf: latest?.state === 'failed' ? latest.id : null,
        state: 'queued',
        trigger,
      })
      .onConflictDoNothing()
      .returning();
    const active =
      inserted ??
      (
        await tx
          .select()
          .from(runs)
          .where(
            and(
              eq(runs.repositoryId, repositoryId),
              eq(runs.graderId, graderId),
              inArray(runs.state, ['queued', 'running']),
            ),
          )
      )[0];
    if (!active) throw new Error('Grade request unavailable');
    return { id: active.id, state: active.state };
  });
}

/** The session half: who is asking, and may they. */
export async function requestGrade(
  repositoryId: string,
  graderId: string,
): Promise<{ id: string; state: GradeRun['state'] }> {
  const manifest = getGrader(graderId);
  const repository = await requireRepository(repositoryId);
  const workspace = await requireWorkspace();
  if (workspace.id === 'demo' || repository.isDemo) throw new Error('Demo workspace is read-only');
  const user = await currentUser();
  await registerRubric(manifest);
  return insertGradeRun({
    repositoryId,
    graderId,
    manifest,
    userId: user.id,
    workspaceId: workspace.id,
    trigger: 'manual',
  });
}

/**
 * The scheduler half. It has the repository, grader, enabler and workspace
 * from the schedule row, so it needs no session — but insertGradeRun's
 * availability join still re-checks every condition requestGrade checks.
 */
export async function scheduleGrade(input: {
  repositoryId: string;
  graderId: string;
  enabledBy: string;
  workspaceId: string;
}): Promise<{ id: string; state: GradeRun['state'] }> {
  const manifest = getGrader(input.graderId);
  await registerRubric(manifest);
  return insertGradeRun({
    repositoryId: input.repositoryId,
    graderId: input.graderId,
    manifest,
    userId: input.enabledBy,
    workspaceId: input.workspaceId,
    trigger: 'schedule',
  });
}
```

Then add the worker primitive beside `loadGradeRun()`:

```ts
/** Trusted worker primitive: whether a run is already in flight for this pair.
 *  grade_runs_one_active would refuse the insert anyway; asking first avoids
 *  manufacturing an error to swallow. */
export async function activeGradeRun(repositoryId: string, graderId: string): Promise<boolean> {
  const [run] = await db()
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.repositoryId, repositoryId),
        eq(runs.graderId, graderId),
        inArray(runs.state, ['queued', 'running']),
      ),
    );
  return Boolean(run);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/grade-runs.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full unit suite**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. `requestGrade`'s signature and behaviour are unchanged, so nothing that calls it moves.

- [ ] **Step 6: Commit**

```bash
git add src/db/queries/grade-runs.ts src/db/grade-runs.integration.test.ts
git commit -F - <<'MSG'
feat(grading): a grade request without a session

requestGrade could not be reused by a scheduler: it calls currentUser()
and requireWorkspace() on its first two lines. Its transaction body is
exactly right, though, so that is what moved — the advisory lock keyed by
grader, the workspace lock, the availability join, the retry lookup and
the conflict fallback.

Both halves go through it, so a scheduled run cannot be created where a
clicked one would have been refused. requestGrade keeps its signature; a
caller cannot tell it changed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XYMLqoucHKuCv2mpJeEJXL
MSG
```

---

### Task 11: The schedule queries

**Files:**
- Create: `src/db/queries/grade-schedules.ts`
- Create: `src/db/grade-schedules.integration.test.ts`

**Interfaces:**
- Consumes: `gradeSchedules` table from Task 9. `getGrader` from `src/domain/grading/registry.ts`. `requireRepository`, `requireWorkspace` from `src/workspaces/access.ts`. `currentUser` from `src/auth/session.ts`.
- Produces:
  ```ts
  export type GradeScheduleView = { enabledBy: string; paused: boolean };
  export type GradeScheduleRow = {
    repositoryId: string;
    graderId: string;
    enabledBy: string;
    workspaceId: string;
  };

  export async function gradeSchedules(repositoryId: string): Promise<Record<string, GradeScheduleView>>
  export async function writeGradeSchedule(repositoryId: string, graderId: string, enabled: boolean): Promise<void>
  export async function listGradeSchedules(): Promise<GradeScheduleRow[]>
  export async function scheduleAvailable(row: GradeScheduleRow): Promise<boolean>
  ```

**A naming note.** The spec calls the writer `setGradeSchedule`. That name is taken by the server action in Task 12, exactly as `runGrade` (the action) wraps `requestGrade` (the query). The query layer is `writeGradeSchedule`; only the action is `setGradeSchedule`.

**`paused` is computed once for the page** rather than inferred in a component, so the card can say *paused* without knowing what membership is. It is the same condition `scheduleAvailable()` evaluates for the scheduler: the enabler is no longer a member of the workspace, or the workspace no longer has the repository connected.

- [ ] **Step 1: Write the failing test**

Create `src/db/grade-schedules.integration.test.ts`. **Name collision to watch:** `gradeSchedules` is both the Drizzle table in `./schema` and the query function in `./queries/grade-schedules`. Import the table aliased — `import { gradeSchedules as scheduleRows } from './schema';` — and use it for the `afterAll` cleanup.

Copy the fixture harness from `src/db/grade-runs.integration.test.ts` — the same `vi.hoisted` context, the same `vi.mock` calls for `../auth/session`, `next/headers`, `next/navigation` and `../lib/env`, the same `beforeAll` creating a user, a workspace and a membership, and the same `afterAll` cleanup extended to delete `gradeSchedules` rows.

```ts
test('a schedule is off until it is written, and presence means on', async () => {
  const repositoryId = await fixtureRepository();
  expect(await gradeSchedules(repositoryId)).toEqual({});
  await writeGradeSchedule(repositoryId, AGENT_READINESS, true);
  expect(await gradeSchedules(repositoryId)).toEqual({
    [AGENT_READINESS]: { enabledBy: context.user, paused: false },
  });
  await writeGradeSchedule(repositoryId, AGENT_READINESS, false);
  expect(await gradeSchedules(repositoryId)).toEqual({});
});

test('enabling twice is idempotent', async () => {
  const repositoryId = await fixtureRepository();
  await writeGradeSchedule(repositoryId, AGENT_READINESS, true);
  await writeGradeSchedule(repositoryId, AGENT_READINESS, true);
  expect(Object.keys(await gradeSchedules(repositoryId))).toEqual([AGENT_READINESS]);
});

test('an unknown grader is refused', async () => {
  const repositoryId = await fixtureRepository();
  await expect(writeGradeSchedule(repositoryId, 'nobody/nothing', true)).rejects.toThrow(
    ManifestError,
  );
});

test('the demo workspace is read-only', async () => {
  const repositoryId = await fixtureRepository();
  context.demo = true;
  try {
    await expect(writeGradeSchedule(repositoryId, AGENT_READINESS, true)).rejects.toThrow();
  } finally {
    context.demo = false;
  }
});

test('a user who is not a member cannot enable a schedule', async () => {
  const repositoryId = await fixtureRepository();
  await db()
    .delete(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, context.workspace),
        eq(workspaceMemberships.userId, context.user),
      ),
    );
  try {
    await expect(writeGradeSchedule(repositoryId, AGENT_READINESS, true)).rejects.toThrow(
      'Repository unavailable',
    );
  } finally {
    await db()
      .insert(workspaceMemberships)
      .values({ workspaceId: context.workspace, userId: context.user, role: 'member' })
      .onConflictDoNothing();
  }
});

test('a schedule pauses when the enabler leaves the workspace', async () => {
  const repositoryId = await fixtureRepository();
  await writeGradeSchedule(repositoryId, AGENT_READINESS, true);
  const row = (await listGradeSchedules()).find((entry) => entry.repositoryId === repositoryId)!;
  expect(await scheduleAvailable(row)).toBe(true);
  await db()
    .delete(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, context.workspace),
        eq(workspaceMemberships.userId, context.user),
      ),
    );
  try {
    expect(await scheduleAvailable(row)).toBe(false);
    expect((await gradeSchedules(repositoryId))[AGENT_READINESS].paused).toBe(true);
  } finally {
    await db()
      .insert(workspaceMemberships)
      .values({ workspaceId: context.workspace, userId: context.user, role: 'member' })
      .onConflictDoNothing();
  }
  // The row survives. Nothing is deleted, and it resumes by itself.
  expect(Object.keys(await gradeSchedules(repositoryId))).toEqual([AGENT_READINESS]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/grade-schedules.integration.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the query module**

Create `src/db/queries/grade-schedules.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { db } from '../index';
import {
  gradeSchedules as schedules,
  installations,
  repositories,
  workspaceMemberships,
  workspaceRepositories,
} from '../schema';
import { requireRepository, requireWorkspace } from '../../workspaces/access';
import { currentUser } from '../../auth/session';
// The same deliberate side-effect import grade-runs.ts documents: importing a
// grader module registers it, and a serverless entry point has no boot step to
// do that for us. writeGradeSchedule resolves a grader through getGrader(), so
// this module is one of the doors that has to have them registered.
import '../../domain/grading/graders';
import { getGrader } from '../../domain/grading/registry';

/** What the page needs to draw one toggle. Absent means off. */
export type GradeScheduleView = { enabledBy: string; paused: boolean };
/** What the scheduler needs to create one run. */
export type GradeScheduleRow = {
  repositoryId: string;
  graderId: string;
  enabledBy: string;
  workspaceId: string;
};

/**
 * Every schedule on one repository, keyed by grader id.
 *
 * `paused` is evaluated here rather than inferred in a component, so a card can
 * say "paused" without knowing what a membership is. It is the same condition
 * scheduleAvailable() evaluates for the scheduler.
 */
export async function gradeSchedules(
  repositoryId: string,
): Promise<Record<string, GradeScheduleView>> {
  await requireRepository(repositoryId);
  const rows = await db()
    .select({
      graderId: schedules.graderId,
      enabledBy: schedules.enabledBy,
      member: workspaceMemberships.userId,
      linked: workspaceRepositories.repositoryId,
    })
    .from(schedules)
    .leftJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.workspaceId, schedules.workspaceId),
        eq(workspaceMemberships.userId, schedules.enabledBy),
      ),
    )
    .leftJoin(
      workspaceRepositories,
      and(
        eq(workspaceRepositories.workspaceId, schedules.workspaceId),
        eq(workspaceRepositories.repositoryId, schedules.repositoryId),
      ),
    )
    .where(eq(schedules.repositoryId, repositoryId));
  return Object.fromEntries(
    rows.map((row) => [
      row.graderId,
      { enabledBy: row.enabledBy, paused: row.member === null || row.linked === null },
    ]),
  );
}

/**
 * Turn a schedule on or off. Session-bound, and authorized by the same route
 * requestGrade() uses: an unknown grader throws, the demo workspace is
 * read-only, and enabling requires an active repository on an active
 * installation, connected to the caller's workspace, of which they are a
 * member.
 *
 * Presence means on, so turning it off deletes the row. Enabling twice is a
 * no-op — taking over someone else's schedule is switching it off and on,
 * which writes your own enabled_by.
 */
export async function writeGradeSchedule(
  repositoryId: string,
  graderId: string,
  enabled: boolean,
): Promise<void> {
  getGrader(graderId);
  const repository = await requireRepository(repositoryId);
  const workspace = await requireWorkspace();
  if (workspace.id === 'demo' || repository.isDemo) throw new Error('Demo workspace is read-only');
  const user = await currentUser();
  if (!enabled) {
    await db()
      .delete(schedules)
      .where(and(eq(schedules.repositoryId, repositoryId), eq(schedules.graderId, graderId)));
    return;
  }
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
    .innerJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.workspaceId, workspace.id),
        eq(workspaceMemberships.userId, user.id),
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
  await db()
    .insert(schedules)
    .values({ repositoryId, graderId, enabledBy: user.id, workspaceId: workspace.id })
    .onConflictDoNothing();
}

/** Trusted worker primitive: every schedule, for the nightly pass. */
export async function listGradeSchedules(): Promise<GradeScheduleRow[]> {
  return db()
    .select({
      repositoryId: schedules.repositoryId,
      graderId: schedules.graderId,
      enabledBy: schedules.enabledBy,
      workspaceId: schedules.workspaceId,
    })
    .from(schedules);
}

/**
 * Trusted worker primitive: steps 1 and 2 of the nightly pass in one query —
 * an available repository, and a schedule that is not paused. A paused
 * schedule is skipped and its row survives, so it resumes by itself if the
 * enabler's access comes back.
 */
export async function scheduleAvailable(row: GradeScheduleRow): Promise<boolean> {
  if (process.env.DEMO_MODE === 'true') return false;
  const [available] = await db()
    .select({ id: repositories.id })
    .from(repositories)
    .innerJoin(installations, eq(installations.id, repositories.installationId))
    .innerJoin(
      workspaceRepositories,
      and(
        eq(workspaceRepositories.repositoryId, repositories.id),
        eq(workspaceRepositories.workspaceId, row.workspaceId),
      ),
    )
    .innerJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.workspaceId, row.workspaceId),
        eq(workspaceMemberships.userId, row.enabledBy),
      ),
    )
    .where(
      and(
        eq(repositories.id, row.repositoryId),
        eq(repositories.active, true),
        eq(repositories.isDemo, false),
        eq(installations.active, true),
      ),
    );
  return Boolean(available);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/grade-schedules.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/queries/grade-schedules.ts src/db/grade-schedules.integration.test.ts
git commit -F - <<'MSG'
feat(grading): read and write a nightly schedule

writeGradeSchedule is authorized by the same route requestGrade uses:
unknown grader, demo workspace, repository connection and membership.
Presence means on, so turning it off deletes the row.

paused is evaluated once for the page rather than inferred in a
component, so a card can say "paused" without knowing what a membership
is — and it is the same condition the scheduler evaluates.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XYMLqoucHKuCv2mpJeEJXL
MSG
```

---

### Task 12: The toggle

**Files:**
- Create: `src/components/grading/schedule-toggle.tsx`
- Modify: `src/app/app/repos/[repoId]/grading/actions.ts`
- Modify: `src/app/app/repos/[repoId]/grading/page.tsx`
- Modify: `src/components/grading/report.css`

**Interfaces:**
- Consumes: `gradeSchedules`, `writeGradeSchedule` from Task 11. `GradeSummary.unscored` wiring from Task 8.
- Produces: `setGradeSchedule(repositoryId: string, graderId: string, enabled: boolean): Promise<void>` as a server action. `<ScheduleToggle>` as a client component.

**The toggle sits beside the Run button, for the selected grader.** The schedule is per grader — that is what the table's primary key says — and the page already selects a grader with `?grader=`. One toggle at a time, next to the one Run button, rather than a control under every card.

**It works on a grader that has never run**, the way the Run button already does.

- [ ] **Step 1: Write the failing test**

Append to `src/components/grading/report.test.ts`, in the same `createElement` style that file already uses. Two existing lines there must change first: add `setGradeSchedule` to the actions mock, because `ScheduleToggle` imports from the same module —

```ts
vi.mock('../../app/app/repos/[repoId]/grading/actions', () => ({
  runGrade: vi.fn(),
  setGradeSchedule: vi.fn(),
}));
```

— and import the component:

```ts
import { ScheduleToggle } from './schedule-toggle';
```

Then the tests:

```ts
test('a paused schedule says why and offers to be taken over', () => {
  const html = renderToStaticMarkup(
    createElement(ScheduleToggle, {
      repositoryId: 'repo-1',
      graderId: AGENT_READINESS,
      schedule: { enabledBy: 'someone', paused: true },
      canRun: true,
    }),
  );
  expect(html).toContain('no longer has access');
  expect(html).toContain('Turn off nightly grading');
});

test('an off schedule offers to be turned on and says nothing about pausing', () => {
  const html = renderToStaticMarkup(
    createElement(ScheduleToggle, {
      repositoryId: 'repo-1',
      graderId: AGENT_READINESS,
      schedule: null,
      canRun: true,
    }),
  );
  expect(html).toContain('Grade nightly');
  expect(html).not.toContain('no longer has access');
});

test('a demo repository gets no toggle', () => {
  expect(
    renderToStaticMarkup(
      createElement(ScheduleToggle, {
        repositoryId: 'repo-1',
        graderId: AGENT_READINESS,
        schedule: null,
        canRun: false,
      }),
    ),
  ).toBe('');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/grading/report.test.ts`
Expected: FAIL — `ScheduleToggle` does not exist.

- [ ] **Step 3: Add the server action**

In `src/app/app/repos/[repoId]/grading/actions.ts`, add the import and the action:

```ts
import { writeGradeSchedule } from '../../../../../db/queries/grade-schedules';
```

```ts
// writeGradeSchedule resolves the grader through the registry, which throws on
// an unknown id, and checks workspace membership, repository connection and
// demo mode by the same route requestGrade() does.
export async function setGradeSchedule(
  repositoryId: string,
  graderId: string,
  enabled: boolean,
): Promise<void> {
  await writeGradeSchedule(repositoryId, graderId, enabled);
}
```

- [ ] **Step 4: Write the component**

Create `src/components/grading/schedule-toggle.tsx`:

```tsx
'use client';
import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@fieldnote/design-system';
import type { GradeScheduleView } from '../../db/queries/grade-schedules';
import { setGradeSchedule } from '../../app/app/repos/[repoId]/grading/actions';

/**
 * One schedule, for one grader. Presence means on, so the button toggles
 * between writing the row and deleting it.
 *
 * A paused schedule keeps its row and says why: nothing is deleted, it resumes
 * by itself if the enabler's access comes back, and anyone else can take it
 * over by switching it off and on — which writes their own enabled_by.
 */
export function ScheduleToggle({
  repositoryId,
  graderId,
  schedule,
  canRun,
}: {
  repositoryId: string;
  graderId: string;
  schedule: GradeScheduleView | null;
  canRun: boolean;
}) {
  const router = useRouter();
  const enabled = schedule !== null;
  const [error, action, pending] = useActionState(async () => {
    try {
      await setGradeSchedule(repositoryId, graderId, !enabled);
      router.refresh();
      return '';
    } catch {
      return 'Could not change the nightly schedule. Check your repository access and try again.';
    }
  }, '');
  if (!canRun) return null;
  return (
    <div className="grade-schedule">
      <form action={action}>
        <Button disabled={pending}>
          {pending ? 'Saving…' : enabled ? 'Turn off nightly grading' : 'Grade nightly'}
        </Button>
      </form>
      {enabled && schedule.paused && (
        <p className="muted">
          Paused — the person who turned this on no longer has access to this repository. Switch it
          off and on to take it over.
        </p>
      )}
      {error && <p role="status">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Wire it into the page**

`src/app/app/repos/[repoId]/grading/page.tsx`:

Add the imports:

```ts
import { gradeSchedules } from '../../../../../db/queries/grade-schedules';
import { ScheduleToggle } from '../../../../../components/grading/schedule-toggle';
```

Add `gradeSchedules(repoId)` to the existing `Promise.all` (lines 65-74) as a sixth entry, destructured as `schedules`:

```ts
  const [summaries, history, historical, enabled, plan, schedules] = await Promise.all([
    gradeSummaries(
      [repoId],
      graders.map((entry) => entry.id),
    ),
    gradeHistory(repoId, selectedGrader.id),
    run ? getGrade(repoId, run, selectedGrader.id) : Promise.resolve(null),
    actEnabled(repoId),
    latestPlan(repoId),
    gradeSchedules(repoId),
  ]);
```

And render the toggle immediately after `<GradeControls …/>` (line 153-159):

```tsx
      <ScheduleToggle
        repositoryId={repoId}
        graderId={selectedGrader.id}
        schedule={schedules[selectedGrader.id] ?? null}
        canRun={!repo.isDemo}
      />
```

- [ ] **Step 6: Style it**

Append to `src/components/grading/report.css`:

```css
.grade-schedule {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-block-start: 0.75rem;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run src/components/grading/report.test.ts && pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/grading/schedule-toggle.tsx src/components/grading/report.css \
  src/components/grading/report.test.ts \
  src/app/app/repos/[repoId]/grading/actions.ts \
  src/app/app/repos/[repoId]/grading/page.tsx
git commit -F - <<'MSG'
feat(grading): a switch for nightly grading

Beside the Run button and for the selected grader, because the schedule
is per grader and the page already selects one. It works on a grader that
has never run, the way the Run button already does.

A paused schedule keeps its row and says why. Nothing is deleted, it
resumes by itself if the enabler's access comes back, and anyone else can
take it over by switching it off and on.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XYMLqoucHKuCv2mpJeEJXL
MSG
```

---

### Task 13: The nightly scheduler

**Files:**
- Create: `src/inngest/functions/schedule-grades.ts`
- Create: `src/inngest/functions/schedule-grades.test.ts`
- Modify: `src/app/api/inngest/route.ts`

**Interfaces:**
- Consumes: `listGradeSchedules()`, `scheduleAvailable(row)`, `GradeScheduleRow` from Task 11. `scheduleGrade(input)`, `activeGradeRun()`, `latestCompletedGrade()` from Task 10 and the existing module. `resolveHeadSha()` from Task 1. `getGrader()` from the registry. `dispatchGrade()` from `src/inngest/dispatch-grade.ts`.
- Produces: `scheduleGrades` (the Inngest function) and `scheduleIfDue(row): Promise<string | null>` (exported for unit testing, the way `evaluateGradeRun` is).

**`0 3 * * *`, not `* * * * *`.** The reconcilers recover dropped events; this creates work. Three in the morning UTC rather than midnight, so the night's imports have landed before anything reads them.

**The five steps, in order:**

1. **Skip an unavailable repository** — inactive repository, inactive installation, or `is_demo`.
2. **Skip a paused schedule** — the enabler is no longer a member, or the workspace no longer has the repository connected. Leave the row in place.
3. **Skip if a run is already active** for that pair. `grade_runs_one_active` would refuse the insert anyway; asking first avoids manufacturing an error to swallow.
4. **Skip if nothing it reads has changed**, decided by `subject`. `repository` — resolve the head sha; if it equals the sha of the most recent scored run, skip, because the same commit with the same manifest produces the same score and the row would be noise on the history list the product asks people to read. `repository_window` — always run; the window moved by definition, which is the whole reason the subject exists.
5. **Otherwise create the run and dispatch it** onto the existing queue, unchanged from the Run button down.

Steps 1 and 2 are one query — `scheduleAvailable()`.

**An idle repository therefore costs one sha lookup a night** rather than a tree walk and a pile of blob fetches. That is what makes nightly grading acceptable now, not safe forever: it is uncapped, and a quota belongs with whatever first shows a bill.

- [ ] **Step 1: Write the failing test**

Create `src/inngest/functions/schedule-grades.test.ts`:

```ts
import { beforeEach, expect, test, vi } from 'vitest';

const schedules = vi.hoisted(() => ({ scheduleAvailable: vi.fn(), listGradeSchedules: vi.fn() }));
const runs = vi.hoisted(() => ({
  scheduleGrade: vi.fn(),
  activeGradeRun: vi.fn(),
  latestCompletedGrade: vi.fn(),
}));
const github = vi.hoisted(() => ({ resolveHeadSha: vi.fn() }));
vi.mock('../../db/queries/grade-schedules', () => schedules);
vi.mock('../../db/queries/grade-runs', () => runs);
vi.mock('../../github/collect-files', () => github);

const { scheduleIfDue } = await import('./schedule-grades');
const { AGENT_READINESS } = await import('../../domain/grading/graders/agent-readiness');
const { DELIVERY_HEALTH } = await import('../../domain/grading/graders/delivery-health');

const readinessRow = {
  repositoryId: 'repo-1',
  graderId: AGENT_READINESS,
  enabledBy: 'user-1',
  workspaceId: 'workspace-1',
};
const deliveryRow = { ...readinessRow, graderId: DELIVERY_HEALTH };

beforeEach(() => {
  vi.resetAllMocks();
  schedules.scheduleAvailable.mockResolvedValue(true);
  runs.activeGradeRun.mockResolvedValue(false);
  runs.latestCompletedGrade.mockResolvedValue(null);
  runs.scheduleGrade.mockResolvedValue({ id: 'run-1', state: 'queued' });
  github.resolveHeadSha.mockResolvedValue('a'.repeat(40));
});

test('an unavailable repository or a paused schedule creates nothing', async () => {
  schedules.scheduleAvailable.mockResolvedValue(false);
  expect(await scheduleIfDue(readinessRow)).toBeNull();
  expect(runs.scheduleGrade).not.toHaveBeenCalled();
  expect(github.resolveHeadSha).not.toHaveBeenCalled();
});

test('an active run creates nothing', async () => {
  runs.activeGradeRun.mockResolvedValue(true);
  expect(await scheduleIfDue(readinessRow)).toBeNull();
  expect(runs.scheduleGrade).not.toHaveBeenCalled();
});

test('a repository grader skips an unchanged head sha', async () => {
  runs.latestCompletedGrade.mockResolvedValue({ sha: 'a'.repeat(40) });
  expect(await scheduleIfDue(readinessRow)).toBeNull();
  expect(runs.scheduleGrade).not.toHaveBeenCalled();
});

test('a repository grader runs when the head sha moved', async () => {
  runs.latestCompletedGrade.mockResolvedValue({ sha: 'b'.repeat(40) });
  expect(await scheduleIfDue(readinessRow)).toBe('run-1');
  expect(runs.scheduleGrade).toHaveBeenCalledWith(readinessRow);
});

test('a repository grader runs when nothing has ever scored', async () => {
  expect(await scheduleIfDue(readinessRow)).toBe('run-1');
});

test('a window grader always runs and never looks up a sha', async () => {
  expect(await scheduleIfDue(deliveryRow)).toBe('run-1');
  expect(github.resolveHeadSha).not.toHaveBeenCalled();
  expect(runs.scheduleGrade).toHaveBeenCalledWith(deliveryRow);
});

test('an unknown grader is skipped rather than thrown', async () => {
  expect(await scheduleIfDue({ ...readinessRow, graderId: 'nobody/nothing' })).toBeNull();
  expect(runs.scheduleGrade).not.toHaveBeenCalled();
});

test('nothing is scheduled under DEMO_MODE', async () => {
  const previous = process.env.DEMO_MODE;
  process.env.DEMO_MODE = 'true';
  try {
    // scheduleAvailable() is the guard, and it is the first thing consulted.
    schedules.scheduleAvailable.mockImplementation(
      async () => process.env.DEMO_MODE !== 'true',
    );
    expect(await scheduleIfDue(readinessRow)).toBeNull();
    expect(runs.scheduleGrade).not.toHaveBeenCalled();
  } finally {
    process.env.DEMO_MODE = previous;
  }
});

test('a sha lookup failure skips this schedule and not the whole pass', async () => {
  github.resolveHeadSha.mockRejectedValue(new Error('GitHub is unavailable'));
  expect(await scheduleIfDue(readinessRow)).toBeNull();
  expect(runs.scheduleGrade).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/inngest/functions/schedule-grades.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the scheduler**

Create `src/inngest/functions/schedule-grades.ts`:

```ts
import { inngest } from '../client';
import { dispatchGrade } from '../dispatch-grade';
import {
  listGradeSchedules,
  scheduleAvailable,
  type GradeScheduleRow,
} from '../../db/queries/grade-schedules';
import {
  activeGradeRun,
  latestCompletedGrade,
  scheduleGrade,
} from '../../db/queries/grade-runs';
import { resolveHeadSha } from '../../github/collect-files';
import { getGrader } from '../../domain/grading/registry';

/**
 * One schedule's decision, in the order the design gives: an available
 * repository and an unpaused schedule, no run already in flight, and something
 * that has actually changed since the last scored run.
 *
 * Returns the id of a run to dispatch, or null to skip. A skip is never an
 * error: one repository's bad night must not stop the pass.
 */
export async function scheduleIfDue(row: GradeScheduleRow): Promise<string | null> {
  // Steps 1 and 2: an available repository, and a schedule whose enabler still
  // has access. A paused schedule is skipped and its row survives.
  if (!(await scheduleAvailable(row))) return null;
  let manifest;
  try {
    manifest = getGrader(row.graderId);
  } catch {
    // A schedule for a grader nothing registers is inert, not fatal.
    return null;
  }
  // Step 3. grade_runs_one_active would refuse the insert anyway; asking first
  // avoids manufacturing an error to swallow.
  if (await activeGradeRun(row.repositoryId, row.graderId)) return null;
  // Step 4. A window grader always runs — the window moved by definition, which
  // is the whole reason the subject exists. A repository grader costs one sha
  // lookup and stops there if the commit is the one it already scored: same
  // commit, same manifest, same score, and the row would be noise on the
  // history list the product asks people to read.
  if (manifest.subject === 'repository') {
    let head: string;
    try {
      head = await resolveHeadSha(row.repositoryId);
    } catch {
      return null;
    }
    const latest = await latestCompletedGrade(row.repositoryId, row.graderId);
    if (latest?.sha === head) return null;
  }
  // Step 5.
  const run = await scheduleGrade(row);
  return run.state === 'queued' ? run.id : null;
}

/**
 * `0 3 * * *`, not the `* * * * *` the reconcilers use: those recover dropped
 * events, this creates work. Three in the morning UTC rather than midnight, so
 * the night's imports have landed before anything reads them.
 */
export const scheduleGrades = inngest.createFunction(
  { id: 'schedule-grades', triggers: [{ cron: '0 3 * * *' }] },
  async ({ step }) => {
    if (process.env.DEMO_MODE === 'true') return { demo: true };
    const rows = await step.run('list-schedules', listGradeSchedules);
    let created = 0;
    for (const row of rows) {
      const runId = await step.run(`schedule-${row.repositoryId}-${row.graderId}`, async () => {
        try {
          return await scheduleIfDue(row);
        } catch {
          // One repository's bad night must not stop the pass. The next tick
          // tries again; nothing was written.
          return null;
        }
      });
      if (!runId) continue;
      created += 1;
      await step.run(`dispatch-${runId}`, async () => {
        try {
          await dispatchGrade(runId);
        } catch {
          /* A queued run with no dispatch is what reconcile-grades is for. */
        }
      });
    }
    return { schedules: rows.length, created };
  },
);
```

Note `scheduleGrade(row)` takes the row directly — `GradeScheduleRow` has exactly the four fields its input needs.

- [ ] **Step 4: Register the function**

`src/app/api/inngest/route.ts` — add the import beside the other grading ones and the entry beside `reconcileGrades`:

```ts
import { scheduleGrades } from '../../../inngest/functions/schedule-grades';
```
```ts
    reconcileGrades,
    scheduleGrades,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run src/inngest/functions/schedule-grades.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the end-to-end integration test**

Append to `src/db/grade-schedules.integration.test.ts`:

```ts
test('a scheduled run reaches the queue with no session', async () => {
  const repositoryId = await fixtureRepository();
  await writeGradeSchedule(repositoryId, AGENT_READINESS, true);
  const row = (await listGradeSchedules()).find((entry) => entry.repositoryId === repositoryId)!;
  const runId = await scheduleIfDue(row);
  expect(runId).not.toBeNull();
  const stored = await loadGradeRun(runId!);
  expect(stored?.state).toBe('queued');
  expect(stored?.trigger).toBe('schedule');
  expect(stored?.requestedBy).toBe(context.user);
});

test('the second night skips a repository whose head sha has not moved', async () => {
  const repositoryId = await fixtureRepository();
  await writeGradeSchedule(repositoryId, AGENT_READINESS, true);
  const row = (await listGradeSchedules()).find((entry) => entry.repositoryId === repositoryId)!;
  const runId = (await scheduleIfDue(row))!;
  // Complete it at the sha the mocked resolveHeadSha returns, then ask again.
  await beginGrade(runId);
  await pinGradeSha(runId, HEAD_SHA);
  await completeGrade(runId, {
    score: 100,
    checks: [],
    rubricVersion: agentReadinessManifest.version,
    evaluatorVersion: agentReadinessManifest.evaluatorVersion,
  });
  expect(await scheduleIfDue(row)).toBeNull();
});
```

This file must mock `../github/collect-files` so `resolveHeadSha` returns a fixed `HEAD_SHA` rather than reaching GitHub. Add at the top, beside the other mocks:

```ts
const HEAD_SHA = 'a'.repeat(40);
vi.mock('../github/collect-files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../github/collect-files')>()),
  resolveHeadSha: async () => HEAD_SHA,
}));
```

- [ ] **Step 7: Run the integration tests**

Run: `DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/grade-schedules.integration.test.ts src/db/grade-runs.integration.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && DEMO_MODE=false pnpm test:integration && pnpm build`
Expected: PASS, except the known baseline — 2 failures of 171 in `src/inngest/dispatch-import.integration.test.ts`, which reproduce on `main`. Any other failure is yours.

- [ ] **Step 9: Confirm the acceptance test never moved**

Run: `git diff main -- src/domain/grading/readiness-v01.test.ts`
Expected: empty output.

- [ ] **Step 10: Commit**

```bash
git add src/inngest/functions/schedule-grades.ts src/inngest/functions/schedule-grades.test.ts \
  src/app/api/inngest/route.ts src/db/grade-schedules.integration.test.ts
git commit -F - <<'MSG'
feat(grading): grade nightly

0 3 * * * rather than the * * * * * the reconcilers use: those recover
dropped events, this creates work, and three in the morning UTC lets the
night's imports land before anything reads them.

Five steps per schedule: an available repository, an unpaused schedule,
no run already in flight, something that has actually changed, then
create and dispatch. A repository grader whose head sha matches its last
scored run is skipped — same commit, same manifest, same score, and the
row would be noise on the history list the product asks people to read.
A window grader always runs, because the window moved by definition.

An idle repository therefore costs one sha lookup a night. That is what
makes nightly grading acceptable now, not safe forever: it is uncapped,
and a quota belongs with whatever first shows a bill.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XYMLqoucHKuCv2mpJeEJXL
MSG
```

---

## What this plan knowingly leaves wrong

Carried from the spec, so a reviewer does not file them as defects:

- **The consent gap becomes real.** After Task 2 a grader receives whatever it declared, up to the caps, which means an installed third-party grader could read any file in the repository. Harmless while both graders are ours and register at boot. `collectEvidence()` is the one place the check belongs — it is the one place that knows both the manifest's `needs` and the repository it is about to read — and Task 5 puts that sentence in its docstring. Slice 5 must not put it anywhere else, and must not let an install flow ship without it.
- **The window still includes the current day.** `resolveRange()` presets run to `today + 1 day`, so a grade at 03:00 UTC scores twenty-nine whole days and three hours. The Delivery tab has always done this and the numbers agree with each other, which is worth more than either being separately tidier. Changing it is a dashboard decision, not a grading one.
- **A paused schedule needs a human to notice.** One line on the card, seen by whoever next opens the page. No email, no badge.
- **Nightly grading is uncapped.** Every enabled pair runs every night, bounded only by how many people switch it on.
- **No test builds a manifest declaring both evidence families.** Parked from slice 2, roughly fifteen lines.
