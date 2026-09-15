# Grader Factory Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A grader can ship a program that runs in a sandbox and decides pass or fail — and nothing else — proven by a first built-in code grader, `fieldnote/test-discipline`, reading a new `repo.tree` evidence family.

**Architecture:** The manifest schema discriminates on `kind`; a `kind: code` manifest carries its program's text and checks without primitives. The broker gains a `repo.tree` collector sharing `collectFiles`' tree walk. A four-operation sandbox port (`create`, `write`, `exec`, `destroy`) has a local adapter (tests, development) and an E2B adapter (production); both run `node --permission` so the filesystem and process locks are properties of the command. The program's answer is parsed strictly by a pure assembly function that builds the report from the manifest's prose, so there is no field a program could put markup into. The worker reads a verdict from an `evaluate()` function instead of the broker's error code, and the scheduler's skip reads evidence-family labels.

**Tech Stack:** TypeScript 6, Next.js 16, Zod 4, Drizzle ORM, Inngest 4, Vitest 4, Node 24 permission model, `e2b` 2.49.1.

**Spec:** `docs/superpowers/specs/2026-09-14-grader-factory-slice-4-design.md`

## Global Constraints

- `src/domain/grading/readiness-v01.test.ts` must stay **byte-identical to `main`** and pass. Editing it is never the fix.
- A built-in grader is an ordinary grader: **no `if` naming a grader id inside `src/domain/grading` or `src/grading`**. Branching on `manifest.kind` is allowed; it is a property of the contract.
- **Do not remove** the side-effect `import '../../domain/grading/graders';` in `src/db/queries/grade-runs.ts` or `src/db/queries/grade-schedules.ts`.
- Never `git add -A` or `git add .`; stage explicit paths.
- Do not touch `.agents/`, `.claude/` or `skills-lock.json`.
- `eslint .` walks sibling worktrees under `.claude/worktrees/`; failures there are not yours.
- Every commit message ends with exactly this trailer and no other `Co-Authored-By` line: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Do not write your own model name.
- Gate: `pnpm check` with `DEMO_MODE=false` on the command line for the integration run. Known baseline: 2 integration failures in `src/inngest/dispatch-import.integration.test.ts` that reproduce on `main`. Another session may share the test database — re-run before concluding an integration failure is real.
- `src/domain/grading` never imports anything under `src/grading/sandbox/` or any vendor SDK.
- Limits, verbatim from the spec: exec timeout **20 s**; stdout cap **256 KiB**; E2B box lifetime **60 s** (`timeoutMs: 60_000`); at most **20** paths per check; `needs_too_broad` at **20** patterns; tree entry cap **10 000**.
- Copy, verbatim from the spec: `sandbox_unavailable` reads "Grading is temporarily unavailable. Try again later."; `grader_failed` reads today's "The grader could not finish. Your last completed report is unchanged. Try again."
- Nothing a program printed, and no vendor error message, is ever stored or logged. Only error codes.

## Plan-level rulings

- **Ruling: the live E2B probe is the last task, not the first** — the spec puts it first, but no `E2B_API_KEY` exists in `.env`, `.env.local` or the shell on 2026-09-14. Every other task is independent of the template's Node version (the command is identical in both adapters), so building first loses nothing. — **Cost if wrong:** if E2B's `base` template lacks Node ≥ 22.13, Task 12's adapter needs a `template` option and the spec's custom-template decision goes back to the user; no other task changes.
- **Ruling: a code grader whose snapshot is incomplete because of a metrics floor fails with `insufficient_evidence`**, not `insufficient`. The spec says an incomplete snapshot never creates a box; `failGrade` keeps `insufficient_evidence` on its whitelist as the backstop its comment describes. No built-in code grader declares `fieldnote.metrics`. — **Cost if wrong:** one branch in `evaluate()`.
- **Ruling: duplicate paths in a program's answer are de-duplicated, not rejected.** The report renders paths with `key={path}`; the spec's rejection list does not name duplicates. — **Cost if wrong:** one extra rejection case.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/domain/grading/manifest.ts` (modify) | `kind`-discriminated schema, code checks, `code.source`, top-level `insufficientReason`, `repo.tree` need, `FAMILY_CHANGES`, `changesOverTime()` |
| `src/domain/grading/registry.ts` (modify) | Accept `kind: code` |
| `src/domain/grading/declarative.ts` (modify) | Refuse a code manifest by kind |
| `src/domain/grading/types.ts` (modify) | `TreeEntry`, `RepositorySnapshot.tree` |
| `src/github/collect-files.ts` (modify) | Shared `walkTree()`, new `collectTree()` |
| `src/grading/evidence.ts` (modify) | `repo.tree` branch |
| `src/domain/grading/code.ts` (create) | `GraderFailedError`, `codeGraderInput()`, `assembleCodeResult()` — pure |
| `src/grading/sandbox/port.ts` (create) | `Sandbox`, `SandboxHandle`, `ExecResult` |
| `src/grading/sandbox/errors.ts` (create) | `SandboxUnavailableError` |
| `src/grading/sandbox/runner.ts` (create) | `RUNNER_SOURCE`, `graderCommand()` |
| `src/grading/sandbox/local.ts` (create) | Local adapter |
| `src/grading/sandbox/hostile.fixture.ts` (create) | The misbehaving program, shared by the local and live suites |
| `src/grading/sandbox/index.ts` (create) | `selectSandbox()` |
| `src/grading/sandbox/e2b.ts` (create) | E2B adapter |
| `src/grading/run-code.ts` (create) | `runCodeGrader()`, `GRADER_LIMITS` |
| `src/grading/evaluate.ts` (create) | `evaluate()` → `Evaluation` verdict |
| `src/inngest/functions/grade-repository.ts` (modify) | Verdict routing, failure codes, `finalFailureCode()` |
| `src/db/queries/grade-runs.ts` (modify) | `failGrade` whitelist, `latestFinishedGrade()` |
| `src/components/grading/report.tsx` (modify) | `sandbox_unavailable` copy |
| `src/inngest/functions/schedule-grades.ts` (modify) | Skip via labels, version and insufficient runs |
| `src/domain/grading/graders/test-discipline/grader.mjs` (create) | The program |
| `src/domain/grading/graders/test-discipline/source.generated.ts` (create, generated) | The program's text |
| `scripts/embed-graders.ts` (create) | Writes `source.generated.ts` |
| `src/domain/grading/graders/test-discipline.ts` (create) | The manifest |
| `src/domain/grading/graders/index.ts` (modify) | Register the third built-in |
| `src/demo/fixtures.ts`, `scripts/seed.ts` (modify) | Third demo card |

---

### Task 1: The manifest learns `kind: code`, `repo.tree` and the family labels

**Files:**
- Modify: `src/domain/grading/manifest.ts`
- Modify: `src/domain/grading/registry.ts:9-18`
- Modify: `src/domain/grading/declarative.ts:23-30`
- Test: `src/domain/grading/manifest.test.ts`, `src/domain/grading/registry.test.ts`

**Interfaces:**
- Produces:
  - `type GraderManifest` — union of `DeclarativeManifest | CodeManifest`
  - `type DeclarativeManifest = Extract<GraderManifest, { kind: 'declarative' }>`
  - `type CodeManifest = Extract<GraderManifest, { kind: 'code' }>` with `code: { source: string }`, `insufficientReason?: string`, `checks: { id; title; points; explain: { pass; fail } }[]`
  - `type GraderCheck = DeclarativeManifest['checks'][number]` (unchanged meaning)
  - `type EvidenceFamily = keyof GraderManifest['needs']` — `'repo.files' | 'repo.tree' | 'fieldnote.metrics'`
  - `const FAMILY_CHANGES: Record<EvidenceFamily, 'with-commits' | 'over-time'>`
  - `function changesOverTime(manifest: { needs: GraderManifest['needs'] }): boolean`
  - `ManifestErrorCode` loses `'kind_unsupported'`
  - `runDeclarative(manifest: GraderManifest, snapshot)` throws `Error('runDeclarative runs declarative graders only')` for a code manifest

- [ ] **Step 1: Write the failing manifest tests**

Append to `src/domain/grading/manifest.test.ts` (and change the import line to `import { changesOverTime, FAMILY_CHANGES, ManifestError, parseManifest } from './manifest';`):

```ts
const validCode = (): Draft => ({
  ...valid(),
  id: 'fieldnote/code-example',
  kind: 'code',
  needs: { 'repo.tree': ['**/*'] },
  code: { source: 'export default () => ({ checks: [] });' },
  insufficientReason: 'Too little here to judge.',
  checks: [
    { id: 'a', title: 'A', points: 60, explain: { pass: 'Yes.', fail: 'No.' } },
    { id: 'b', title: 'B', points: 40, explain: { pass: 'Yes.', fail: 'No.' } },
  ],
});

test('a code manifest parses and keeps its program', () => {
  const manifest = parseManifest(validCode());
  expect(manifest.kind).toBe('code');
  if (manifest.kind !== 'code') throw new Error('expected a code manifest');
  expect(manifest.code.source).toContain('export default');
  expect(manifest.insufficientReason).toBe('Too little here to judge.');
});

test('a code check carrying a primitive is a schema error', () => {
  rejects((m) => {
    m.checks[0].primitive = 'file-exists';
    m.checks[0].args = { anyOf: ['README.md'] };
  }, 'schema', validCode);
});

test('a code manifest without its program is a schema error', () => {
  rejects((m) => void delete m.code, 'schema', validCode);
});

test('a declarative manifest carrying a program is a schema error', () => {
  rejects((m) => void (m.code = { source: 'export default () => ({});' }), 'schema');
});

test('a declarative manifest with a top-level insufficientReason is a schema error', () => {
  rejects((m) => void (m.insufficientReason = 'Too little.'), 'schema');
});

test('a declarative manifest declaring repo.tree is needs_mismatch, because no primitive reads it', () => {
  rejects((m) => void (m.needs['repo.tree'] = ['**/*']), 'needs_mismatch');
});

test('a code grader may declare a family fieldnote cannot see it read', () => {
  const draft = validCode();
  draft.needs = { 'repo.files': ['README.md'], 'repo.tree': ['**/*'] };
  expect(parseManifest(draft).kind).toBe('code');
});

test('more than twenty repo.tree patterns is needs_too_broad', () => {
  rejects(
    (m) => void (m.needs['repo.tree'] = Array.from({ length: 21 }, (_, i) => `dir${i}/**`)),
    'needs_too_broad',
    validCode,
  );
});

test('a repo.tree grader must say subject: repository', () => {
  rejects((m) => void (m.subject = 'repository_window'), 'subject_mismatch', validCode);
});

test('a code grader reading fieldnote.metrics must say subject: repository_window', () => {
  rejects(
    (m) =>
      void (m.needs = {
        'fieldnote.metrics': { windowDays: 30, minMergedPullRequests: 1, insufficientReason: 'Quiet.' },
      }),
    'subject_mismatch',
    validCode,
  );
});

test('every evidence family has exactly one label', () => {
  expect(Object.keys(FAMILY_CHANGES).sort()).toEqual(['fieldnote.metrics', 'repo.files', 'repo.tree']);
});

test('changesOverTime reads the labels of the declared families only', () => {
  expect(changesOverTime({ needs: { 'repo.tree': ['**/*'] } })).toBe(false);
  expect(changesOverTime({ needs: { 'repo.files': ['README.md'] } })).toBe(false);
  expect(
    changesOverTime({
      needs: {
        'fieldnote.metrics': { windowDays: 30, minMergedPullRequests: 10, insufficientReason: 'Quiet.' },
      },
    }),
  ).toBe(true);
});
```

- [ ] **Step 2: Replace the registry's `kind: code` test**

In `src/domain/grading/registry.test.ts`, replace the test `'kind: code is accepted by the schema and rejected at registration'` entirely with:

```ts
test('kind: code registers like any other grader', () => {
  const registered = registerGrader({
    ...manifest({
      id: 'fieldnote/code-fixture',
      kind: 'code',
      code: { source: 'export default () => ({ checks: [] });' },
      needs: { 'repo.tree': ['**/*'] },
    }),
    checks: [
      {
        id: 'readme',
        title: 'Project documentation',
        points: 100,
        explain: { pass: 'Found a README.', fail: 'No README.' },
      },
    ],
  });
  expect(registered.kind).toBe('code');
  expect(getGrader('fieldnote/code-fixture').kind).toBe('code');
});

test('runDeclarative refuses a code manifest by kind', () => {
  const code = getGrader('fieldnote/code-fixture');
  expect(() => runDeclarative(code, { sha: 'abc', complete: true, documents: [] })).toThrow(
    'runDeclarative runs declarative graders only',
  );
});
```

`ManifestError` may now be unused in this file; remove the import if lint says so.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run src/domain/grading/manifest.test.ts src/domain/grading/registry.test.ts`
Expected: FAIL — `changesOverTime`/`FAMILY_CHANGES` are not exported, code manifests are rejected.

- [ ] **Step 4: Rewrite the schema half of `manifest.ts`**

Replace everything from `// A lookup, not a conditional, on purpose` (line 23) through `export type GraderCheck = GraderManifest['checks'][number];` (line 152) with:

```ts
export type ManifestErrorCode =
  | 'schema'
  | 'subject_unsupported'
  | 'unknown_grader'
  | 'points_not_100'
  | 'duplicate_check_id'
  | 'check_not_grouped'
  | 'check_grouped_twice'
  | 'unknown_check_grouped'
  | 'needs_empty'
  | 'needs_mismatch'
  | 'needs_too_broad'
  | 'subject_mismatch';

export class ManifestError extends Error {
  constructor(
    readonly code: ManifestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ManifestError';
  }
}

const nonEmpty = z.string().min(1);
const semver = z.string().regex(/^\d+\.\d+\.\d+$/);
const scopeEntry = z.object({ pattern: nonEmpty, caseInsensitive: z.boolean().default(false) });

// The common half of every check. Title and explanations are the grader's
// prose: fieldnote holds none of it, which is the point of the move.
const checkBase = {
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: nonEmpty,
  points: z.number().int().positive(),
  explain: z.object({ pass: nonEmpty, fail: nonEmpty }),
};

const checkSchema = z.discriminatedUnion('primitive', [
  z.object({
    ...checkBase,
    primitive: z.literal('file-exists'),
    args: z.object({
      root: z.boolean().default(false),
      nonempty: z.boolean().default(false),
      anyOf: z.array(nonEmpty).min(1),
      caseInsensitive: z.boolean().default(false),
    }),
  }),
  z.object({
    ...checkBase,
    primitive: z.literal('glob-count'),
    args: z.object({
      pattern: nonEmpty,
      caseInsensitive: z.boolean().default(false),
      nonempty: z.boolean().default(false),
      min: z.number().int().positive().default(1),
    }),
  }),
  z.object({
    ...checkBase,
    primitive: z.literal('heading-has-fence'),
    args: z.object({
      headings: z.array(nonEmpty).min(1),
      scope: z.array(scopeEntry).min(1),
    }),
  }),
  z.object({
    ...checkBase,
    primitive: z.literal('metric-threshold'),
    args: z.object({
      metric: z.enum(GRADER_METRICS),
      atLeastPercent: z.number().int().min(0).max(100),
    }),
  }),
]);

// A code grader's check is the common half and nothing else. Strict, so a
// primitive smuggled onto one is refused rather than silently stripped: the
// program decides the status, and a primitive nobody runs would be a lie on
// the page.
const codeCheckSchema = z.strictObject(checkBase);

const needsSchema = z.object({
  'repo.files': z.array(nonEmpty).min(1).optional(),
  // Paths and sizes at the pinned commit, never contents. Globs, like
  // repo.files, and bound by the same needs_too_broad limit.
  'repo.tree': z.array(nonEmpty).min(1).optional(),
  'fieldnote.metrics': z
    .object({
      // The product's own presets, and only those: resolveRange() accepts
      // no others, so a manifest cannot name a window nothing can build.
      windowDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
      minMergedPullRequests: z.number().int().nonnegative(),
      insufficientReason: nonEmpty,
    })
    .optional(),
});

const manifestBase = {
  // owner/name. Namespaced because a marketplace has two people who both want
  // the name `test-coverage`. Immutable for the life of a grader.
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/),
  version: semver,
  evaluatorVersion: semver,
  // Accepted as a free string so a `pull_request` subject can arrive later
  // without breaking published graders; rejected below for anything but
  // `repository` and `repository_window` in v1.
  subject: nonEmpty,
  mode: z.enum(['deterministic', 'llm', 'hybrid']),
  category: z.enum(GRADER_CATEGORIES),
  // A grader declares the families it reads. Every family is optional; the
  // invariants below tie the declared set to what the grader can use.
  needs: needsSchema,
  // Appended to every explanation. The caveat is the grader's, not fieldnote's.
  disclaimer: nonEmpty,
  card: z.object({
    title: nonEmpty,
    tagline: nonEmpty,
    groups: z.array(z.object({ title: nonEmpty, checks: z.array(nonEmpty).min(1) })).min(1),
  }),
};

const manifestSchema = z.discriminatedUnion('kind', [
  z.object({
    ...manifestBase,
    kind: z.literal('declarative'),
    checks: z.array(checkSchema).min(1),
    // A declarative grader's floor lives in needs['fieldnote.metrics'], where
    // the collector enforces it; neither field below belongs on one.
    code: z.never().optional(),
    insufficientReason: z.never().optional(),
  }),
  z.object({
    ...manifestBase,
    kind: z.literal('code'),
    checks: z.array(codeCheckSchema).min(1),
    // The program's text. Part of the manifest, so registerRubric() stores and
    // hashes it: changing the program without a version bump throws the same
    // "Rubric version definition mismatch" a changed threshold does.
    code: z.object({ source: nonEmpty }),
    // The program enforces its own floor, so its sentence sits at the top level.
    insufficientReason: nonEmpty.optional(),
  }),
]);

export type GraderManifest = z.infer<typeof manifestSchema>;
export type DeclarativeManifest = Extract<GraderManifest, { kind: 'declarative' }>;
export type CodeManifest = Extract<GraderManifest, { kind: 'code' }>;
export type GraderCheck = DeclarativeManifest['checks'][number];
export type EvidenceFamily = keyof GraderManifest['needs'];

// A lookup, not a conditional, on purpose: keying this by primitive makes
// adding a primitive without deciding its family a compile error — TypeScript
// rejects a Record missing a key of its declared key type — instead of a
// runtime needs_mismatch.
const FAMILY_OF: Record<GraderCheck['primitive'], EvidenceFamily> = {
  'file-exists': 'repo.files',
  'glob-count': 'repo.files',
  'heading-has-fence': 'repo.files',
  'metric-threshold': 'fieldnote.metrics',
};

// Whether a family's evidence can change without a new commit. Keyed by the
// family type for the reason FAMILY_OF is keyed by primitive: a family added
// without a label is a compile error. Both the subject invariant and the
// nightly skip read this table, so the two rules cannot drift apart.
// repo.history gets its label when it is built, and whether history at a
// pinned sha can change without a commit is that slice's question.
export const FAMILY_CHANGES: Record<EvidenceFamily, 'with-commits' | 'over-time'> = {
  'repo.files': 'with-commits',
  'repo.tree': 'with-commits',
  'fieldnote.metrics': 'over-time',
};

function declaredFamilies(needs: GraderManifest['needs']): EvidenceFamily[] {
  return (Object.keys(needs) as EvidenceFamily[]).filter((family) => needs[family] !== undefined);
}

/** True when any declared family can change without a new commit. */
export function changesOverTime(manifest: { needs: GraderManifest['needs'] }): boolean {
  return declaredFamilies(manifest.needs).some((family) => FAMILY_CHANGES[family] === 'over-time');
}
```

Note: `ManifestErrorCode` and `ManifestError` were previously above line 23; delete the originals (lines 35-58 and the old `nonEmpty`/`semver`/`scopeEntry`/`checkBase`/`checkSchema`/`manifestSchema` definitions) so each is declared once. `GRADER_CATEGORIES`, `GRADER_METRICS` and `GraderMetric` at the top of the file stay.

- [ ] **Step 5: Rewrite the invariant half of `parseManifest`**

In `parseManifest`, replace everything from `const declared = Object.entries(manifest.needs)` through the end of the function with:

```ts
  const declared = declaredFamilies(manifest.needs);
  if (declared.length === 0)
    throw new ManifestError('needs_empty', 'A grader must declare at least one evidence family.');

  // A manifest is untrusted input and every pattern is a regular expression
  // run against every tree entry. Twenty is four times what either built-in
  // needs. Its own code rather than a Zod .max(), so an author is told which
  // rule they broke.
  for (const family of ['repo.files', 'repo.tree'] as const) {
    const patterns = manifest.needs[family];
    if (patterns && patterns.length > 20)
      throw new ManifestError(
        'needs_too_broad',
        `Manifest declares ${patterns.length} ${family} patterns; the limit is 20.`,
      );
  }

  // Only a declarative grader's checks say which family they read. A code
  // grader's program is opaque to fieldnote, so its declaration is a ceiling —
  // it receives nothing it did not declare — rather than an inventory.
  if (manifest.kind === 'declarative') {
    const required = new Set(manifest.checks.map((check) => FAMILY_OF[check.primitive]));
    const undeclared = [...required].find((family) => !declared.includes(family));
    if (undeclared)
      throw new ManifestError(
        'needs_mismatch',
        `Checks read '${undeclared}', which the manifest does not declare.`,
      );
    const unread = declared.find((family) => !required.has(family));
    if (unread)
      throw new ManifestError(
        'needs_mismatch',
        `Manifest declares '${unread}', which no check reads.`,
      );
  }

  // The subject and the evidence cannot disagree. A grader that reads evidence
  // which moves without a commit, while claiming to grade a commit, is the bug
  // open question 6 described; it is unregistrable. Placed after the needs
  // invariants so a broken `needs` reports its own error rather than this one.
  const window = changesOverTime(manifest);
  if (window && manifest.subject !== 'repository_window')
    throw new ManifestError(
      'subject_mismatch',
      'A grader reading evidence that changes over time grades a window and must say subject: repository_window.',
    );
  if (!window && manifest.subject !== 'repository')
    throw new ManifestError(
      'subject_mismatch',
      'Only a grader reading evidence that changes over time may say subject: repository_window.',
    );

  return manifest;
}
```

- [ ] **Step 6: Let the registry accept code and the engine refuse it**

In `src/domain/grading/registry.ts`, replace `registerGrader` with:

```ts
export function registerGrader(input: unknown): GraderManifest {
  const manifest = parseManifest(input);
  graders.set(manifest.id, manifest);
  return manifest;
}
```

and change the import to `import { ManifestError, parseManifest, type GraderManifest } from './manifest';` (unchanged if already so).

In `src/domain/grading/declarative.ts`, change the body's start so the function reads:

```ts
export function runDeclarative(
  manifest: GraderManifest,
  snapshot: RepositorySnapshot,
): GradeResult {
  // Callers holding a manifest of unknown kind reach code graders through
  // evaluate(); this engine interprets primitives and nothing else.
  if (manifest.kind !== 'declarative') throw new Error('runDeclarative runs declarative graders only');
  const evidence: CheckEvidence = {
```

(the rest of the function is unchanged).

- [ ] **Step 7: Run the tests, typecheck and lint**

Run: `pnpm vitest run src/domain/grading && pnpm typecheck && pnpm lint`
Expected: PASS. If any other test asserted `kind_unsupported`, typecheck or the run names it; replace that assertion with the code-registers behaviour above. `readiness-v01.test.ts` must pass without edits.

- [ ] **Step 8: Commit**

```bash
git add src/domain/grading/manifest.ts src/domain/grading/manifest.test.ts src/domain/grading/registry.ts src/domain/grading/registry.test.ts src/domain/grading/declarative.ts
git commit -m "feat(grading): a manifest can ship a program, and its evidence carries a label

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `collectTree()`, sharing `collectFiles`' tree walk

**Files:**
- Modify: `src/domain/grading/types.ts`
- Modify: `src/github/collect-files.ts`
- Test: `src/github/collect-files.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `type TreeEntry = { path: string; size: number }` in `types.ts`
  - `RepositorySnapshot.tree?: TreeEntry[] | null`
  - `type TreeSnapshot = { sha: string; complete: boolean; tree: TreeEntry[] }`
  - `collectTree(repositoryId: string, sha: string, patterns: string[]): Promise<TreeSnapshot>` — throws `FileCollectionError` exactly as `collectFiles` does

- [ ] **Step 1: Write the failing tests**

In `src/github/collect-files.test.ts`, change the import to `import { collectFiles, collectTree, resolveHeadSha, FileCollectionError } from './collect-files';` and append:

```ts
test('collectTree lists matching blob paths and sizes, sorted, and never fetches a blob', async () => {
  mocks.getTree.mockResolvedValue({
    data: {
      truncated: false,
      tree: [
        blob('src/b.ts', 'b2', 10),
        blob('README.md', 'b1', 4),
        { path: 'src', type: 'tree', sha: 't1', mode: '040000' },
        { ...blob('link.md'), mode: '120000' },
        { ...blob('vendor/module'), mode: '160000', type: 'commit' },
      ],
    },
  });
  const snapshot = await collectTree('fixture-repo', 'abc', ['**/*']);
  expect(snapshot).toEqual({
    sha: 'abc',
    complete: true,
    tree: [
      { path: 'README.md', size: 4 },
      { path: 'src/b.ts', size: 10 },
    ],
  });
  expect(mocks.getBlob).not.toHaveBeenCalled();
  expect(mocks.getCommit).toHaveBeenCalledWith(expect.objectContaining({ commit_sha: 'abc' }));
});

test('collectTree keeps only paths the declared globs match', async () => {
  mocks.getTree.mockResolvedValue({
    data: { truncated: false, tree: [blob('src/b.ts', 'b2', 10), blob('README.md', 'b1', 4)] },
  });
  const snapshot = await collectTree('fixture-repo', 'abc', ['src/**']);
  expect(snapshot.tree).toEqual([{ path: 'src/b.ts', size: 10 }]);
});

test('collectTree is incomplete past the tree entry cap', async () => {
  mocks.getTree.mockResolvedValue({
    data: {
      truncated: false,
      tree: Array.from({ length: 10_001 }, (_, i) => blob(`f${i}.ts`, `s${i}`, 1)),
    },
  });
  const snapshot = await collectTree('fixture-repo', 'abc', ['**/*']);
  expect(snapshot.complete).toBe(false);
});

test('collectTree walks a truncated recursive tree breadth first', async () => {
  mocks.getTree.mockImplementation(async ({ tree_sha, recursive }) => {
    if (recursive) return { data: { truncated: true, tree: [blob('partial.ts')] } };
    if (tree_sha === 'tree-abc')
      return {
        data: {
          truncated: false,
          tree: [blob('README.md', 'b1', 4), { path: 'src', type: 'tree', sha: 't-src', mode: '040000' }],
        },
      };
    return { data: { truncated: false, tree: [blob('a.ts', 'b3', 7)] } };
  });
  const snapshot = await collectTree('fixture-repo', 'abc', ['**/*']);
  expect(snapshot).toEqual({
    sha: 'abc',
    complete: true,
    tree: [
      { path: 'README.md', size: 4 },
      { path: 'src/a.ts', size: 7 },
    ],
  });
});

test('collectTree maps provider failures the way collectFiles does', async () => {
  mocks.getCommit.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
  await expect(collectTree('fixture-repo', 'abc', ['**/*'])).rejects.toMatchObject({
    code: 'repository_unavailable',
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/github/collect-files.test.ts`
Expected: FAIL — `collectTree` is not exported. Every pre-existing test still passes.

- [ ] **Step 3: Add the types**

In `src/domain/grading/types.ts`, after `SourceDocument`, add:

```ts
/** One file at the pinned commit: where it is and how big, never what it says. */
export type TreeEntry = {
  path: string;
  size: number;
};
```

and add to `RepositorySnapshot`, after `documents`:

```ts
  /** Present only for a grader that declared repo.tree. */
  tree?: TreeEntry[] | null;
```

- [ ] **Step 4: Extract the walk and add `collectTree`**

In `src/github/collect-files.ts`:

1. Change the types import to `import type { RepositorySnapshot, SourceDocument, TreeEntry } from '../domain/grading/types';`.
2. Rename the local `type TreeEntry = { path?: string; ... }` to `type GitTreeEntry` (it is the provider's shape, not ours) and update its uses.
3. Insert this function after `matcher()`:

```ts
/**
 * Every entry of the pinned commit's tree, within the entry cap, falling back
 * to a breadth-first walk of the immutable root when GitHub truncates the
 * recursive listing. The visitor returns false to mark the walk incomplete.
 * Shared by collectFiles and collectTree so the caps are one set of caps.
 */
async function walkTree(
  repositoryId: string,
  sha: string,
  visit: (entry: GitTreeEntry, path: string) => boolean,
) {
  const { repo, client } = await context(repositoryId);
  const identity = { owner: repo.owner, repo: repo.name };
  const { data: commit } = await withDeadline((signal) =>
    client.rest.git.getCommit({ request: { signal }, ...identity, commit_sha: sha }),
  );
  const { data: recursive } = await withDeadline((signal) =>
    client.rest.git.getTree({
      request: { signal },
      ...identity,
      tree_sha: commit.tree.sha,
      recursive: '1',
    }),
  );
  let complete = true;
  let entries = 0;
  const consider = (entry: GitTreeEntry, prefix: string) => {
    if (!visit(entry, prefix + (entry.path ?? ''))) complete = false;
  };
  if (!recursive.truncated) {
    for (const entry of recursive.tree) {
      if (++entries > limits.entries) {
        complete = false;
        break;
      }
      consider(entry, '');
    }
  } else {
    // Discard partial recursive data and traverse the immutable root breadth first.
    const queue = [{ sha: commit.tree.sha, prefix: '' }];
    let treeRequests = 0;
    for (let index = 0; index < queue.length; index++) {
      if (++treeRequests > limits.entries || entries >= limits.entries) {
        complete = false;
        break;
      }
      const current = queue[index];
      const { data: tree } = await withDeadline((signal) =>
        client.rest.git.getTree({ request: { signal }, ...identity, tree_sha: current.sha }),
      );
      if (tree.truncated) complete = false;
      for (const entry of tree.tree) {
        if (++entries > limits.entries) {
          complete = false;
          break;
        }
        consider(entry, current.prefix);
        if (entry.type === 'tree') {
          if (!entry.sha || !entry.path) complete = false;
          else queue.push({ sha: entry.sha, prefix: `${current.prefix}${entry.path}/` });
        }
      }
      if (entries > limits.entries) break;
    }
  }
  return { complete, client, identity };
}

const isFile = (entry: GitTreeEntry) =>
  entry.type === 'blob' && ['100644', '100755'].includes(entry.mode ?? '');
```

4. Replace the body of `collectFiles`, from `const relevant = matcher(patterns);` down to (but not including) `const documents: SourceDocument[] = [];`, with:

```ts
  const relevant = matcher(patterns);
  try {
    const pinnedSha = sha;
    const candidates: { path: string; sha: string }[] = [];
    let reservedBytes = 0;
    const walked = await walkTree(repositoryId, pinnedSha, (entry, path) => {
      if (!isFile(entry) || !relevant(path)) return true;
      if (
        !entry.sha ||
        entry.size === undefined ||
        entry.size < 0 ||
        !Number.isSafeInteger(entry.size) ||
        entry.size > limits.fileBytes ||
        candidates.length >= limits.documents ||
        reservedBytes + entry.size > limits.totalBytes
      )
        return false;
      reservedBytes += entry.size;
      candidates.push({ path, sha: entry.sha });
      return true;
    });
    const { client, identity } = walked;
    let complete = walked.complete;
```

The blob-fetching loop that follows (`const documents: SourceDocument[] = [];` through `return { sha: pinnedSha, complete, documents };`) and the `catch` stay exactly as they are.

5. Append after `collectFiles`:

```ts
export type TreeSnapshot = { sha: string; complete: boolean; tree: TreeEntry[] };

/** repo.tree: the paths and sizes a grader declared, at the pinned commit. No blob is fetched. */
export async function collectTree(
  repositoryId: string,
  sha: string,
  patterns: string[],
): Promise<TreeSnapshot> {
  const relevant = matcher(patterns);
  try {
    const tree: TreeEntry[] = [];
    const { complete } = await walkTree(repositoryId, sha, (entry, path) => {
      if (!isFile(entry) || !relevant(path)) return true;
      if (entry.size === undefined || entry.size < 0 || !Number.isSafeInteger(entry.size))
        return false;
      tree.push({ path, size: entry.size });
      return true;
    });
    // The same order runDeclarative sorts documents into, so a program sees a
    // stable list whatever order GitHub returned.
    tree.sort((left, right) => left.path.localeCompare(right.path, 'en'));
    return { sha, complete, tree };
  } catch (error) {
    throw safeError(error);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/github/collect-files.test.ts src/domain/grading/readiness-v01.test.ts && pnpm typecheck`
Expected: PASS — every pre-existing `collectFiles` test unchanged and green.

- [ ] **Step 6: Commit**

```bash
git add src/domain/grading/types.ts src/github/collect-files.ts src/github/collect-files.test.ts
git commit -m "feat(grading): collect the file list at a pinned commit

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The broker collects `repo.tree`

**Files:**
- Modify: `src/grading/evidence.ts`
- Test: `src/grading/evidence.test.ts`

**Interfaces:**
- Consumes: `collectTree(repositoryId, sha, patterns): Promise<TreeSnapshot>` (Task 2); `parseManifest` (Task 1).
- Produces: `collectEvidence()` returns `snapshot.tree` **only when** `repo.tree` is declared (the key is absent otherwise); an incomplete tree yields `incompleteCode: 'incomplete_collection'` and `incompleteReason: INCOMPLETE`.

- [ ] **Step 1: Write the failing tests**

In `src/grading/evidence.test.ts`:

1. Add `const collectTree = vi.fn();` beside the other mocks and change the collect-files mock to `vi.mock('../github/collect-files', () => ({ collectFiles, collectTree }));`.
2. Add `collectTree.mockReset();` to `beforeEach`.
3. Add after the existing dynamic imports: `const { parseManifest } = await import('../domain/grading/manifest');`
4. Append:

```ts
const treeManifest = parseManifest({
  id: 'fieldnote/tree-fixture',
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'test-discipline',
  kind: 'code',
  needs: { 'repo.tree': ['**/*'] },
  code: { source: 'export default () => ({ checks: [] });' },
  disclaimer: 'Evidence, not certification.',
  card: { title: 'Tree', tagline: 'Is there a tree?', groups: [{ title: 'Tree', checks: ['t'] }] },
  checks: [{ id: 't', title: 'T', points: 100, explain: { pass: 'Yes.', fail: 'No.' } }],
});

test('a tree grader calls only the tree collector and carries the tree', async () => {
  collectTree.mockResolvedValue({ sha: 'abc', complete: true, tree: [{ path: 'a.ts', size: 1 }] });
  const collected = await collectEvidence(treeManifest, 'repo', 'abc', new Date('2026-09-14T12:00:00.000Z'));
  expect(collectTree).toHaveBeenCalledWith('repo', 'abc', ['**/*']);
  expect(collectFiles).not.toHaveBeenCalled();
  expect(collectMetrics).not.toHaveBeenCalled();
  expect(collected.snapshot.tree).toEqual([{ path: 'a.ts', size: 1 }]);
  expect(collected.snapshot.documents).toEqual([]);
  expect(collected.snapshot.complete).toBe(true);
  expect(collected.incompleteCode).toBeNull();
});

test("an incomplete tree is fieldnote's failure, in fieldnote's words", async () => {
  collectTree.mockResolvedValue({ sha: 'abc', complete: false, tree: [] });
  const collected = await collectEvidence(treeManifest, 'repo', 'abc', new Date('2026-09-14T12:00:00.000Z'));
  expect(collected.snapshot.complete).toBe(false);
  expect(collected.snapshot.incompleteReason).toBe(INCOMPLETE);
  expect(collected.incompleteCode).toBe('incomplete_collection');
});

test('a grader that does not declare repo.tree carries no tree key at all', async () => {
  collectFiles.mockResolvedValue({ sha: 'abc', complete: true, documents: [] });
  const collected = await collectEvidence(agentReadinessManifest, 'repo', 'abc', new Date('2026-09-14T12:00:00.000Z'));
  expect(collectTree).not.toHaveBeenCalled();
  expect('tree' in collected.snapshot).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/grading/evidence.test.ts`
Expected: FAIL — `collectEvidence does not handle evidence family 'repo.tree'`.

- [ ] **Step 3: Implement**

In `src/grading/evidence.ts`:

1. Change the first import to `import { collectFiles, collectTree } from '../github/collect-files';`.
2. Replace the `HANDLED_FAMILIES` comment's last sentence and the constant with:

```ts
// has no key for a fourth family — but this is the refusal for the day one
// arrives.
const HANDLED_FAMILIES = ['repo.files', 'repo.tree', 'fieldnote.metrics'] as const;
```

3. Replace the body of `collectEvidence` after the `unhandled` guard with:

```ts
  const filesNeed = manifest.needs['repo.files'];
  const treeNeed = manifest.needs['repo.tree'];
  const metricsNeed = manifest.needs['fieldnote.metrics'];
  const files = filesNeed ? await collectFiles(repositoryId, sha, filesNeed) : null;
  const tree = treeNeed ? await collectTree(repositoryId, sha, treeNeed) : null;
  const metrics = metricsNeed ? await collectMetrics(repositoryId, metricsNeed, requestedAt) : null;
  // Collection failing outranks a grader's floor: if fieldnote could not read
  // the evidence, what the grader would have made of it is unknown.
  const collectionFailed =
    (files !== null && !files.complete) || (tree !== null && !tree.complete);
  const metricsShort = metrics !== null && !metrics.complete;
  const complete = !collectionFailed && !metricsShort;
  return {
    snapshot: {
      sha,
      complete,
      documents: files?.documents ?? [],
      // Only a grader that declared the family carries the key: what a program
      // receives is built from the snapshot, and absent is not the same as empty.
      ...(tree ? { tree: tree.tree } : {}),
      metrics: metrics?.metrics ?? null,
      ...(collectionFailed
        ? { incompleteReason: INCOMPLETE }
        : metricsShort
          ? { incompleteReason: metrics.incompleteReason }
          : {}),
    },
    // A failed file or tree collection is always fieldnote's failure.
    // Otherwise, ask the metrics collector which of the two it meant — it
    // already knows. Null when the snapshot is complete.
    incompleteCode: collectionFailed
      ? 'incomplete_collection'
      : metricsShort
        ? metrics.incompleteCode
        : null,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/grading/evidence.test.ts src/inngest/functions/grade-repository.test.ts && pnpm typecheck`
Expected: PASS, including every pre-existing broker test.

- [ ] **Step 5: Commit**

```bash
git add src/grading/evidence.ts src/grading/evidence.test.ts
git commit -m "feat(grading): the broker hands a tree grader its tree

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: What a program receives, and the strict answer

**Files:**
- Create: `src/domain/grading/code.ts`
- Test: `src/domain/grading/code.test.ts`

**Interfaces:**
- Consumes: `CodeManifest` (Task 1); `RepositorySnapshot`, `TreeEntry` (Task 2).
- Produces:
  - `class GraderFailedError extends Error` — `name === 'GraderFailedError'`, message is always a fixed fieldnote sentence
  - `type CodeGraderInput = { evidence: { tree?: TreeEntry[]; documents?: SourceDocument[]; metrics?: MetricsWindow | null } }`
  - `codeGraderInput(manifest: CodeManifest, snapshot: RepositorySnapshot): CodeGraderInput`
  - `type CodeEvaluation = { result: GradeResult; insufficient: boolean }`
  - `assembleCodeResult(manifest: CodeManifest, input: CodeGraderInput, answer: unknown): CodeEvaluation` — throws `GraderFailedError`
  - `const MAX_PATHS_PER_CHECK = 20`

- [ ] **Step 1: Write the failing tests**

Create `src/domain/grading/code.test.ts`:

```ts
import { expect, test } from 'vitest';
import { parseManifest, type CodeManifest } from './manifest';
import { assembleCodeResult, codeGraderInput, GraderFailedError } from './code';

const draft = (over: Record<string, unknown> = {}) => ({
  id: 'fieldnote/code-fixture',
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'test-discipline',
  kind: 'code',
  needs: { 'repo.tree': ['**/*'] },
  code: { source: 'export default () => ({ checks: [] });' },
  insufficientReason: 'Too little here to judge.',
  disclaimer: 'Evidence, not certification.',
  card: { title: 'Fixture', tagline: 'Is it?', groups: [{ title: 'All', checks: ['a', 'b'] }] },
  checks: [
    { id: 'a', title: 'A', points: 60, explain: { pass: 'A holds.', fail: 'A does not hold.' } },
    { id: 'b', title: 'B', points: 40, explain: { pass: 'B holds.', fail: 'B does not hold.' } },
  ],
  ...over,
});
const manifest = parseManifest(draft()) as CodeManifest;
const snapshot = {
  sha: 'a'.repeat(40),
  complete: true,
  documents: [],
  tree: [
    { path: 'src/a.test.ts', size: 1 },
    { path: 'src/a.ts', size: 1 },
  ],
  metrics: null,
};
const input = codeGraderInput(manifest, snapshot);

const fails = (answer: unknown, target: CodeManifest = manifest) =>
  expect(() => assembleCodeResult(target, input, answer)).toThrow(GraderFailedError);

test('a program receives only the families its manifest declared, and nothing about whose repository it is', () => {
  expect(input).toEqual({ evidence: { tree: snapshot.tree } });
  expect(Object.keys(input)).toEqual(['evidence']);

  const files = parseManifest(draft({ needs: { 'repo.files': ['README.md'] } })) as CodeManifest;
  const documents = [{ path: 'README.md', blobSha: 'b1', text: 'hi' }];
  expect(codeGraderInput(files, { ...snapshot, documents })).toEqual({ evidence: { documents } });

  const both = parseManifest(
    draft({ needs: { 'repo.files': ['README.md'], 'repo.tree': ['**/*'] } }),
  ) as CodeManifest;
  expect(Object.keys(codeGraderInput(both, { ...snapshot, documents }).evidence).sort()).toEqual([
    'documents',
    'tree',
  ]);
});

test('a scored answer is assembled from the manifest prose, with points, paths and the count', () => {
  const { result, insufficient } = assembleCodeResult(manifest, input, {
    checks: [
      { id: 'a', status: 'pass', paths: ['src/a.test.ts'] },
      { id: 'b', status: 'pass', count: { matched: 3, of: 4 } },
    ],
  });
  expect(insufficient).toBe(false);
  expect(result).toEqual({
    score: 100,
    rubricVersion: '0.1.0',
    evaluatorVersion: '1.0.0',
    checks: [
      {
        id: 'a',
        points: 60,
        maxPoints: 60,
        status: 'pass',
        paths: ['src/a.test.ts'],
        lineRanges: [],
        explanation: 'A holds. Evidence, not certification.',
      },
      {
        id: 'b',
        points: 40,
        maxPoints: 40,
        status: 'pass',
        paths: [],
        lineRanges: [],
        explanation: 'B holds. Measured 3 of 4. Evidence, not certification.',
      },
    ],
  });
});

test('a failing check scores nothing and shows no paths, as a declarative check does', () => {
  const { result } = assembleCodeResult(manifest, input, {
    checks: [
      { id: 'a', status: 'fail', paths: ['src/a.ts'] },
      { id: 'b', status: 'pass' },
    ],
  });
  expect(result.score).toBe(40);
  expect(result.checks[0]).toMatchObject({ points: 0, paths: [], explanation: 'A does not hold. Evidence, not certification.' });
});

test('an insufficient answer keeps every check and carries the manifest sentence, with no score', () => {
  const { result, insufficient } = assembleCodeResult(manifest, input, {
    checks: [
      { id: 'a', status: 'pass' },
      { id: 'b', status: 'fail' },
    ],
    insufficient: true,
  });
  expect(insufficient).toBe(true);
  expect(result.score).toBeNull();
  expect(result.incompleteReason).toBe('Too little here to judge.');
  expect(result.checks).toHaveLength(2);
});

test('duplicate paths are listed once', () => {
  const { result } = assembleCodeResult(manifest, input, {
    checks: [
      { id: 'a', status: 'pass', paths: ['src/a.ts', 'src/a.ts'] },
      { id: 'b', status: 'pass' },
    ],
  });
  expect(result.checks[0].paths).toEqual(['src/a.ts']);
});

const both = [
  { id: 'a', status: 'pass' },
  { id: 'b', status: 'pass' },
];

test('an answer that is not an object fails', () => fails('nope'));
test('an answer with free text anywhere fails', () => {
  fails({ checks: both, explanation: '<script>alert(1)</script>' });
  fails({ checks: [{ ...both[0], explanation: 'mine' }, both[1]] });
  fails({ checks: [{ ...both[0], count: { matched: 1, of: 2, note: 'x' } }, both[1]] });
});
test('a check id the manifest does not declare fails, markup included', () => {
  fails({ checks: [...both, { id: '<b>c</b>', status: 'pass' }] });
});
test('a declared check left out fails', () => fails({ checks: [both[0]] }));
test('a check reported twice fails', () => fails({ checks: [...both, both[0]] }));
test('a status other than pass or fail fails', () => fails({ checks: [{ id: 'a', status: 'maybe' }, both[1]] }));
test('a path the program was not given fails', () =>
  fails({ checks: [{ id: 'a', status: 'pass', paths: ['../../etc/passwd'] }, both[1]] }));
test('more than twenty paths on a check fails', () =>
  fails({ checks: [{ id: 'a', status: 'pass', paths: Array(21).fill('src/a.ts') }, both[1]] }));
test('a count that is not whole, not positive or not ordered fails', () => {
  fails({ checks: [{ id: 'a', status: 'pass', count: { matched: 1.5, of: 2 } }, both[1]] });
  fails({ checks: [{ id: 'a', status: 'pass', count: { matched: -1, of: 2 } }, both[1]] });
  fails({ checks: [{ id: 'a', status: 'pass', count: { matched: 3, of: 2 } }, both[1]] });
});
test('insufficient from a grader with no sentence for it fails', () => {
  const silent = parseManifest(draft({ insufficientReason: undefined })) as CodeManifest;
  fails({ checks: both, insufficient: true }, silent);
});
test('insufficient: false is not part of the contract', () => fails({ checks: both, insufficient: false }));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/domain/grading/code.test.ts`
Expected: FAIL — `./code` does not exist.

- [ ] **Step 3: Implement `src/domain/grading/code.ts`**

```ts
import { z } from 'zod';
import type { CodeManifest } from './manifest';
import type {
  CheckResult,
  GradeResult,
  MetricsWindow,
  RepositorySnapshot,
  SourceDocument,
  TreeEntry,
} from './types';

export const MAX_PATHS_PER_CHECK = 20;

/**
 * A code grader's program did not produce a usable answer. The message is
 * always fieldnote's own fixed sentence: nothing a program printed is kept.
 */
export class GraderFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraderFailedError';
  }
}

export type CodeGraderInput = {
  evidence: { tree?: TreeEntry[]; documents?: SourceDocument[]; metrics?: MetricsWindow | null };
};

/**
 * Exactly what crosses into the sandbox: the declared families and nothing
 * else — no sha, no repository, no workspace, no user, no manifest.
 */
export function codeGraderInput(
  manifest: CodeManifest,
  snapshot: RepositorySnapshot,
): CodeGraderInput {
  const evidence: CodeGraderInput['evidence'] = {};
  if (manifest.needs['repo.tree']) evidence.tree = snapshot.tree ?? [];
  if (manifest.needs['repo.files']) evidence.documents = snapshot.documents;
  if (manifest.needs['fieldnote.metrics']) evidence.metrics = snapshot.metrics ?? null;
  return { evidence };
}

// Strict at every depth, and with no field that carries free text: `id` must
// equal a declared id, `status` is one of two words, and every path must equal
// one fieldnote already holds. That is how a program is kept from emitting
// markup — not by a sanitiser that must be right, but by a shape with nowhere
// to put it.
const answerSchema = z.strictObject({
  checks: z.array(
    z.strictObject({
      id: z.string(),
      status: z.enum(['pass', 'fail']),
      paths: z.array(z.string()).max(MAX_PATHS_PER_CHECK).optional(),
      count: z
        .strictObject({
          matched: z.number().int().nonnegative(),
          of: z.number().int().nonnegative(),
        })
        .optional(),
    }),
  ),
  insufficient: z.literal(true).optional(),
});

export type CodeEvaluation = { result: GradeResult; insufficient: boolean };

/**
 * Turns a program's answer into the same GradeResult a declarative grader
 * produces. The prose, the points and the disclaimer all come from the
 * manifest; the program contributed a status, some paths and a count.
 */
export function assembleCodeResult(
  manifest: CodeManifest,
  input: CodeGraderInput,
  answer: unknown,
): CodeEvaluation {
  const parsed = answerSchema.safeParse(answer);
  if (!parsed.success) throw new GraderFailedError('The grader answer does not match the contract.');
  const known = new Set([
    ...(input.evidence.tree ?? []).map((entry) => entry.path),
    ...(input.evidence.documents ?? []).map((document) => document.path),
  ]);
  const declared = new Set(manifest.checks.map((check) => check.id));
  const reported = new Map<string, (typeof parsed.data.checks)[number]>();
  for (const check of parsed.data.checks) {
    if (!declared.has(check.id))
      throw new GraderFailedError('The grader reported a check its manifest does not declare.');
    if (reported.has(check.id)) throw new GraderFailedError('The grader reported a check twice.');
    if (check.paths?.some((path) => !known.has(path)))
      throw new GraderFailedError('The grader named a path it was not given.');
    if (check.count && check.count.matched > check.count.of)
      throw new GraderFailedError('The grader reported a count larger than its total.');
    reported.set(check.id, check);
  }
  const insufficient = parsed.data.insufficient === true;
  if (insufficient && !manifest.insufficientReason)
    throw new GraderFailedError('The grader has no sentence for having too little to judge.');

  const checks: CheckResult[] = manifest.checks.map((check) => {
    const answered = reported.get(check.id);
    if (!answered) throw new GraderFailedError('The grader left a declared check out.');
    const passed = answered.status === 'pass';
    const measured = answered.count
      ? ` Measured ${answered.count.matched} of ${answered.count.of}.`
      : '';
    return {
      id: check.id,
      points: passed ? check.points : 0,
      maxPoints: check.points,
      status: answered.status,
      // Kept on a pass and dropped on a fail, as primitives.ts's result() does.
      // A tree path has no lines to point at.
      paths: passed ? [...new Set(answered.paths ?? [])] : [],
      lineRanges: [],
      explanation: `${passed ? check.explain.pass : check.explain.fail}${measured} ${manifest.disclaimer}`,
    };
  });
  const metrics = input.evidence.metrics;
  return {
    insufficient,
    result: {
      score: insufficient ? null : checks.reduce((sum, check) => sum + check.points, 0),
      checks,
      rubricVersion: manifest.version,
      evaluatorVersion: manifest.evaluatorVersion,
      ...(metrics
        ? { window: { start: metrics.start, endExclusive: metrics.endExclusive, days: metrics.days } }
        : {}),
      ...(insufficient ? { incompleteReason: manifest.insufficientReason } : {}),
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/domain/grading/code.test.ts && pnpm typecheck`
Expected: PASS. If the scored-answer `toEqual` fails only on key order or an `undefined` key, fix the implementation so no `incompleteReason`/`window` key is present when not set — do not loosen the test.

- [ ] **Step 5: Commit**

```bash
git add src/domain/grading/code.ts src/domain/grading/code.test.ts
git commit -m "feat(grading): a program answers with data, and fieldnote does the talking

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The sandbox port, the runner and the local adapter, with the locks proven

**Files:**
- Create: `src/grading/sandbox/port.ts`, `src/grading/sandbox/errors.ts`, `src/grading/sandbox/runner.ts`, `src/grading/sandbox/local.ts`, `src/grading/sandbox/hostile.fixture.ts`
- Test: `src/grading/sandbox/local.test.ts`

**Interfaces:**
- Produces:
  - `type SandboxHandle = { readonly id: string; readonly root: string }` — `root` is an absolute directory
  - `type ExecResult = { exitCode: number | null; stdout: string; timedOut: boolean; overflowed: boolean }`
  - `interface Sandbox { create(): Promise<SandboxHandle>; write(handle, name: string, contents: string): Promise<void>; exec(handle, command: readonly string[], options: { timeoutMs: number; maxOutputBytes: number }): Promise<ExecResult>; destroy(handle): Promise<void> }` — a **rejection** means the substrate failed and is always a `SandboxUnavailableError`; a program's own failure is a **resolved** `ExecResult`
  - `class SandboxUnavailableError extends Error { readonly retryable: boolean }` — `name === 'SandboxUnavailableError'`, fixed message `'The grading sandbox is unavailable.'`
  - `const RUNNER_SOURCE: string`; `graderCommand(root: string): string[]` → `['node', '--permission', '--allow-fs-read=<root>', '<root>/run.mjs']`
  - `const localSandbox: Sandbox`
  - `hostileGrader(options: { hostPath: string; network: boolean }): string` — program source

- [ ] **Step 1: Write the port, errors and runner (no behaviour to test yet)**

`src/grading/sandbox/port.ts`:

```ts
// The sandbox port Act's plan 2b designed — create, write, run, destroy — with
// "run the agent" generalised to running a command, because a grading run has
// no agent. Four operations rather than one runGrader() call, because Act's
// plan run holds a box across several commands and a single call is the
// interface it could not adopt.

export type SandboxHandle = { readonly id: string; readonly root: string };

export type ExecResult = {
  exitCode: number | null;
  stdout: string;
  timedOut: boolean;
  overflowed: boolean;
};

/**
 * A rejection from any operation means the substrate failed, and is always a
 * SandboxUnavailableError. A program failing — a crash, a timeout, too much
 * output — is a resolved ExecResult: that is the program's outcome, not the
 * sandbox's.
 */
export interface Sandbox {
  create(): Promise<SandboxHandle>;
  write(handle: SandboxHandle, name: string, contents: string): Promise<void>;
  exec(
    handle: SandboxHandle,
    command: readonly string[],
    options: { timeoutMs: number; maxOutputBytes: number },
  ): Promise<ExecResult>;
  destroy(handle: SandboxHandle): Promise<void>;
}
```

`src/grading/sandbox/errors.ts`:

```ts
/**
 * The substrate a code grader runs on could not be used. Carries no vendor
 * message: a provider error can hold request metadata, and nothing from one is
 * stored or logged.
 */
export class SandboxUnavailableError extends Error {
  constructor(readonly retryable: boolean) {
    super('The grading sandbox is unavailable.');
    this.name = 'SandboxUnavailableError';
  }
}
```

`src/grading/sandbox/runner.ts`:

```ts
// fieldnote's half of what runs in the box. It reads the evidence, calls the
// program's default export, and prints the answer. A thrown error exits
// non-zero with nothing on stdout.
export const RUNNER_SOURCE = `import { readFileSync } from 'node:fs';
const input = JSON.parse(readFileSync(new URL('./input.json', import.meta.url), 'utf8'));
const { default: grade } = await import('./grader.mjs');
const answer = await grade(input.evidence);
process.stdout.write(JSON.stringify(answer) ?? '');
`;

/**
 * The same command in every adapter, so the filesystem, write and process
 * locks are properties of the command rather than of a vendor: with
 * --permission set and nothing else allowed, Node refuses every read outside
 * the box directory, every write, child processes, workers, addons and the
 * inspector. Node 24's permission model has no network switch; that lock is
 * the substrate's.
 */
export function graderCommand(root: string): string[] {
  return ['node', '--permission', `--allow-fs-read=${root}`, `${root}/run.mjs`];
}
```

`src/grading/sandbox/hostile.fixture.ts`:

```ts
/**
 * A program that tries everything "What a grader never receives" forbids, and
 * reports what happened instead of an answer. Shared by the local suite and
 * the live E2B suite so both prove the same list. `network` is off for the
 * local suite: the local adapter cannot block it and the test must not depend
 * on the internet.
 */
export function hostileGrader({ hostPath, network }: { hostPath: string; network: boolean }): string {
  return `import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const attempt = (action) => { try { action(); return 'allowed'; } catch { return 'refused'; } };
export default async function grade() {
  const report = {
    env: Object.keys(process.env),
    passwd: attempt(() => readFileSync('/etc/passwd')),
    host: attempt(() => readFileSync(${JSON.stringify(hostPath)})),
    write: attempt(() => writeFileSync(new URL('./escape.txt', import.meta.url), 'x')),
    spawn: attempt(() => { const child = spawnSync('/bin/echo', ['hi']); if (child.error) throw child.error; }),
  };
  ${
    network
      ? `try { await fetch('https://example.com', { signal: AbortSignal.timeout(5000) }); report.network = 'allowed'; } catch { report.network = 'refused'; }`
      : ''
  }
  return report;
}
`;
}
```

- [ ] **Step 2: Write the failing local adapter tests**

Create `src/grading/sandbox/local.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { localSandbox } from './local';
import { graderCommand, RUNNER_SOURCE } from './runner';
import { hostileGrader } from './hostile.fixture';
import type { SandboxHandle } from './port';

const limits = { timeoutMs: 5_000, maxOutputBytes: 256 * 1024 };
const handles: SandboxHandle[] = [];
afterEach(async () => {
  while (handles.length) await localSandbox.destroy(handles.pop()!);
});

async function box(program: string) {
  const handle = await localSandbox.create();
  handles.push(handle);
  await localSandbox.write(handle, 'grader.mjs', program);
  await localSandbox.write(handle, 'run.mjs', RUNNER_SOURCE);
  await localSandbox.write(handle, 'input.json', JSON.stringify({ evidence: { tree: [] } }));
  return handle;
}

const hostile = () => hostileGrader({ hostPath: join(process.cwd(), 'package.json'), network: false });

test('a well-behaved program runs and its answer reaches stdout', async () => {
  const handle = await box('export default (evidence) => ({ saw: Object.keys(evidence) });');
  const result = await localSandbox.exec(handle, graderCommand(handle.root), limits);
  expect(result).toMatchObject({ exitCode: 0, timedOut: false, overflowed: false });
  expect(JSON.parse(result.stdout)).toEqual({ saw: ['tree'] });
});

test('the program sees no environment variable from the worker', async () => {
  process.env.FIELDNOTE_SENTINEL = 'secret';
  try {
    const handle = await box(hostile());
    const report = JSON.parse((await localSandbox.exec(handle, graderCommand(handle.root), limits)).stdout);
    expect(report.env).not.toContain('FIELDNOTE_SENTINEL');
    // PATH is always set in the worker; its absence proves nothing was inherited.
    expect(report.env).not.toContain('PATH');
  } finally {
    delete process.env.FIELDNOTE_SENTINEL;
  }
});

test('the program cannot read outside its box, write, or start a process', async () => {
  const handle = await box(hostile());
  const report = JSON.parse((await localSandbox.exec(handle, graderCommand(handle.root), limits)).stdout);
  expect(report).toMatchObject({
    passwd: 'refused',
    host: 'refused',
    write: 'refused',
    spawn: 'refused',
  });
});

test('the same program without --permission is allowed, so the locks above are not vacuous', async () => {
  const handle = await box(hostile());
  const report = JSON.parse(
    (await localSandbox.exec(handle, ['node', `${handle.root}/run.mjs`], limits)).stdout,
  );
  expect(report.passwd).toBe('allowed');
  expect(report.host).toBe('allowed');
});

test('a program that never finishes is killed at the timeout', async () => {
  const handle = await box('export default () => new Promise(() => setInterval(() => {}, 1000));');
  const result = await localSandbox.exec(handle, graderCommand(handle.root), { ...limits, timeoutMs: 500 });
  expect(result.timedOut).toBe(true);
});

test('a program that prints past the cap is killed and flagged', async () => {
  const handle = await box("export default () => 'x'.repeat(300 * 1024);");
  const result = await localSandbox.exec(handle, graderCommand(handle.root), limits);
  expect(result.overflowed).toBe(true);
});

test('a program that throws exits non-zero with nothing on stdout', async () => {
  const handle = await box("export default () => { throw new Error('boom'); };");
  const result = await localSandbox.exec(handle, graderCommand(handle.root), limits);
  expect(result.exitCode).not.toBe(0);
  expect(result.stdout).toBe('');
});

test('destroy removes the box directory', async () => {
  const handle = await box('export default () => ({});');
  handles.pop();
  await localSandbox.destroy(handle);
  await expect(localSandbox.write(handle, 'again.txt', 'x')).rejects.toMatchObject({
    name: 'SandboxUnavailableError',
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run src/grading/sandbox/local.test.ts`
Expected: FAIL — `./local` does not exist.

- [ ] **Step 4: Implement `src/grading/sandbox/local.ts`**

```ts
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SandboxUnavailableError } from './errors';
import type { Sandbox } from './port';

/**
 * Tests and `pnpm dev`. A temporary directory and a child process with an
 * empty environment, running the same command the E2B adapter runs. It
 * enforces the filesystem, write and process locks for real; it cannot block
 * the network, because Node 24's permission model has no network permission.
 * Never used in production — see selectSandbox().
 */
export const localSandbox: Sandbox = {
  async create() {
    try {
      // realpath: macOS's tmpdir is a symlink, and --allow-fs-read compares
      // resolved paths.
      const root = await realpath(await mkdtemp(join(tmpdir(), 'fieldnote-grader-')));
      return { id: root, root };
    } catch {
      throw new SandboxUnavailableError(false);
    }
  },
  async write(handle, name, contents) {
    try {
      await writeFile(join(handle.root, name), contents, { encoding: 'utf8', flag: 'wx' });
    } catch {
      throw new SandboxUnavailableError(false);
    }
  },
  exec(handle, command, { timeoutMs, maxOutputBytes }) {
    return new Promise((resolve, reject) => {
      const [program, ...args] = command;
      const child = spawn(program === 'node' ? process.execPath : program, args, {
        cwd: handle.root,
        env: {},
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const chunks: Buffer[] = [];
      let bytes = 0;
      let timedOut = false;
      let overflowed = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxOutputBytes) {
          overflowed = true;
          child.kill('SIGKILL');
          return;
        }
        chunks.push(chunk);
      });
      child.on('error', () => {
        clearTimeout(timer);
        reject(new SandboxUnavailableError(false));
      });
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        resolve({
          exitCode,
          stdout: overflowed ? '' : Buffer.concat(chunks).toString('utf8'),
          timedOut,
          overflowed,
        });
      });
    });
  },
  async destroy(handle) {
    await rm(handle.root, { recursive: true, force: true });
  },
};
```

Note on `flag: 'wx'`: writing a file that already exists, or into a directory that no longer exists, rejects — which is what the destroy test relies on.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/grading/sandbox/local.test.ts`
Expected: PASS (8 tests).

If the well-behaved program fails under `--permission` for a reason unrelated to the grader (for example Node's ESM loader needing to read a path outside the box), do **not** add `--allow-fs-read` for a wider path: stop and report BLOCKED with the child's stderr (temporarily switch `stdio[2]` to `'pipe'` to see it, then revert). Widening the read allowance weakens the filesystem lock the spec promises.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/grading/sandbox/port.ts src/grading/sandbox/errors.ts src/grading/sandbox/runner.ts src/grading/sandbox/local.ts src/grading/sandbox/hostile.fixture.ts src/grading/sandbox/local.test.ts
git commit -m "feat(grading): a sandbox port, and a local box that proves its locks

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `runCodeGrader()` and choosing a sandbox

**Files:**
- Create: `src/grading/run-code.ts`, `src/grading/sandbox/index.ts`
- Test: `src/grading/run-code.test.ts`

**Interfaces:**
- Consumes: `Sandbox`, `SandboxUnavailableError`, `RUNNER_SOURCE`, `graderCommand`, `localSandbox` (Task 5); `codeGraderInput`, `assembleCodeResult`, `GraderFailedError`, `CodeEvaluation` (Task 4).
- Produces:
  - `const GRADER_LIMITS = { timeoutMs: 20_000, maxOutputBytes: 256 * 1024 }`
  - `runCodeGrader(manifest: CodeManifest, snapshot: RepositorySnapshot, sandbox: Sandbox): Promise<CodeEvaluation>` — throws `GraderFailedError` for the program's failures; lets `SandboxUnavailableError` through; always destroys the box
  - `selectSandbox(env?: NodeJS.ProcessEnv): Sandbox` — throws `SandboxUnavailableError(false)` in production with no key (Task 12 adds the E2B branch)

- [ ] **Step 1: Write the failing tests**

Create `src/grading/run-code.test.ts`:

```ts
import { expect, test, vi } from 'vitest';
import { parseManifest, type CodeManifest } from '../domain/grading/manifest';
import { GraderFailedError } from '../domain/grading/code';
import { runCodeGrader } from './run-code';
import { localSandbox } from './sandbox/local';
import { selectSandbox } from './sandbox';
import { SandboxUnavailableError } from './sandbox/errors';
import type { Sandbox } from './sandbox/port';

const manifest = (source: string) =>
  parseManifest({
    id: 'fieldnote/run-code-fixture',
    version: '0.1.0',
    evaluatorVersion: '1.0.0',
    subject: 'repository',
    mode: 'deterministic',
    category: 'test-discipline',
    kind: 'code',
    needs: { 'repo.tree': ['**/*'] },
    code: { source },
    disclaimer: 'Evidence, not certification.',
    card: { title: 'Fixture', tagline: 'Is it?', groups: [{ title: 'All', checks: ['has-files'] }] },
    checks: [
      { id: 'has-files', title: 'Has files', points: 100, explain: { pass: 'Files.', fail: 'None.' } },
    ],
  }) as CodeManifest;
const snapshot = {
  sha: 'a'.repeat(40),
  complete: true,
  documents: [],
  tree: [{ path: 'src/a.ts', size: 1 }],
  metrics: null,
};
const PASSING = `export default ({ tree }) => ({
  checks: [{ id: 'has-files', status: tree.length ? 'pass' : 'fail', paths: tree.map((e) => e.path), count: { matched: tree.length, of: tree.length } }],
});`;

// Records destroy() calls around the real local adapter.
function watched(overrides: Partial<Sandbox> = {}) {
  const destroy = vi.fn(localSandbox.destroy);
  const sandbox: Sandbox = { ...localSandbox, destroy, ...overrides };
  return { sandbox, destroy };
}

test('a program runs in the box and its answer becomes a grade', async () => {
  const { sandbox, destroy } = watched();
  const { result, insufficient } = await runCodeGrader(manifest(PASSING), snapshot, sandbox);
  expect(insufficient).toBe(false);
  expect(result.score).toBe(100);
  expect(result.checks[0]).toMatchObject({
    paths: ['src/a.ts'],
    explanation: 'Files. Measured 1 of 1. Evidence, not certification.',
  });
  expect(destroy).toHaveBeenCalledTimes(1);
});

test('a crashing program is the grader failing, and the box is still destroyed', async () => {
  const { sandbox, destroy } = watched();
  await expect(
    runCodeGrader(manifest("export default () => { throw new Error('boom'); };"), snapshot, sandbox),
  ).rejects.toBeInstanceOf(GraderFailedError);
  expect(destroy).toHaveBeenCalledTimes(1);
});

test('output that is not JSON is the grader failing', async () => {
  await expect(
    runCodeGrader(manifest('export default () => undefined;'), snapshot, localSandbox),
  ).rejects.toBeInstanceOf(GraderFailedError);
});

test('an answer that breaks the contract is the grader failing', async () => {
  await expect(
    runCodeGrader(manifest("export default () => ({ checks: [], note: 'hi' });"), snapshot, localSandbox),
  ).rejects.toBeInstanceOf(GraderFailedError);
});

test('a timed-out or overflowing program is the grader failing', async () => {
  const timedOut = watched({
    exec: async () => ({ exitCode: null, stdout: '', timedOut: true, overflowed: false }),
  });
  await expect(runCodeGrader(manifest(PASSING), snapshot, timedOut.sandbox)).rejects.toBeInstanceOf(
    GraderFailedError,
  );
  const overflowed = watched({
    exec: async () => ({ exitCode: null, stdout: '', timedOut: false, overflowed: true }),
  });
  await expect(runCodeGrader(manifest(PASSING), snapshot, overflowed.sandbox)).rejects.toBeInstanceOf(
    GraderFailedError,
  );
  expect(timedOut.destroy).toHaveBeenCalledTimes(1);
  expect(overflowed.destroy).toHaveBeenCalledTimes(1);
});

test('a substrate failure passes through as unavailable, and the box is still destroyed', async () => {
  const { sandbox, destroy } = watched({
    write: async () => {
      throw new SandboxUnavailableError(true);
    },
  });
  await expect(runCodeGrader(manifest(PASSING), snapshot, sandbox)).rejects.toMatchObject({
    name: 'SandboxUnavailableError',
    retryable: true,
  });
  expect(destroy).toHaveBeenCalledTimes(1);
});

test('a destroy that fails does not replace the outcome', async () => {
  const { sandbox } = watched({
    destroy: async () => {
      throw new Error('already gone');
    },
  });
  const { result } = await runCodeGrader(manifest(PASSING), snapshot, sandbox);
  expect(result.score).toBe(100);
});

test('the program is given its evidence and the limits', async () => {
  const exec = vi.fn(localSandbox.exec);
  const write = vi.fn(localSandbox.write);
  await runCodeGrader(manifest(PASSING), snapshot, { ...localSandbox, exec, write });
  expect(write.mock.calls.map(([, name]) => name)).toEqual(['grader.mjs', 'run.mjs', 'input.json']);
  expect(JSON.parse(write.mock.calls[2][2])).toEqual({ evidence: { tree: snapshot.tree } });
  expect(exec.mock.calls[0][2]).toEqual({ timeoutMs: 20_000, maxOutputBytes: 256 * 1024 });
});

test('production with no E2B key has no sandbox, and never falls back to the local one', () => {
  expect(() => selectSandbox({ NODE_ENV: 'production' })).toThrow(SandboxUnavailableError);
  try {
    selectSandbox({ NODE_ENV: 'production' });
  } catch (error) {
    expect((error as SandboxUnavailableError).retryable).toBe(false);
  }
});

test('development and tests with no key use the local sandbox', () => {
  expect(selectSandbox({ NODE_ENV: 'test' })).toBe(localSandbox);
  expect(selectSandbox({ NODE_ENV: 'development' })).toBe(localSandbox);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/grading/run-code.test.ts`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement**

`src/grading/sandbox/index.ts`:

```ts
import { SandboxUnavailableError } from './errors';
import { localSandbox } from './local';
import type { Sandbox } from './port';

/**
 * Which substrate runs a code grader. Production never falls back to the
 * local adapter: that would silently drop the network lock in exactly the
 * environment it exists for.
 */
export function selectSandbox(env: NodeJS.ProcessEnv = process.env): Sandbox {
  if (env.NODE_ENV === 'production') throw new SandboxUnavailableError(false);
  return localSandbox;
}
```

`src/grading/run-code.ts`:

```ts
import {
  assembleCodeResult,
  codeGraderInput,
  GraderFailedError,
  type CodeEvaluation,
} from '../domain/grading/code';
import type { CodeManifest } from '../domain/grading/manifest';
import type { RepositorySnapshot } from '../domain/grading/types';
import { graderCommand, RUNNER_SOURCE } from './sandbox/runner';
import type { ExecResult, Sandbox } from './sandbox/port';

export const GRADER_LIMITS = { timeoutMs: 20_000, maxOutputBytes: 256 * 1024 };

/**
 * One box per run: create it, write the program, the runner and the evidence,
 * run once, destroy it whatever happened. A program's failure is
 * GraderFailedError; a substrate failure is the adapter's
 * SandboxUnavailableError, passed through untouched.
 */
export async function runCodeGrader(
  manifest: CodeManifest,
  snapshot: RepositorySnapshot,
  sandbox: Sandbox,
): Promise<CodeEvaluation> {
  const input = codeGraderInput(manifest, snapshot);
  const handle = await sandbox.create();
  let execution: ExecResult;
  try {
    await sandbox.write(handle, 'grader.mjs', manifest.code.source);
    await sandbox.write(handle, 'run.mjs', RUNNER_SOURCE);
    await sandbox.write(handle, 'input.json', JSON.stringify(input));
    execution = await sandbox.exec(handle, graderCommand(handle.root), GRADER_LIMITS);
  } finally {
    // A destroy that fails is swallowed: the box's own lifetime ends it, and a
    // cleanup error must not replace the run's real outcome.
    await sandbox.destroy(handle).catch(() => undefined);
  }
  if (execution.timedOut || execution.overflowed || execution.exitCode !== 0)
    throw new GraderFailedError('The grader program did not finish.');
  let answer: unknown;
  try {
    answer = JSON.parse(execution.stdout);
  } catch {
    throw new GraderFailedError('The grader program printed something that is not JSON.');
  }
  return assembleCodeResult(manifest, input, answer);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/grading/run-code.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/grading/run-code.ts src/grading/run-code.test.ts src/grading/sandbox/index.ts
git commit -m "feat(grading): run a code grader in a box, once, and always clean up

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The worker reads a verdict, and failures keep their names

**Files:**
- Create: `src/grading/evaluate.ts`
- Modify: `src/inngest/functions/grade-repository.ts`
- Modify: `src/db/queries/grade-runs.ts:477-489` (`failGrade` whitelist)
- Modify: `src/components/grading/report.tsx:119-122`
- Test: `src/grading/evaluate.test.ts`, `src/inngest/functions/grade-repository.test.ts`, `src/components/grading/report.test.ts`, `src/db/grade-runs.integration.test.ts`

**Interfaces:**
- Consumes: `runCodeGrader`, `selectSandbox` (Task 6); `GraderFailedError` (Task 4); `SandboxUnavailableError` (Task 5); `CollectedEvidence` from `src/grading/evidence.ts`.
- Produces:
  - `type Evaluation = { result: GradeResult; verdict: 'scored' | 'insufficient' | 'incomplete' }`
  - `evaluate(manifest: GraderManifest, collected: CollectedEvidence): Promise<Evaluation>`
  - `finalFailureCode(error: { name?: string } | undefined): 'sandbox_unavailable' | undefined` exported from `grade-repository.ts`
  - `failGrade` keeps `'grader_failed'` and `'sandbox_unavailable'`

- [ ] **Step 1: Write the failing `evaluate` tests**

Create `src/grading/evaluate.test.ts`:

```ts
import { beforeEach, expect, test, vi } from 'vitest';

const code = vi.hoisted(() => ({ runCodeGrader: vi.fn() }));
const sandbox = vi.hoisted(() => ({ selectSandbox: vi.fn(() => ({ name: 'fake' })) }));
vi.mock('./run-code', () => code);
vi.mock('./sandbox', () => sandbox);

const { evaluate } = await import('./evaluate');
const { parseManifest } = await import('../domain/grading/manifest');
const { agentReadinessManifest } = await import('../domain/grading/graders/agent-readiness');
const { deliveryHealthManifest } = await import('../domain/grading/graders/delivery-health');

const codeManifest = parseManifest({
  id: 'fieldnote/evaluate-fixture',
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'test-discipline',
  kind: 'code',
  needs: { 'repo.tree': ['**/*'] },
  code: { source: 'export default () => ({ checks: [] });' },
  disclaimer: 'Evidence, not certification.',
  card: { title: 'Fixture', tagline: 'Is it?', groups: [{ title: 'All', checks: ['t'] }] },
  checks: [{ id: 't', title: 'T', points: 100, explain: { pass: 'Yes.', fail: 'No.' } }],
});
const sha = 'a'.repeat(40);
const scoredResult = { score: 100, checks: [], rubricVersion: '0.1.0', evaluatorVersion: '1.0.0' };

beforeEach(() => vi.clearAllMocks());

test('a declarative grader with complete evidence is scored', async () => {
  const evaluation = await evaluate(agentReadinessManifest, {
    snapshot: { sha, complete: true, documents: [] },
    incompleteCode: null,
  });
  expect(evaluation.verdict).toBe('scored');
  expect(evaluation.result.score).toBe(0);
});

const metrics = {
  days: 30,
  start: '2026-08-15T00:00:00.000Z',
  endExclusive: '2026-09-14T00:00:00.000Z',
  mergedPullRequests: 3,
  'first-pass-rate': { numerator: 1, denominator: 3, value: (100 * 1) / 3 },
  'ci-success-rate': { numerator: 3, denominator: 3, value: 100 },
  'ci-recovery-rate': { numerator: 0, denominator: 0, value: null },
};

test("a declarative grader's floor miss is insufficient", async () => {
  // A metric-threshold check throws without a window, so the floor-miss
  // snapshot carries one, as collectMetrics() always returns.
  const evaluation = await evaluate(deliveryHealthManifest, {
    snapshot: { sha, complete: false, documents: [], metrics, incompleteReason: 'Quiet.' },
    incompleteCode: 'insufficient_evidence',
  });
  expect(evaluation.verdict).toBe('insufficient');
});

test('a declarative grader whose collection failed is incomplete', async () => {
  const evaluation = await evaluate(agentReadinessManifest, {
    snapshot: { sha, complete: false, documents: [] },
    incompleteCode: 'incomplete_collection',
  });
  expect(evaluation.verdict).toBe('incomplete');
});

test('a code grader on partial evidence is incomplete and never gets a box', async () => {
  const evaluation = await evaluate(codeManifest, {
    snapshot: { sha, complete: false, documents: [], tree: [] },
    incompleteCode: 'incomplete_collection',
  });
  expect(evaluation.verdict).toBe('incomplete');
  expect(sandbox.selectSandbox).not.toHaveBeenCalled();
  expect(code.runCodeGrader).not.toHaveBeenCalled();
});

test("a code grader's own floor is insufficient, decided after collection succeeded", async () => {
  code.runCodeGrader.mockResolvedValue({ result: { ...scoredResult, score: null }, insufficient: true });
  const evaluation = await evaluate(codeManifest, {
    snapshot: { sha, complete: true, documents: [], tree: [] },
    incompleteCode: null,
  });
  expect(evaluation.verdict).toBe('insufficient');
  expect(code.runCodeGrader).toHaveBeenCalledWith(
    codeManifest,
    expect.objectContaining({ sha }),
    { name: 'fake' },
  );
});

test('a code grader that answered is scored', async () => {
  code.runCodeGrader.mockResolvedValue({ result: scoredResult, insufficient: false });
  const evaluation = await evaluate(codeManifest, {
    snapshot: { sha, complete: true, documents: [], tree: [] },
    incompleteCode: null,
  });
  expect(evaluation).toEqual({ result: scoredResult, verdict: 'scored' });
});
```

- [ ] **Step 2: Write the failing worker tests**

In `src/inngest/functions/grade-repository.test.ts`:

1. Add hoisted mocks and module mocks after the existing ones:

```ts
const code = vi.hoisted(() => ({ runCodeGrader: vi.fn() }));
vi.mock('../../grading/run-code', () => code);
vi.mock('../../grading/sandbox', () => ({ selectSandbox: () => ({}) }));
```

2. Change the dynamic import line to `const { evaluateGradeRun, finalFailureCode } = await import('./grade-repository');` and add:

```ts
const { registerGrader } = await import('../../domain/grading/registry');
const { GraderFailedError } = await import('../../domain/grading/code');
const { SandboxUnavailableError } = await import('../../grading/sandbox/errors');
const { NonRetriableError } = await import('inngest');

const codeGrader = registerGrader({
  id: 'fieldnote/worker-code-fixture',
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'test-discipline',
  kind: 'code',
  needs: { 'repo.tree': ['**/*'] },
  code: { source: 'export default () => ({ checks: [] });' },
  insufficientReason: 'Too little code to judge.',
  disclaimer: 'Evidence, not certification.',
  card: { title: 'Fixture', tagline: 'Is it?', groups: [{ title: 'All', checks: ['t'] }] },
  checks: [{ id: 't', title: 'T', points: 100, explain: { pass: 'Yes.', fail: 'No.' } }],
});
const codeRun = {
  ...run,
  graderId: codeGrader.id,
  rubricVersion: codeGrader.version,
  evaluatorVersion: codeGrader.evaluatorVersion,
};
const treeEvidence = {
  snapshot: { sha: run.sha, complete: true, documents: [], tree: [{ path: 'a.ts', size: 1 }] },
  incompleteCode: null,
};
```

3. Append:

```ts
test('a code grader that answered completes the run', async () => {
  queries.loadGradeRun.mockResolvedValue(codeRun);
  broker.collectEvidence.mockResolvedValue(treeEvidence);
  code.runCodeGrader.mockResolvedValue({
    result: { score: 100, checks: [], rubricVersion: '0.1.0', evaluatorVersion: '1.0.0' },
    insufficient: false,
  });
  await evaluateGradeRun('run-1');
  expect(queries.completeGrade).toHaveBeenCalledWith('run-1', expect.objectContaining({ score: 100 }));
  expect(queries.validateGradeRun).toHaveBeenCalledTimes(2);
});

test("a code grader's own floor stores an insufficient run with the manifest's sentence", async () => {
  queries.loadGradeRun.mockResolvedValue(codeRun);
  broker.collectEvidence.mockResolvedValue(treeEvidence);
  code.runCodeGrader.mockResolvedValue({
    result: {
      score: null,
      checks: [],
      rubricVersion: '0.1.0',
      evaluatorVersion: '1.0.0',
      incompleteReason: 'Too little code to judge.',
    },
    insufficient: true,
  });
  await evaluateGradeRun('run-1');
  expect(queries.insufficientGrade).toHaveBeenCalledWith(
    'run-1',
    expect.objectContaining({ score: null, incompleteReason: 'Too little code to judge.' }),
  );
  expect(queries.failGrade).not.toHaveBeenCalled();
});

test('a code grader on an incomplete tree fails as collection and never runs', async () => {
  queries.loadGradeRun.mockResolvedValue(codeRun);
  broker.collectEvidence.mockResolvedValue({
    snapshot: { sha: run.sha, complete: false, documents: [], tree: [] },
    incompleteCode: 'incomplete_collection',
  });
  await evaluateGradeRun('run-1');
  expect(queries.failGrade).toHaveBeenCalledWith('run-1', 'incomplete_collection');
  expect(code.runCodeGrader).not.toHaveBeenCalled();
});

test('a failing program fails the run as grader_failed, without retrying', async () => {
  queries.loadGradeRun.mockResolvedValue(codeRun);
  broker.collectEvidence.mockResolvedValue(treeEvidence);
  code.runCodeGrader.mockRejectedValue(new GraderFailedError('The grader program did not finish.'));
  await expect(evaluateGradeRun('run-1')).rejects.toBeInstanceOf(NonRetriableError);
  expect(queries.failGrade).toHaveBeenCalledWith('run-1', 'grader_failed');
});

test('no sandbox in production fails the run as sandbox_unavailable, without retrying', async () => {
  queries.loadGradeRun.mockResolvedValue(codeRun);
  broker.collectEvidence.mockResolvedValue(treeEvidence);
  code.runCodeGrader.mockRejectedValue(new SandboxUnavailableError(false));
  await expect(evaluateGradeRun('run-1')).rejects.toBeInstanceOf(NonRetriableError);
  expect(queries.failGrade).toHaveBeenCalledWith('run-1', 'sandbox_unavailable');
});

test('a sandbox outage is retried under its own name and stores nothing yet', async () => {
  queries.loadGradeRun.mockResolvedValue(codeRun);
  broker.collectEvidence.mockResolvedValue(treeEvidence);
  code.runCodeGrader.mockRejectedValue(new SandboxUnavailableError(true));
  await expect(evaluateGradeRun('run-1')).rejects.toMatchObject({
    name: 'SandboxUnavailableError',
    message: 'The grading sandbox is unavailable.',
  });
  expect(queries.failGrade).not.toHaveBeenCalled();
});

test('when retries run out, a sandbox outage is recorded as one and anything else as before', () => {
  expect(finalFailureCode({ name: 'SandboxUnavailableError' })).toBe('sandbox_unavailable');
  expect(finalFailureCode({ name: 'Error' })).toBeUndefined();
  expect(finalFailureCode(undefined)).toBeUndefined();
});
```

- [ ] **Step 3: Write the failing report copy test**

In `src/components/grading/report.test.ts`, after the `COULD_NOT_FINISH` constant's tests, append:

```ts
const SANDBOX_UNAVAILABLE = 'Grading is temporarily unavailable. Try again later.';
test('a run that failed for want of a sandbox says so, not that the grader broke', () => {
  const html = renderToStaticMarkup(
    createElement(GradeControls, {
      repositoryId: 'repo',
      graderId: AGENT_READINESS,
      initial: { id: 'run', state: 'failed', errorCode: 'sandbox_unavailable' },
      canRun: true,
    }),
  );
  expect(html).toContain(SANDBOX_UNAVAILABLE);
  expect(html).not.toContain(COULD_NOT_FINISH);
});
test('a run whose program failed reads as the grader not finishing', () => {
  const html = renderToStaticMarkup(
    createElement(GradeControls, {
      repositoryId: 'repo',
      graderId: AGENT_READINESS,
      initial: { id: 'run', state: 'failed', errorCode: 'grader_failed' },
      canRun: true,
    }),
  );
  expect(html).toContain(COULD_NOT_FINISH);
});
```

- [ ] **Step 4: Write the failing whitelist integration test**

In `src/db/grade-runs.integration.test.ts`, append (it uses the file's own `fixtureRepository`, `requestGrade`, `failGrade` and `loadGradeRun`, already imported):

```ts
test('a code grader failure and a sandbox outage keep their own error codes', async () => {
  const repo = await fixtureRepository();
  const failed = await requestGrade(repo, AGENT_READINESS);
  await failGrade(failed.id, 'grader_failed');
  expect((await loadGradeRun(failed.id))?.errorCode).toBe('grader_failed');
  const outage = await requestGrade(repo, AGENT_READINESS);
  await failGrade(outage.id, 'sandbox_unavailable');
  expect((await loadGradeRun(outage.id))?.errorCode).toBe('sandbox_unavailable');
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `pnpm vitest run src/grading/evaluate.test.ts src/inngest/functions/grade-repository.test.ts src/components/grading/report.test.ts`
Expected: FAIL.

- [ ] **Step 6: Implement `src/grading/evaluate.ts`**

```ts
import { INCOMPLETE, runDeclarative } from '../domain/grading/declarative';
import type { GraderManifest } from '../domain/grading/manifest';
import type { GradeResult } from '../domain/grading/types';
import type { CollectedEvidence } from './evidence';
import { runCodeGrader } from './run-code';
import { selectSandbox } from './sandbox';

export type Evaluation = {
  result: GradeResult;
  verdict: 'scored' | 'insufficient' | 'incomplete';
};

/**
 * The verdict a run ends on, whoever decided it. A declarative grader's floor
 * is enforced by the broker and arrives as its error code; a code grader's
 * floor is decided by its program after collection succeeded. The branch is on
 * the manifest's kind — a property of the contract, never a grader id.
 */
export async function evaluate(
  manifest: GraderManifest,
  { snapshot, incompleteCode }: CollectedEvidence,
): Promise<Evaluation> {
  if (manifest.kind === 'declarative') {
    const result = runDeclarative(manifest, snapshot);
    if (result.score !== null) return { result, verdict: 'scored' };
    return {
      result,
      verdict: incompleteCode === 'insufficient_evidence' ? 'insufficient' : 'incomplete',
    };
  }
  // No program is worth a box on evidence fieldnote already knows is partial.
  if (!snapshot.complete)
    return {
      result: {
        score: null,
        checks: [],
        rubricVersion: manifest.version,
        evaluatorVersion: manifest.evaluatorVersion,
        incompleteReason: snapshot.incompleteReason ?? INCOMPLETE,
      },
      verdict: 'incomplete',
    };
  const { result, insufficient } = await runCodeGrader(manifest, snapshot, selectSandbox());
  return { result, verdict: insufficient ? 'insufficient' : 'scored' };
}
```

- [ ] **Step 7: Rewire the worker**

In `src/inngest/functions/grade-repository.ts`:

1. Replace the imports of `getGrader` / `runDeclarative` with:

```ts
import { getGrader } from '../../domain/grading/registry';
import { GraderFailedError } from '../../domain/grading/code';
import { evaluate } from '../../grading/evaluate';
import { SandboxUnavailableError } from '../../grading/sandbox/errors';
```

2. Replace `collectionFailure` with:

```ts
async function collectionFailure(runId: string, error: unknown): Promise<never> {
  if (error instanceof FileCollectionError && !error.retryable) {
    await failGrade(runId);
    throw new NonRetriableError('Repository evidence unavailable');
  }
  // Same input, same result: a program that failed once fails again.
  if (error instanceof GraderFailedError) {
    await failGrade(runId, 'grader_failed');
    throw new NonRetriableError('Grader failed');
  }
  if (error instanceof SandboxUnavailableError) {
    if (!error.retryable) {
      await failGrade(runId, 'sandbox_unavailable');
      throw new NonRetriableError('Grading sandbox unavailable');
    }
    // Rethrown fresh and under its own name, so no vendor message rides along
    // and onFailure can still tell an outage from fieldnote failing to read.
    throw new SandboxUnavailableError(true);
  }
  // Never let provider exceptions (request headers or source) enter Inngest logs.
  throw new Error('Repository evidence collection failed');
}

/**
 * The code a run records when Inngest's retries are spent. Inngest's StepError
 * keeps the original error's name, so an outage that outlasted every retry is
 * stored as an outage rather than as fieldnote failing to read the repository.
 */
export function finalFailureCode(error: { name?: string } | undefined) {
  return error?.name === 'SandboxUnavailableError' ? ('sandbox_unavailable' as const) : undefined;
}
```

3. Replace the `try` block body of `evaluateGradeRun` with:

```ts
    const manifest = getGrader(run.graderId);
    const collected = await collectEvidence(manifest, run.repositoryId, run.sha, run.createdAt);
    const { result, verdict } = await evaluate(manifest, collected);
    // A failure stores nothing: its check results failed for want of evidence,
    // not for want of the thing they measure.
    if (verdict === 'incomplete') {
      await failGrade(runId, collected.incompleteCode ?? undefined);
      return;
    }
    // Recheck authorization after collection, before storing anything.
    if (!(await validated(runId))) return;
    if (verdict === 'insufficient') await insufficientGrade(runId, result);
    else await completeGrade(runId, result);
```

4. Change `onFailure` to:

```ts
    onFailure: async ({ event, error }) => {
      await failGrade(gradeRequestedData.parse(event.data.event.data).runId, finalFailureCode(error));
    },
```

- [ ] **Step 8: Whitelist the codes and add the copy**

In `src/db/queries/grade-runs.ts` `failGrade`, add `'grader_failed'` and `'sandbox_unavailable'` to the `safe` array after `'incomplete_collection'`, and update the `insufficient_evidence` comment to:

```ts
    // insufficient_evidence is unreachable from the declarative path after the
    // insufficient state, and a code grader's own floor is stored as insufficient
    // too. Kept as the backstop for a floor the broker enforces on a code grader.
```

In `src/components/grading/report.tsx`, replace the `run?.state === 'failed'` branch with:

```tsx
                : run?.state === 'failed'
                  ? run.errorCode === 'insufficient_evidence'
                    ? 'There is not enough record in this window to score. Try again once more work has merged.'
                    : run.errorCode === 'sandbox_unavailable'
                      ? 'Grading is temporarily unavailable. Try again later.'
                      : 'The grader could not finish. Your last completed report is unchanged. Try again.'
                  : '')}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm vitest run src/grading src/inngest/functions/grade-repository.test.ts src/components/grading/report.test.ts && pnpm typecheck && pnpm lint`
Then: `DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/grade-runs.integration.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/grading/evaluate.ts src/grading/evaluate.test.ts src/inngest/functions/grade-repository.ts src/inngest/functions/grade-repository.test.ts src/db/queries/grade-runs.ts src/db/grade-runs.integration.test.ts src/components/grading/report.tsx src/components/grading/report.test.ts
git commit -m "feat(grading): a run ends on a verdict, and a failure keeps its name

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The nightly skip reads the labels, the version and insufficient runs

**Files:**
- Modify: `src/db/queries/grade-runs.ts` (add `latestFinishedGrade` after `latestCompletedGrade`)
- Modify: `src/inngest/functions/schedule-grades.ts:5-55`
- Test: `src/inngest/functions/schedule-grades.test.ts`, `src/db/grade-schedules.integration.test.ts`

**Interfaces:**
- Consumes: `changesOverTime` (Task 1).
- Produces: `latestFinishedGrade(repositoryId: string, graderId: string): Promise<{ sha: string; rubricVersion: string } | null>` — the newest run in `complete` or `insufficient` state with a sha. Session-free trusted worker primitive, like `latestCompletedGrade`.

- [ ] **Step 1: Write the failing unit tests**

In `src/inngest/functions/schedule-grades.test.ts`:

1. Rename the mock `latestCompletedGrade` to `latestFinishedGrade` everywhere in the file (hoisted object, `beforeEach`, existing tests). Existing tests that return `{ sha: 'a'.repeat(40) }` must now return `{ sha: 'a'.repeat(40), rubricVersion: agentReadinessManifest.version }` to keep meaning "same commit, same version".
2. Import `agentReadinessManifest` alongside `AGENT_READINESS`.
3. Append:

```ts
test('a repository grader runs on an unchanged commit when its version moved', async () => {
  runs.latestFinishedGrade.mockResolvedValue({ sha: 'a'.repeat(40), rubricVersion: '0.0.9' });
  expect(await scheduleIfDue(readinessRow)).toBe('run-1');
});

test('the skip is keyed off the evidence labels, not the subject field', async () => {
  // A with-commits grader skips an unchanged commit at the same version...
  runs.latestFinishedGrade.mockResolvedValue({
    sha: 'a'.repeat(40),
    rubricVersion: agentReadinessManifest.version,
  });
  expect(await scheduleIfDue(readinessRow)).toBeNull();
  // ...and an over-time grader never asks.
  expect(await scheduleIfDue(deliveryRow)).toBe('run-1');
  expect(runs.latestFinishedGrade).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Write the failing integration tests**

In `src/db/grade-schedules.integration.test.ts`, add `insufficientGrade` and `failGrade` to the `./queries/grade-runs` import and append:

```ts
test('an insufficient run on the same commit counts as done', async () => {
  const repositoryId = await fixtureRepository();
  await writeGradeSchedule(repositoryId, AGENT_READINESS, true);
  const row = (await listGradeSchedules()).find((entry) => entry.repositoryId === repositoryId)!;
  const runId = (await scheduleIfDue(row))!;
  await beginGrade(runId);
  await pinGradeSha(runId, HEAD_SHA);
  await insufficientGrade(runId, {
    score: null,
    checks: [],
    rubricVersion: agentReadinessManifest.version,
    evaluatorVersion: agentReadinessManifest.evaluatorVersion,
    incompleteReason: 'Too little.',
  });
  expect(await scheduleIfDue(row)).toBeNull();
});

test('a failed run on the same commit does not count as done', async () => {
  const repositoryId = await fixtureRepository();
  await writeGradeSchedule(repositoryId, AGENT_READINESS, true);
  const row = (await listGradeSchedules()).find((entry) => entry.repositoryId === repositoryId)!;
  const runId = (await scheduleIfDue(row))!;
  await beginGrade(runId);
  await pinGradeSha(runId, HEAD_SHA);
  await failGrade(runId, 'grader_failed');
  expect(await scheduleIfDue(row)).not.toBeNull();
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run src/inngest/functions/schedule-grades.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement the query**

In `src/db/queries/grade-runs.ts`, after `latestCompletedGrade`, add:

```ts
/**
 * The newest run that finished with a result — scored or too little to judge —
 * and the version it was judged at. What the nightly skip compares against: a
 * failed run is never "done", and a new version on the same commit is new work.
 * Trusted worker primitive with no session, like latestCompletedGrade.
 */
export async function latestFinishedGrade(
  repositoryId: string,
  graderId: string,
): Promise<{ sha: string; rubricVersion: string } | null> {
  const [run] = await db()
    .select({ sha: runs.sha, rubricVersion: runs.rubricVersion })
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
  return run?.sha ? { sha: run.sha, rubricVersion: run.rubricVersion } : null;
}
```

Add `isNotNull` to the `drizzle-orm` import if it is not already there (`inArray` already is).

- [ ] **Step 5: Implement the skip**

In `src/inngest/functions/schedule-grades.ts`:

1. Replace `latestCompletedGrade` with `latestFinishedGrade` in the import, and add `import { changesOverTime } from '../../domain/grading/manifest';`.
2. Replace the Step 4 comment and block with:

```ts
  // Step 4. A grader whose evidence changes over time always runs — the
  // evidence moved by definition. Every other grader costs one sha lookup and
  // stops there if its last finished run, scored or too little to judge, was
  // this commit at this version: same commit, same program, same answer, and a
  // code grader would rent a box to be told it again. Keyed off the evidence
  // labels rather than manifest.subject, because the labels are what the skip
  // is actually about.
  if (!changesOverTime(manifest)) {
    let head: string;
    try {
      head = await resolveHeadSha(row.repositoryId);
    } catch {
      return null;
    }
    const latest = await latestFinishedGrade(row.repositoryId, row.graderId);
    if (latest?.sha === head && latest.rubricVersion === manifest.version) return null;
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run src/inngest/functions/schedule-grades.test.ts && pnpm typecheck && pnpm lint`
Then: `DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/grade-schedules.integration.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/queries/grade-runs.ts src/inngest/functions/schedule-grades.ts src/inngest/functions/schedule-grades.test.ts src/db/grade-schedules.integration.test.ts
git commit -m "fix(grading): grade again when the grader changed, not only the commit

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `fieldnote/test-discipline`

**Files:**
- Create: `src/domain/grading/graders/test-discipline/grader.mjs`
- Create: `scripts/embed-graders.ts`; modify `package.json` scripts
- Create (generated): `src/domain/grading/graders/test-discipline/source.generated.ts`
- Create: `src/domain/grading/graders/test-discipline.ts`
- Modify: `src/domain/grading/graders/index.ts`
- Test: `src/domain/grading/graders/test-discipline/grader.test.ts`, `src/domain/grading/graders/test-discipline/source.test.ts`, `src/domain/grading/graders/test-discipline.test.ts`, `src/db/queries/grade-runs.registration.test.ts`

**Interfaces:**
- Consumes: `registerGrader` (Task 1).
- Produces: `TEST_DISCIPLINE = 'fieldnote/test-discipline'`, `testDisciplineManifest: GraderManifest` (kind `code`); `grader.mjs` default export `grade(evidence: { tree: { path: string; size: number }[] })` returning the answer shape.

- [ ] **Step 1: Write the failing program tests**

Create `src/domain/grading/graders/test-discipline/grader.test.ts`:

```ts
import { expect, test } from 'vitest';
import grade from './grader.mjs';

type Answer = {
  checks: { id: string; status: string; paths?: string[]; count?: { matched: number; of: number } }[];
  insufficient?: true;
};
const run = (...paths: string[]) =>
  grade({ tree: paths.map((path) => ({ path, size: 1 })) }) as Answer;
const check = (answer: Answer, id: string) => answer.checks.find((c) => c.id === id)!;

test('a well-tested repository passes every check', () => {
  const answer = run(
    'src/billing/invoice.ts',
    'src/billing/invoice.test.ts',
    'src/billing/tax.ts',
    'src/billing/tax.test.ts',
    'src/auth/session.ts',
    'src/auth/session.spec.ts',
    'src/auth/token.ts',
    'src/auth/token.test.ts',
    'src/index.ts',
    'src/index.test.ts',
  );
  expect(answer.insufficient).toBeUndefined();
  expect(answer.checks.map((c) => [c.id, c.status])).toEqual([
    ['tests-exist', 'pass'],
    ['tests-beside-source', 'pass'],
    ['tests-in-every-folder', 'pass'],
  ]);
  expect(check(answer, 'tests-beside-source').count).toEqual({ matched: 5, of: 5 });
  // src/billing, src/auth, and src itself for src/index.ts.
  expect(check(answer, 'tests-in-every-folder').count).toEqual({ matched: 3, of: 3 });
});

test('no tests fails every check', () => {
  const answer = run('src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts');
  expect(answer.checks.map((c) => c.status)).toEqual(['fail', 'fail', 'fail']);
  expect(check(answer, 'tests-exist').paths).toEqual([]);
  expect(check(answer, 'tests-beside-source').count).toEqual({ matched: 0, of: 5 });
});

test('half the source files having a test is enough', () => {
  const answer = run(
    'lib/a.ts', 'lib/a.test.ts', 'lib/b.ts', 'lib/b.test.ts', 'lib/c.ts', 'lib/c.test.ts',
    'lib/d.ts', 'lib/e.ts', 'lib/f.ts',
  );
  expect(check(answer, 'tests-beside-source')).toMatchObject({
    status: 'pass',
    count: { matched: 3, of: 6 },
  });
});

test('one folder without tests fails tests-in-every-folder', () => {
  const answer = run(
    'packages/api/a.ts', 'packages/api/a.test.ts', 'packages/api/b.ts', 'packages/api/b.test.ts',
    'packages/web/c.ts', 'packages/web/d.ts',
  );
  expect(check(answer, 'tests-in-every-folder')).toMatchObject({
    status: 'fail',
    count: { matched: 1, of: 2 },
  });
});

test("each language's test naming is recognised", () => {
  const answer = run(
    'pkg/store.go', 'pkg/store_test.go',
    'app/models.py', 'app/test_models.py',
    'app/views.py', 'app/views_test.py',
    'lib/user.rb', 'lib/user_spec.rb',
    'core/Parser.java', 'core/ParserTest.java',
    'web/View.kt', 'web/ViewTests.kt',
    'ui/button.tsx', 'ui/__tests__/button.tsx',
  );
  expect(check(answer, 'tests-beside-source').count).toEqual({ matched: 7, of: 7 });
});

test('excluded directories, declarations, config and dotfiles are not source', () => {
  const answer = run(
    'node_modules/x/index.js', 'dist/app.js', 'build/out.js', 'vendor/lib.go', 'coverage/lcov.js',
    '.github/scripts/run.js', 'types/global.d.ts', 'vite.config.ts', '.eslintrc.js', 'README.md',
    'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts',
  );
  expect(check(answer, 'tests-beside-source').count).toEqual({ matched: 0, of: 5 });
});

test('fewer than five source files is insufficient, and every check is still reported', () => {
  const answer = run('src/a.ts', 'src/a.test.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts');
  expect(answer.insufficient).toBe(true);
  expect(answer.checks).toHaveLength(3);
});

test('paths are capped at twenty and never repeated', () => {
  const paths = Array.from({ length: 30 }, (_, i) => [`src/m${i}.ts`, `src/m${i}.test.ts`]).flat();
  const answer = run(...paths);
  for (const c of answer.checks) {
    expect(c.paths!.length).toBeLessThanOrEqual(20);
    expect(new Set(c.paths).size).toBe(c.paths!.length);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/domain/grading/graders/test-discipline/grader.test.ts`
Expected: FAIL — `./grader.mjs` does not exist.

- [ ] **Step 3: Write the program**

Create `src/domain/grading/graders/test-discipline/grader.mjs`:

```js
// fieldnote/test-discipline. Runs inside the grading sandbox, which holds this
// file, fieldnote's runner and the evidence, and nothing else — so it imports
// nothing. It reads file names, never file contents.
//
// Every rule below is this grader's judgement. Changing one is a version bump,
// because a repository's score would move underneath it.

const SOURCE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rb', 'java', 'kt', 'rs', 'cs', 'php', 'swift',
]);
const EXCLUDED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'coverage']);
const TEST_DIRECTORIES = new Set(['__tests__', 'test', 'tests', 'spec']);
// A folder under one of these is a package or a module in its own right.
const CONTAINERS = new Set(['src', 'packages', 'apps', 'services', 'libs', 'lib']);
const MIN_SOURCE_FILES = 5;
const MAX_PATHS = 20;

function extension(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function isTestName(name) {
  const lower = name.toLowerCase();
  return (
    /\.(test|spec)\./.test(lower) ||
    lower.endsWith('_test.go') ||
    /^test_.*\.py$/.test(lower) ||
    /_test\.py$/.test(lower) ||
    /Tests?\.(java|kt)$/.test(name) ||
    lower.endsWith('_spec.rb')
  );
}

// A file's name with its extension and any test marker removed, lower-cased:
// invoice.ts, invoice.test.ts and InvoiceTest.java all have the stem "invoice".
function stem(name) {
  const ext = extension(name);
  let base = name.slice(0, name.length - ext.length - 1);
  if (ext === 'java' || ext === 'kt') base = base.replace(/Tests?$/, '');
  return base
    .toLowerCase()
    .replace(/\.(test|spec)$/, '')
    .replace(/_(test|spec)$/, '')
    .replace(/^test_/, '');
}

function classify(path) {
  const segments = path.split('/');
  const name = segments[segments.length - 1];
  const directories = segments.slice(0, -1);
  if (directories.some((directory) => directory.startsWith('.') || EXCLUDED_DIRECTORIES.has(directory)))
    return null;
  if (name.startsWith('.')) return null;
  if (!SOURCE_EXTENSIONS.has(extension(name))) return null;
  if (name.toLowerCase().endsWith('.d.ts')) return null;
  if (isTestName(name) || directories.some((directory) => TEST_DIRECTORIES.has(directory))) return 'test';
  if (/\.config\./i.test(name)) return null;
  return 'source';
}

function folderOf(path) {
  const segments = path.split('/');
  if (segments.length === 1) return '';
  if (CONTAINERS.has(segments[0]) && segments.length > 2) return `${segments[0]}/${segments[1]}`;
  return segments[0];
}

const basename = (path) => path.slice(path.lastIndexOf('/') + 1);
const byCodeUnit = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

export default function grade(evidence) {
  const sources = [];
  const tests = [];
  for (const { path } of evidence.tree) {
    const kind = classify(path);
    if (kind === 'source') sources.push(path);
    else if (kind === 'test') tests.push(path);
  }

  const testsByStem = new Map();
  for (const path of tests) {
    const key = stem(basename(path));
    testsByStem.set(key, [...(testsByStem.get(key) ?? []), path]);
  }

  const matchedTests = new Set();
  const folders = new Map();
  let matched = 0;
  for (const path of sources) folders.set(folderOf(path), new Set());
  for (const path of tests) folders.get(folderOf(path))?.add(path);
  for (const path of sources) {
    const hits = testsByStem.get(stem(basename(path)));
    if (!hits) continue;
    matched += 1;
    for (const hit of hits) {
      matchedTests.add(hit);
      folders.get(folderOf(path)).add(hit);
    }
  }

  const folderEvidence = [];
  let foldersWithTests = 0;
  for (const [, evidenceForFolder] of [...folders.entries()].sort(([left], [right]) => byCodeUnit(left, right))) {
    if (evidenceForFolder.size === 0) continue;
    foldersWithTests += 1;
    folderEvidence.push([...evidenceForFolder].sort(byCodeUnit)[0]);
  }

  return {
    checks: [
      {
        id: 'tests-exist',
        status: tests.length > 0 ? 'pass' : 'fail',
        paths: tests.slice(0, MAX_PATHS),
      },
      {
        id: 'tests-beside-source',
        status: sources.length > 0 && matched * 2 >= sources.length ? 'pass' : 'fail',
        paths: [...matchedTests].sort(byCodeUnit).slice(0, MAX_PATHS),
        count: { matched, of: sources.length },
      },
      {
        id: 'tests-in-every-folder',
        status: folders.size > 0 && foldersWithTests === folders.size ? 'pass' : 'fail',
        paths: [...new Set(folderEvidence)].slice(0, MAX_PATHS),
        count: { matched: foldersWithTests, of: folders.size },
      },
    ],
    ...(sources.length < MIN_SOURCE_FILES ? { insufficient: true } : {}),
  };
}
```

- [ ] **Step 4: Run the program tests to verify they pass**

Run: `pnpm vitest run src/domain/grading/graders/test-discipline/grader.test.ts`
Expected: PASS (8 tests). If a case fails, fix `grader.mjs`, never the expectation — each expectation is the spec's rule.

- [ ] **Step 5: The embed script, the generated module and its freshness test**

Create `scripts/embed-graders.ts`:

```ts
// A code grader's program must travel inside its manifest, and the Inngest
// worker is a serverless entry point where a runtime readFileSync of a source
// file is exactly what a bundler's file tracing drops. So each program's text
// is embedded in a checked-in module, and source.test.ts fails `pnpm check`
// when the two disagree. Run after editing any grader.mjs.
import { readFileSync, writeFileSync } from 'node:fs';

const CODE_GRADERS = ['test-discipline'];

for (const name of CODE_GRADERS) {
  const directory = `src/domain/grading/graders/${name}`;
  const source = readFileSync(`${directory}/grader.mjs`, 'utf8');
  writeFileSync(
    `${directory}/source.generated.ts`,
    `// Generated by \`pnpm graders:embed\` from grader.mjs. Do not edit by hand:\n// source.test.ts fails when this and grader.mjs disagree.\nexport const source = ${JSON.stringify(source)};\n`,
  );
}
```

In `package.json` `scripts`, add after `"github:sync"`: `"graders:embed": "tsx scripts/embed-graders.ts",`

Run: `pnpm graders:embed`

Create `src/domain/grading/graders/test-discipline/source.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { source } from './source.generated';

test('the embedded program is grader.mjs, byte for byte', () => {
  expect(source).toBe(readFileSync(new URL('./grader.mjs', import.meta.url), 'utf8'));
});
```

- [ ] **Step 6: Write the failing manifest test**

Create `src/domain/grading/graders/test-discipline.test.ts`:

```ts
import { expect, test } from 'vitest';
import { getGrader } from '../registry';
import { changesOverTime } from '../manifest';
import { TEST_DISCIPLINE, testDisciplineManifest } from './test-discipline';
import { source } from './test-discipline/source.generated';

test('test-discipline is an ordinary code grader over the file list', () => {
  expect(getGrader(TEST_DISCIPLINE)).toBe(testDisciplineManifest);
  expect(testDisciplineManifest).toMatchObject({
    version: '0.1.0',
    evaluatorVersion: '1.0.0',
    subject: 'repository',
    mode: 'deterministic',
    category: 'test-discipline',
    kind: 'code',
    needs: { 'repo.tree': ['**/*'] },
  });
  expect(changesOverTime(testDisciplineManifest)).toBe(false);
  if (testDisciplineManifest.kind !== 'code') throw new Error('expected a code grader');
  expect(testDisciplineManifest.code.source).toBe(source);
  expect(testDisciplineManifest.checks.map((check) => [check.id, check.points])).toEqual([
    ['tests-exist', 20],
    ['tests-beside-source', 40],
    ['tests-in-every-folder', 40],
  ]);
});
```

In `src/db/queries/grade-runs.registration.test.ts`, add `expect(ids).toContain('fieldnote/test-discipline');` to the existing test.

- [ ] **Step 7: Write the manifest and register it**

Create `src/domain/grading/graders/test-discipline.ts`:

```ts
import { registerGrader } from '../registry';
import { source } from './test-discipline/source.generated';

export const TEST_DISCIPLINE = 'fieldnote/test-discipline';

// The third built-in and the first code grader. It ships a program because
// the primitives cannot express "a source file has a test with the same stem",
// and the extraction rule says the answer to that is kind: code, not a new
// primitive. It is an ordinary grader: in production its program runs in the
// sandbox exactly as a stranger's would, even though fieldnote wrote it.
export const testDisciplineManifest = registerGrader({
  id: TEST_DISCIPLINE,
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'test-discipline',
  kind: 'code',
  needs: { 'repo.tree': ['**/*'] },
  code: { source },
  insufficientReason: 'Fewer than five source files — not enough code to judge how it is tested.',
  disclaimer:
    'This reads file names, not test contents: a test file with a matching name is not proof the code is tested.',
  card: {
    title: 'Test Discipline',
    tagline: 'Does the code here come with tests, and are they where the code is?',
    groups: [
      { title: 'Presence', checks: ['tests-exist'] },
      { title: 'Coverage by name', checks: ['tests-beside-source', 'tests-in-every-folder'] },
    ],
  },
  checks: [
    {
      id: 'tests-exist',
      title: 'Tests exist',
      points: 20,
      explain: {
        pass: 'Found test files in the repository.',
        fail: 'No test files were found.',
      },
    },
    {
      id: 'tests-beside-source',
      title: 'Source files have tests',
      points: 40,
      explain: {
        pass: 'At least half the source files have a test file with a matching name.',
        fail: 'Fewer than half the source files have a test file with a matching name.',
      },
    },
    {
      id: 'tests-in-every-folder',
      title: 'Every code folder has tests',
      points: 40,
      explain: {
        pass: 'Every code folder has tests.',
        fail: 'Some code folders have no tests.',
      },
    },
  ],
});
```

Append to `src/domain/grading/graders/index.ts`:

```ts
export { TEST_DISCIPLINE, testDisciplineManifest } from './test-discipline';
```

- [ ] **Step 8: Run everything that counts graders**

Run: `pnpm vitest run src/domain/grading src/db/queries/grade-runs.registration.test.ts "src/app/app/repos/[repoId]/grading" src/components/grading && pnpm typecheck && pnpm lint`
Expected: PASS. A page or report test that now sees a third card is a test assuming two graders: update its mocks to include a `TEST_DISCIPLINE` summary the way the existing `DELIVERY_HEALTH` entry is written, and keep every existing assertion. Do not branch the page on the new grader's id.

- [ ] **Step 9: Commit**

```bash
git add src/domain/grading/graders/test-discipline/grader.mjs src/domain/grading/graders/test-discipline/grader.test.ts src/domain/grading/graders/test-discipline/source.generated.ts src/domain/grading/graders/test-discipline/source.test.ts src/domain/grading/graders/test-discipline.ts src/domain/grading/graders/test-discipline.test.ts src/domain/grading/graders/index.ts src/db/queries/grade-runs.registration.test.ts scripts/embed-graders.ts package.json
```

Add any page/report test files Step 8 changed, by explicit path. Then:

```bash
git commit -m "feat(grading): a third built-in, and the first that ships a program

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: The demo gets a third card

**Files:**
- Modify: `src/demo/fixtures.ts`, `scripts/seed.ts`
- Test: `src/demo/fixtures.test.ts`

**Interfaces:**
- Consumes: `assembleCodeResult` (Task 4); `testDisciplineManifest` (Task 9); `grader.mjs` default export (tests only).
- Produces: `demoTestDisciplineTree: TreeEntry[]`, `demoTestDisciplineAnswer`, `demoTestDisciplineGrade: GradeResult`.

- [ ] **Step 1: Write the failing fixture tests**

In `src/demo/fixtures.test.ts`, extend the fixtures import with `demoTestDisciplineAnswer, demoTestDisciplineGrade, demoTestDisciplineTree` and append:

```ts
import grade from '../domain/grading/graders/test-discipline/grader.mjs';

describe('demoTestDisciplineGrade', () => {
  test('the hand-written answer is exactly what the program says about the demo tree', () => {
    // The product never runs a program outside a sandbox, so the fixture is a
    // hand-written answer. This test is what keeps it honest.
    expect(grade({ tree: demoTestDisciplineTree })).toEqual(demoTestDisciplineAnswer);
  });
  test('scores 60 and fails only tests-in-every-folder', () => {
    expect(demoTestDisciplineGrade.score).toBe(60);
    expect(
      demoTestDisciplineGrade.checks.filter((check) => check.status === 'fail').map((c) => c.id),
    ).toEqual(['tests-in-every-folder']);
    expect(demoTestDisciplineGrade.rubricVersion).toBe('0.1.0');
  });
});
```

(Move the `import grade` line to the top of the file with the other imports.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/demo/fixtures.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Add the fixture**

In `src/demo/fixtures.ts`, add imports:

```ts
import { assembleCodeResult } from '../domain/grading/code';
import { testDisciplineManifest } from '../domain/grading/graders/test-discipline';
import type { CodeManifest } from '../domain/grading/manifest';
```

extend the existing types import with `TreeEntry`, and append:

```ts
// The demo checkout service's file list. Seven source files in three folders;
// four have tests, and the gateway folder has none — the failing check, and
// what makes this card read differently from the other two.
export const demoTestDisciplineTree: TreeEntry[] = [
  'package.json',
  'README.md',
  'src/checkout/cart.test.ts',
  'src/checkout/cart.ts',
  'src/checkout/payment.test.ts',
  'src/checkout/payment.ts',
  'src/checkout/shipping.ts',
  'src/gateway/routes.ts',
  'src/gateway/session.ts',
  'src/inventory/reservation.ts',
  'src/inventory/stock.test.ts',
  'src/inventory/stock.ts',
  'tests/inventory/reservation.spec.ts',
].map((path) => ({ path, size: 512 }));

// A hand-written answer, not the program's output: the product only ever runs
// a grader's program in a sandbox, and a fixture must not become the one place
// it runs anywhere else. src/demo/fixtures.test.ts proves the program says
// exactly this about the tree above.
export const demoTestDisciplineAnswer = {
  checks: [
    {
      id: 'tests-exist',
      status: 'pass',
      paths: [
        'src/checkout/cart.test.ts',
        'src/checkout/payment.test.ts',
        'src/inventory/stock.test.ts',
        'tests/inventory/reservation.spec.ts',
      ],
    },
    {
      id: 'tests-beside-source',
      status: 'pass',
      paths: [
        'src/checkout/cart.test.ts',
        'src/checkout/payment.test.ts',
        'src/inventory/stock.test.ts',
        'tests/inventory/reservation.spec.ts',
      ],
      count: { matched: 4, of: 7 },
    },
    {
      id: 'tests-in-every-folder',
      status: 'fail',
      paths: ['src/checkout/cart.test.ts', 'src/inventory/stock.test.ts'],
      count: { matched: 2, of: 3 },
    },
  ],
};

// Assembled by the real answer assembly, for the reason demoGrade is graded by
// the real evaluator: a seeded card must not claim a score, a check id or an
// explanation the contract would not produce.
export const demoTestDisciplineGrade = assembleCodeResult(
  testDisciplineManifest as CodeManifest,
  { evidence: { tree: demoTestDisciplineTree } },
  demoTestDisciplineAnswer,
).result;
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/demo/fixtures.test.ts`
Expected: PASS. If the equality test fails, the tree or the answer above is wrong — correct the **answer** to match the program and re-check the score test; do not edit `grader.mjs` here.

- [ ] **Step 5: Seed it**

In `scripts/seed.ts`:
1. Add `demoTestDisciplineGrade` to the fixtures import and `import { testDisciplineManifest } from '../src/domain/grading/graders/test-discipline';`.
2. After the delivery-health `gradingRubrics` insert, add the same insert for `testDisciplineManifest` (same five fields, same `.onConflictDoNothing()`).
3. After the `demo-delivery-grade-run` insert, add the same `gradeRuns` insert with `id: 'demo-test-discipline-grade-run'`, `graderId`/`rubricVersion`/`evaluatorVersion` from `testDisciplineManifest`, and `result: demoTestDisciplineGrade`.
4. After the `Delivery …` log line, add: ``console.log(`Test discipline ${demoTestDisciplineGrade.score}/100: /app/repos/demo-repository/grading?grader=fieldnote%2Ftest-discipline`);``

Run: `pnpm typecheck && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add src/demo/fixtures.ts src/demo/fixtures.test.ts scripts/seed.ts
git commit -m "feat(demo): a third card, from an answer the program is held to

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: A code grader run end to end through the worker

**Files:**
- Modify: `src/db/grade-schedules.integration.test.ts`

**Interfaces:**
- Consumes: everything above; the file's existing `fixtureRepository()`, `writeGradeSchedule`, `listGradeSchedules`, `scheduleIfDue`, `beginGrade`, `resolveGradeCommit`, `evaluateGradeRun`, `loadGradeRun`.

- [ ] **Step 1: Write the test**

1. Extend the hoisted mock to `const github = vi.hoisted(() => ({ collect: vi.fn(), tree: vi.fn() }));` and add `collectTree: github.tree,` to the `vi.mock('../github/collect-files', …)` factory.
2. Import `TEST_DISCIPLINE` from `'../domain/grading/graders/test-discipline'`.
3. Append:

```ts
test('a code grader run goes through the worker and its program, and is scored', async () => {
  // The worker must use the local sandbox here even on a machine that has an
  // E2B key exported: this test proves the path, not the vendor.
  const previousKey = process.env.E2B_API_KEY;
  delete process.env.E2B_API_KEY;
  try {
    const repositoryId = await fixtureRepository();
    await writeGradeSchedule(repositoryId, TEST_DISCIPLINE, true);
    const row = (await listGradeSchedules()).find(
      (entry) => entry.repositoryId === repositoryId && entry.graderId === TEST_DISCIPLINE,
    )!;
    const runId = await scheduleIfDue(row);
    expect(runId).not.toBeNull();
    github.tree.mockResolvedValueOnce({
      sha: HEAD_SHA,
      complete: true,
      tree: [
        'src/a.ts', 'src/a.test.ts', 'src/b.ts', 'src/b.test.ts', 'src/c.ts', 'src/c.test.ts',
        'src/d.ts', 'src/d.test.ts', 'src/e.ts', 'src/e.test.ts',
      ].map((path) => ({ path, size: 1 })),
    });
    await beginGrade(runId!);
    await resolveGradeCommit(runId!);
    await evaluateGradeRun(runId!);
    const stored = await loadGradeRun(runId!);
    expect(stored?.state).toBe('complete');
    expect(stored?.result?.score).toBe(100);
    expect(stored?.result?.checks.map((check) => check.id)).toEqual([
      'tests-exist',
      'tests-beside-source',
      'tests-in-every-folder',
    ]);
    expect(github.collect).not.toHaveBeenCalled();
  } finally {
    if (previousKey === undefined) delete process.env.E2B_API_KEY;
    else process.env.E2B_API_KEY = previousKey;
  }
});
```

- [ ] **Step 2: Run it**

Run: `DEMO_MODE=false pnpm vitest run --config vitest.integration.config.ts src/db/grade-schedules.integration.test.ts`
Expected: PASS. `github.collect` may have been called by earlier tests in the file; if that last assertion fails for that reason only, add `github.collect.mockClear();` immediately before `beginGrade` rather than removing the assertion.

- [ ] **Step 3: Commit**

```bash
git add src/db/grade-schedules.integration.test.ts
git commit -m "test(grading): drive a code grader through the worker end to end

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: The E2B adapter

**Files:**
- Create: `src/grading/sandbox/e2b.ts`
- Modify: `src/grading/sandbox/index.ts`, `package.json`, `pnpm-lock.yaml`, `.env.example`
- Test: `src/grading/sandbox/e2b.test.ts`, `src/grading/run-code.test.ts`

**Interfaces:**
- Consumes: `Sandbox`, `SandboxUnavailableError` (Task 5).
- Produces: `e2bSandbox(apiKey: string, sdk?: { create(opts: SandboxOpts): Promise<E2BBox> }): Sandbox`; `selectSandbox` returns it whenever `E2B_API_KEY` is set.

- [ ] **Step 1: Add the dependency, exactly pinned**

Run: `pnpm add e2b@2.49.1 --save-exact`
Expected: `package.json` gains `"e2b": "2.49.1"` under `dependencies`.

Read `node_modules/e2b/dist/index.d.ts` for `SandboxOpts`, `Sandbox.create`, `files.write`, `commands.run`, `CommandExitError`, `TimeoutError` and `kill` before writing code — the snippets below were written against 2.49.1; if a signature differs, follow the package and say so in your report.

- [ ] **Step 2: Write the failing tests**

Create `src/grading/sandbox/e2b.test.ts`:

```ts
import { CommandExitError, TimeoutError } from 'e2b';
import { expect, test, vi } from 'vitest';
import { e2bSandbox } from './e2b';
import { SandboxUnavailableError } from './errors';

const SECRET = 'e2b_test_secret_value';
const limits = { timeoutMs: 20_000, maxOutputBytes: 256 * 1024 };

function fakeSdk(run: (command: string, opts: unknown) => Promise<unknown> = async () => ({ exitCode: 0, stdout: '{}', stderr: '' })) {
  const box = {
    sandboxId: 'box-1',
    files: { write: vi.fn(async () => ({})) },
    commands: { run: vi.fn(run) },
    kill: vi.fn(async () => true),
  };
  const sdk = { create: vi.fn(async () => box) };
  // Cast once here: the fake satisfies the calls the adapter makes, not the
  // SDK's full declared types.
  return { sdk: sdk as never, create: sdk.create, box };
}

test('a box is created with no internet, no environment and a one-minute life', async () => {
  const { sdk, create } = fakeSdk();
  await e2bSandbox(SECRET, sdk).create();
  expect(create).toHaveBeenCalledWith({
    apiKey: SECRET,
    allowInternetAccess: false,
    envs: {},
    timeoutMs: 60_000,
  });
});

test('the key reaches the SDK and nothing that enters the box', async () => {
  const { sdk, box } = fakeSdk();
  const sandbox = e2bSandbox(SECRET, sdk);
  const handle = await sandbox.create();
  await sandbox.write(handle, 'grader.mjs', 'export default () => ({});');
  await sandbox.exec(handle, ['node', '--permission', `--allow-fs-read=${handle.root}`, `${handle.root}/run.mjs`], limits);
  expect(JSON.stringify(box.files.write.mock.calls)).not.toContain(SECRET);
  expect(JSON.stringify(box.commands.run.mock.calls)).not.toContain(SECRET);
  expect(box.commands.run).toHaveBeenCalledWith(expect.any(String), { envs: {}, timeoutMs: 20_000 });
  expect(box.files.write).toHaveBeenCalledWith('/home/user/grader/grader.mjs', 'export default () => ({});');
});

test('every argument is shell-quoted', async () => {
  const { sdk, box } = fakeSdk();
  const sandbox = e2bSandbox(SECRET, sdk);
  const handle = await sandbox.create();
  await sandbox.exec(handle, ['node', '-e', "console.log('it''s')"], limits);
  expect(box.commands.run.mock.calls[0][0]).toBe(`'node' '-e' 'console.log('\\''it'\\'''\\''s'\\'')'`);
});

test("a non-zero exit is the program's outcome, not an outage", async () => {
  const { sdk } = fakeSdk(async () => {
    throw new CommandExitError({ exitCode: 1, stdout: '', stderr: 'boom', error: undefined });
  });
  const sandbox = e2bSandbox(SECRET, sdk);
  const result = await sandbox.exec(await sandbox.create(), ['node'], limits);
  expect(result).toEqual({ exitCode: 1, stdout: '', timedOut: false, overflowed: false });
});

test('a command timeout is the program timing out', async () => {
  const { sdk } = fakeSdk(async () => {
    throw new TimeoutError('command timed out');
  });
  const sandbox = e2bSandbox(SECRET, sdk);
  const result = await sandbox.exec(await sandbox.create(), ['node'], limits);
  expect(result.timedOut).toBe(true);
});

test('output past the cap is flagged and discarded', async () => {
  const { sdk } = fakeSdk(async () => ({ exitCode: 0, stdout: 'x'.repeat(limits.maxOutputBytes + 1), stderr: '' }));
  const sandbox = e2bSandbox(SECRET, sdk);
  const result = await sandbox.exec(await sandbox.create(), ['node'], limits);
  expect(result).toMatchObject({ overflowed: true, stdout: '' });
});

test('any other failure is a retryable outage carrying no vendor message', async () => {
  const { sdk } = fakeSdk(async () => {
    throw new Error(`upstream said ${SECRET}`);
  });
  const sandbox = e2bSandbox(SECRET, sdk);
  const handle = await sandbox.create();
  const error = await sandbox.exec(handle, ['node'], limits).catch((caught) => caught);
  expect(error).toBeInstanceOf(SandboxUnavailableError);
  expect(error.retryable).toBe(true);
  expect(error.message).not.toContain(SECRET);

  const refusing = { create: vi.fn(async () => { throw new Error('503'); }) };
  await expect(e2bSandbox(SECRET, refusing as never).create()).rejects.toMatchObject({
    name: 'SandboxUnavailableError',
    retryable: true,
  });
});

test('destroy kills the box', async () => {
  const { sdk, box } = fakeSdk();
  const sandbox = e2bSandbox(SECRET, sdk);
  await sandbox.destroy(await sandbox.create());
  expect(box.kill).toHaveBeenCalledTimes(1);
});
```

In `src/grading/run-code.test.ts`, append:

```ts
test('an E2B key selects the E2B sandbox, in production or not', () => {
  expect(selectSandbox({ NODE_ENV: 'production', E2B_API_KEY: 'k' })).not.toBe(localSandbox);
  expect(selectSandbox({ NODE_ENV: 'test', E2B_API_KEY: 'k' })).not.toBe(localSandbox);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run src/grading/sandbox/e2b.test.ts src/grading/run-code.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `src/grading/sandbox/e2b.ts`**

```ts
import { CommandExitError, Sandbox as E2BSandbox, TimeoutError } from 'e2b';
import { SandboxUnavailableError } from './errors';
import type { ExecResult, Sandbox } from './port';

type E2BBox = Pick<E2BSandbox, 'sandboxId' | 'kill'> & {
  files: Pick<E2BSandbox['files'], 'write'>;
  commands: Pick<E2BSandbox['commands'], 'run'>;
};
type E2BSdk = { create(opts: Parameters<typeof E2BSandbox.create>[0]): Promise<E2BBox> };

// Inside the box, the default user's home. Fixed, so it can appear in the
// command without escaping surprises.
const ROOT = '/home/user/grader';

const quote = (argument: string) => `'${argument.replace(/'/g, `'\\''`)}'`;

function shaped(exitCode: number, stdout: string, maxOutputBytes: number): ExecResult {
  const overflowed = Buffer.byteLength(stdout, 'utf8') > maxOutputBytes;
  return { exitCode, stdout: overflowed ? '' : stdout, timedOut: false, overflowed };
}

/**
 * Production. A fresh E2B box per run with internet access off, no
 * environment, and a sixty-second life so a box whose destroy fails dies on its
 * own. The API key reaches the SDK and nothing that enters the box. Every
 * vendor failure becomes a retryable SandboxUnavailableError with no vendor
 * message.
 */
export function e2bSandbox(apiKey: string, sdk: E2BSdk = E2BSandbox as unknown as E2BSdk): Sandbox {
  const boxes = new Map<string, E2BBox>();
  const box = (id: string) => {
    const found = boxes.get(id);
    if (!found) throw new SandboxUnavailableError(true);
    return found;
  };
  return {
    async create() {
      try {
        const created = await sdk.create({
          apiKey,
          allowInternetAccess: false,
          envs: {},
          timeoutMs: 60_000,
        });
        boxes.set(created.sandboxId, created);
        return { id: created.sandboxId, root: ROOT };
      } catch {
        throw new SandboxUnavailableError(true);
      }
    },
    async write(handle, name, contents) {
      try {
        await box(handle.id).files.write(`${handle.root}/${name}`, contents);
      } catch {
        throw new SandboxUnavailableError(true);
      }
    },
    async exec(handle, command, { timeoutMs, maxOutputBytes }) {
      try {
        const result = await box(handle.id).commands.run(command.map(quote).join(' '), {
          envs: {},
          timeoutMs,
        });
        return shaped(result.exitCode, result.stdout, maxOutputBytes);
      } catch (error) {
        if (error instanceof CommandExitError)
          return shaped(error.exitCode, error.stdout, maxOutputBytes);
        if (error instanceof TimeoutError)
          return { exitCode: null, stdout: '', timedOut: true, overflowed: false };
        throw new SandboxUnavailableError(true);
      }
    },
    async destroy(handle) {
      const found = boxes.get(handle.id);
      boxes.delete(handle.id);
      await found?.kill();
    },
  };
}
```

Note: `exec` returns `shaped(error.exitCode, …)` for a non-zero exit — a resolved `ExecResult` with that exit code, which `runCodeGrader` turns into `grader_failed`. If `tsc` still rejects a fake passed as `sdk`, cast in the test (`as never`); never widen the adapter's parameter type to `any`.

In `src/grading/sandbox/index.ts`, add `import { e2bSandbox } from './e2b';` and make the function body:

```ts
  if (env.E2B_API_KEY) return e2bSandbox(env.E2B_API_KEY);
  if (env.NODE_ENV === 'production') throw new SandboxUnavailableError(false);
  return localSandbox;
```

Append to `.env.example`:

```
# Code graders run in E2B (https://e2b.dev). Without a key, development and
# tests use a local sandbox, and production refuses to run code graders.
E2B_API_KEY=
```

- [ ] **Step 5: Run to verify they pass, and that the build still bundles**

Run: `pnpm vitest run src/grading && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS, and `next build` succeeds with `e2b` imported from the Inngest route's module graph.

- [ ] **Step 6: Commit**

```bash
git add src/grading/sandbox/e2b.ts src/grading/sandbox/e2b.test.ts src/grading/sandbox/index.ts src/grading/run-code.test.ts package.json pnpm-lock.yaml .env.example
git commit -m "feat(grading): run code graders in E2B, with no internet and no environment

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: The live probe and the live enforcement suite

**Requires `E2B_API_KEY`.** The controller asks the user for one before dispatching this task. Without a key the file is still written and committed — it skips — and the probe's result is reported as not yet run.

**Files:**
- Create: `src/grading/sandbox/e2b.live.test.ts`

**Interfaces:**
- Consumes: `e2bSandbox` (Task 12), `hostileGrader`, `graderCommand`, `RUNNER_SOURCE` (Task 5), `runCodeGrader` (Task 6), `testDisciplineManifest` (Task 9).

- [ ] **Step 1: Write the suite**

```ts
import { describe, expect, test } from 'vitest';
import { e2bSandbox } from './e2b';
import { graderCommand, RUNNER_SOURCE } from './runner';
import { hostileGrader } from './hostile.fixture';
import { runCodeGrader } from '../run-code';
import { testDisciplineManifest } from '../../domain/grading/graders/test-discipline';
import type { CodeManifest } from '../../domain/grading/manifest';

const key = process.env.E2B_API_KEY;
const limits = { timeoutMs: 20_000, maxOutputBytes: 256 * 1024 };

// Runs only with a real key: `E2B_API_KEY=… pnpm vitest run src/grading/sandbox/e2b.live.test.ts`.
// This is the one lock `pnpm check` cannot prove offline — see the slice 4
// design, "What is knowingly wrong".
describe.skipIf(!key)('E2B, live', () => {
  test('the base template runs Node with the permission model', async () => {
    const sandbox = e2bSandbox(key!);
    const handle = await sandbox.create();
    try {
      const result = await sandbox.exec(
        handle,
        ['node', '--permission', '-e', 'process.stdout.write(process.version)'],
        limits,
      );
      console.info(`E2B base template Node: ${result.stdout || '(none)'} exit ${result.exitCode}`);
      expect(result.exitCode).toBe(0);
      const [major, minor] = result.stdout.replace(/^v/, '').split('.').map(Number);
      expect(major > 22 || (major === 22 && minor >= 13)).toBe(true);
    } finally {
      await sandbox.destroy(handle);
    }
  }, 60_000);

  test('the hostile program is refused the network, the environment, the filesystem and processes', async () => {
    process.env.FIELDNOTE_SENTINEL = 'secret';
    const sandbox = e2bSandbox(key!);
    const handle = await sandbox.create();
    try {
      await sandbox.write(handle, 'grader.mjs', hostileGrader({ hostPath: '/etc/hostname', network: true }));
      await sandbox.write(handle, 'run.mjs', RUNNER_SOURCE);
      await sandbox.write(handle, 'input.json', JSON.stringify({ evidence: {} }));
      const result = await sandbox.exec(handle, graderCommand(handle.root), limits);
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report).toMatchObject({
        network: 'refused',
        passwd: 'refused',
        host: 'refused',
        write: 'refused',
        spawn: 'refused',
      });
      expect(report.env).not.toContain('FIELDNOTE_SENTINEL');
      expect(report.env).not.toContain('E2B_API_KEY');
    } finally {
      delete process.env.FIELDNOTE_SENTINEL;
      await sandbox.destroy(handle);
    }
  }, 60_000);

  test('a real grade runs end to end in a real box', async () => {
    const started = Date.now();
    const { result } = await runCodeGrader(
      testDisciplineManifest as CodeManifest,
      {
        sha: 'a'.repeat(40),
        complete: true,
        documents: [],
        tree: ['src/a.ts', 'src/a.test.ts', 'src/b.ts', 'src/b.test.ts', 'src/c.ts', 'src/c.test.ts',
          'src/d.ts', 'src/d.test.ts', 'src/e.ts', 'src/e.test.ts'].map((path) => ({ path, size: 1 })),
      },
      e2bSandbox(key!),
    );
    console.info(`E2B end-to-end grade took ${Date.now() - started} ms`);
    expect(result.score).toBe(100);
  }, 60_000);
});
```

- [ ] **Step 2: Run it without a key**

Run: `pnpm vitest run src/grading/sandbox/e2b.live.test.ts`
Expected: 3 skipped.

- [ ] **Step 3: Run it with a key, if the controller supplied one**

Run: `E2B_API_KEY=<key> pnpm vitest run src/grading/sandbox/e2b.live.test.ts`
Expected: 3 passed. Report the Node version and the end-to-end timing printed by the suite.

**If the probe fails** (no Node, or older than 22.13): stop and report BLOCKED with the version printed. Do not build a custom template — that is a vendor configuration decision the spec returns to the user.

**If the hostile test shows anything `allowed`**: stop and report BLOCKED with the full report object. Do not loosen the assertion.

- [ ] **Step 4: Commit**

```bash
git add src/grading/sandbox/e2b.live.test.ts
git commit -m "test(grading): prove the sandbox's locks against a real E2B box

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Final gate

After Task 13, run the full gate once:

```bash
pnpm lint && pnpm typecheck && pnpm test && DEMO_MODE=false pnpm test:integration && pnpm build
```

Expected: lint, typecheck, test and build green; integration green apart from the 2 known `dispatch-import.integration.test.ts` failures. `git diff main -- src/domain/grading/readiness-v01.test.ts` prints nothing.
