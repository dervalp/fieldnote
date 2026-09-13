# Grader Factory Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a second built-in grader (`fieldnote/delivery-health`), give the grade card the identity it needs to hold two graders' names, and render a row of cards on a Grades tab.

**Architecture:** The manifest contract grows four things, each earned by the new grader: a second evidence family in `needs`, a `metric-threshold` primitive, `card.title`, and an optional `GradeResult.window`. A dispatcher in `src/grading/evidence.ts` fans out over the declared families and merges one snapshot; it is deliberately dumb, because slice 3 replaces the file and not the call site. Nothing in `runDeclarative()` learns which grader it is running.

**Tech Stack:** TypeScript, Zod, Next.js 16 (App Router, server components), Drizzle ORM, Postgres, Inngest, Vitest, React 19, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-13-grader-factory-slice-2-design.md`

## Global Constraints

- **`src/domain/grading/readiness-v01.test.ts` must remain byte-identical to `main` and must pass.** It is the acceptance test. If it needs an edit, the contract change is wrong and the edit is a failure to notice. Verify with `git diff main -- src/domain/grading/readiness-v01.test.ts` producing no output.
- **A built-in grader is an ordinary grader.** No private interface, no extra evidence, no code path of its own. No `if (graderId === ...)` anywhere in production code.
- **The extraction rule holds.** A primitive is extracted from a grader that earned it. `metric-threshold` is earned by `fieldnote/delivery-health`. A fourth primitive with no grader behind it is answered with `kind: code`.
- **Grader prose belongs to the grader.** Check titles, taglines, explanations, disclaimers and the insufficient-evidence sentence come from the manifest. fieldnote writes only the sentences a manifest is not in a position to write: the measurement, and collection failing.
- **Metric comparisons use the rounded value.** `Math.round(reading.value) >= atLeastPercent`. The number a reader sees and the number that decided the check must be the same number.
- **`ci-recovery-rate` is `recovered / (recovered + failed)`.** It is NOT `MetricTotals.ciRecovered`, whose denominator includes first-pass runs.
- **Windows are the product's own presets only:** `7 | 30 | 90`. `resolveRange()` accepts no others.
- **Act stays readiness-only.** Do not touch `plan-repository.ts` or `authoring-runs.ts`.
- **Gate:** `pnpm check` (lint, typecheck, test, test:integration, build). Integration tests need `DEMO_MODE=false` on the command line: `DEMO_MODE=false pnpm test:integration`.
- **Commit style:** conventional prefix, lowercase subject, and every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```

## File Structure

**Created**

| Path | Responsibility |
| --- | --- |
| `src/domain/grading/graders/delivery-health.ts` | The second built-in manifest. Prose and thresholds only. |
| `src/domain/grading/graders/index.ts` | Barrel whose import registers every built-in. |
| `src/domain/grading/mode-names.ts` | User-facing names for `mode`, beside `finish-names.ts`. |
| `src/domain/grading/mode-names.test.ts` | Pins the names and the exhaustiveness. |
| `src/domain/grading/declarative.test.ts` | Window, metrics pass-through, whose incomplete reason wins. |
| `src/domain/grading/graders/delivery-health.test.ts` | The manifest registers and scores a fixed window. |
| `src/db/queries/grade-metrics.ts` | `collectMetrics()` — `MetricTotals` to a `MetricsWindow`. |
| `src/db/queries/grade-metrics.integration.test.ts` | Real rows to readings; the recovery denominator. |
| `src/grading/evidence.ts` | The dispatcher over declared families. Slice 3 replaces this file. |
| `src/grading/evidence.test.ts` | Only declared collectors are called. |

**Modified**

| Path | Change |
| --- | --- |
| `src/domain/grading/manifest.ts` | `needs` families, `metric-threshold`, `card.title`, two error codes, two invariants. |
| `src/domain/grading/types.ts` | `MetricReading`, `MetricsWindow`, `CheckEvidence`; `RepositorySnapshot.metrics`/`.incompleteReason`; `GradeResult.window`. |
| `src/domain/grading/primitives.ts` | Takes `CheckEvidence`; the `metric-threshold` branch and the measurement sentence. |
| `src/domain/grading/declarative.ts` | Builds `CheckEvidence`, emits `window`, prefers the snapshot's incomplete reason; exports `INCOMPLETE`. |
| `src/domain/grading/registry.ts` | `listGraders()`. |
| `src/domain/grading/graders/agent-readiness.ts` | `card.title: 'Agent Readiness'`. |
| `src/components/grading/grade-presentation.ts` | `title`, `author`, `mode`, `category` onto the card props. |
| `packages/design-system/src/grade-card.tsx` | Title from props; the identity strip. |
| `packages/design-system/src/grade-card.css` | `.grade-card-identity`. |
| `src/components/grading/report.tsx` | `graderTitle` and `disclaimer` props; `errorCode` on `Status`. |
| `src/components/repository/tabs.ts` | Label `Readiness` → `Grades`. |
| `src/app/repos/[repoId]/grading/page.tsx` | Row of cards, `?grader=`, per-grader report and history. |
| `src/app/repos/[repoId]/grading/actions.ts` | `runGrade(repositoryId, graderId)`. |
| `src/app/api/repos/[repoId]/grades/[runId]/route.ts` | Return `errorCode`. |
| `src/db/queries/grade-runs.ts` | `gradeSummaries(ids, graderIds)`; `GradeSummary.graderId`; `insufficient_evidence`. |
| `src/inngest/functions/grade-repository.ts` | `collectEvidence()` replaces the `repo.files` assertion. |
| `src/demo/fixtures.ts` | A seeded delivery grade. |

---

### Task 1: The manifest grows a second evidence family

**Files:**
- Modify: `src/domain/grading/manifest.ts`
- Modify: `src/domain/grading/graders/agent-readiness.ts`
- Test: `src/domain/grading/manifest.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `GRADER_METRICS: readonly ['first-pass-rate', 'ci-success-rate', 'ci-recovery-rate']`
  - `type GraderMetric = (typeof GRADER_METRICS)[number]`
  - `GraderManifest['needs']` is `{ 'repo.files'?: string[]; 'fieldnote.metrics'?: { windowDays: 7 | 30 | 90; minMergedPullRequests: number; insufficientReason: string } }`
  - `GraderManifest['card']` gains `title: string`
  - A check may be `{ primitive: 'metric-threshold'; args: { metric: GraderMetric; atLeastPercent: number } }`
  - `ManifestErrorCode` gains `'needs_empty' | 'needs_mismatch'`

- [ ] **Step 1: Write the failing tests**

In `src/domain/grading/manifest.test.ts`, add `title: 'Example'` to the `card` object inside `valid()`, then append:

```ts
const metricsValid = (): Draft => ({
  ...valid(),
  needs: {
    'fieldnote.metrics': {
      windowDays: 30,
      minMergedPullRequests: 10,
      insufficientReason: 'Not enough merged work to judge.',
    },
  },
  checks: [
    {
      id: 'a',
      title: 'A',
      points: 60,
      explain: { pass: 'Clean.', fail: 'Not clean.' },
      primitive: 'metric-threshold',
      args: { metric: 'first-pass-rate', atLeastPercent: 60 },
    },
    {
      id: 'b',
      title: 'B',
      points: 40,
      explain: { pass: 'Green.', fail: 'Red.' },
      primitive: 'metric-threshold',
      args: { metric: 'ci-success-rate', atLeastPercent: 90 },
    },
  ],
});

test('a metrics manifest parses and keeps its window', () => {
  const manifest = parseManifest(metricsValid());
  expect(manifest.needs['fieldnote.metrics']).toMatchObject({
    windowDays: 30,
    minMergedPullRequests: 10,
  });
  expect(manifest.checks[0].primitive).toBe('metric-threshold');
});

test('a manifest declaring no evidence family at all is rejected', () => {
  rejects((m) => void (m.needs = {}), 'needs_empty');
});

test('a metric check without fieldnote.metrics is rejected', () => {
  const manifest = metricsValid();
  (manifest as Draft).needs = { 'repo.files': ['README.md'] };
  try {
    parseManifest(manifest);
  } catch (error) {
    expect((error as ManifestError).code).toBe('needs_mismatch');
    return;
  }
  throw new Error('expected needs_mismatch');
});

test('a file check without repo.files is rejected', () => {
  rejects(
    (m) =>
      void (m.needs = {
        'fieldnote.metrics': {
          windowDays: 30,
          minMergedPullRequests: 10,
          insufficientReason: 'Not enough.',
        },
      }),
    'needs_mismatch',
  );
});

test('a family no check uses is rejected — it would ask for evidence nobody reads', () => {
  rejects(
    (m) =>
      void (m.needs['fieldnote.metrics'] = {
        windowDays: 30,
        minMergedPullRequests: 10,
        insufficientReason: 'Not enough.',
      }),
    'needs_mismatch',
  );
});

test('a window that is not one of the product presets is a schema error', () => {
  const manifest = metricsValid();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (manifest as any).needs['fieldnote.metrics'].windowDays = 45;
  try {
    parseManifest(manifest);
  } catch (error) {
    expect((error as ManifestError).code).toBe('schema');
    return;
  }
  throw new Error('expected schema');
});

test('a bar outside 0-100 and a missing card title are schema errors', () => {
  rejects((m) => void delete m.card.title, 'schema');
  const manifest = metricsValid();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (manifest as any).checks[0].args.atLeastPercent = 101;
  try {
    parseManifest(manifest);
  } catch (error) {
    expect((error as ManifestError).code).toBe('schema');
    return;
  }
  throw new Error('expected schema');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/domain/grading/manifest.test.ts`
Expected: FAIL. The `needs_empty` / `needs_mismatch` tests throw `expected …`; the metrics manifest test fails with a Zod `schema` error on `needs`.

- [ ] **Step 3: Implement the schema and the invariants**

In `src/domain/grading/manifest.ts`:

```ts
// Closed for the same reason GRADER_CATEGORIES is closed, and extracted
// rather than invented: all three are read off MetricTotals today and
// rendered on the Delivery tab.
export const GRADER_METRICS = ['first-pass-rate', 'ci-success-rate', 'ci-recovery-rate'] as const;
export type GraderMetric = (typeof GRADER_METRICS)[number];
```

Add to `ManifestErrorCode`: `| 'needs_empty' | 'needs_mismatch'`.

Add a fourth member to `checkSchema`:

```ts
  z.object({
    ...checkBase,
    primitive: z.literal('metric-threshold'),
    args: z.object({
      metric: z.enum(GRADER_METRICS),
      atLeastPercent: z.number().int().min(0).max(100),
    }),
  }),
```

Replace the `needs` field of `manifestSchema`:

```ts
  // A grader declares the families it reads. Every family is optional and the
  // invariants below require the declared set to be exactly the set its checks
  // need: an undeclared family cannot be collected, and a declared one nobody
  // reads would ask an installer for access to evidence that is never used.
  needs: z.object({
    'repo.files': z.array(nonEmpty).min(1).optional(),
    'fieldnote.metrics': z
      .object({
        // The product's own presets, and only those: resolveRange() accepts
        // no others, so a manifest cannot name a window nothing can build.
        windowDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
        minMergedPullRequests: z.number().int().nonnegative(),
        insufficientReason: nonEmpty,
      })
      .optional(),
  }),
```

Add `title: nonEmpty,` as the first field of the `card` object, above `tagline`.

Add this block to `parseManifest`, after the `ungrouped` check and before `return manifest`:

```ts
  const declared = Object.entries(manifest.needs)
    .filter(([, value]) => value !== undefined)
    .map(([family]) => family);
  if (declared.length === 0)
    throw new ManifestError('needs_empty', 'A grader must declare at least one evidence family.');

  const required = new Set(
    manifest.checks.map((check) =>
      check.primitive === 'metric-threshold' ? 'fieldnote.metrics' : 'repo.files',
    ),
  );
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
```

In `src/domain/grading/graders/agent-readiness.ts`, add `title: 'Agent Readiness',` as the first field of `card`, above `tagline`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/domain/grading/manifest.test.ts src/domain/grading/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the acceptance test is untouched and still passes**

Run: `git diff main -- src/domain/grading/readiness-v01.test.ts`
Expected: no output.
Run: `pnpm vitest run src/domain/grading/readiness-v01.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/grading/manifest.ts src/domain/grading/manifest.test.ts src/domain/grading/graders/agent-readiness.ts
git commit -m "feat(grading): a manifest declares the evidence families it reads

needs becomes a set of optional families, and the declared set must be
exactly the set the checks require. An undeclared family cannot be
collected; a declared one nobody reads would ask an installer for access
to evidence that is never used.

Adds the metric-threshold primitive to the schema and card.title, both
earned by the delivery-health grader that follows.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The `metric-threshold` primitive and the measurement sentence

**Files:**
- Modify: `src/domain/grading/types.ts`
- Modify: `src/domain/grading/primitives.ts`
- Test: `src/domain/grading/primitives.test.ts`

**Interfaces:**
- Consumes: `GraderMetric`, the `metric-threshold` check shape (Task 1).
- Produces:
  - `type MetricReading = { value: number | null; numerator: number; denominator: number }`
  - `type MetricsWindow = { days: number; start: string; endExclusive: string; mergedPullRequests: number; 'first-pass-rate': MetricReading; 'ci-success-rate': MetricReading; 'ci-recovery-rate': MetricReading }`
  - `type CheckEvidence = { documents: SourceDocument[]; metrics?: MetricsWindow | null }`
  - `runCheck(check: GraderCheck, evidence: CheckEvidence, disclaimer: string): CheckResult` — **the second parameter changes from `SourceDocument[]` to `CheckEvidence`.**

- [ ] **Step 1: Write the failing tests**

First, update the eight existing `runCheck(x, documents, DISCLAIMER)` call sites in `src/domain/grading/primitives.test.ts` to `runCheck(x, { documents }, DISCLAIMER)`. Where the call passes an inline array, wrap it: `runCheck(fileExists(args), { documents: [doc('AGENTS.md', ' \n\t')] }, DISCLAIMER)`.

Then append:

```ts
import type { MetricsWindow } from './types';

const reading = (numerator: number, denominator: number) => ({
  numerator,
  denominator,
  value: denominator ? (100 * numerator) / denominator : null,
});

const metricsWindow = (over: Partial<MetricsWindow> = {}): MetricsWindow => ({
  days: 30,
  start: '2026-08-15T00:00:00.000Z',
  endExclusive: '2026-09-14T00:00:00.000Z',
  mergedPullRequests: 53,
  'first-pass-rate': reading(36, 53),
  'ci-success-rate': reading(95, 100),
  'ci-recovery-rate': reading(1, 4),
  ...over,
});

const metric = (args: Record<string, unknown>) => check({ primitive: 'metric-threshold', args });

test('metric-threshold passes at the bar and prints the measurement', () => {
  const result = runCheck(
    metric({ metric: 'first-pass-rate', atLeastPercent: 60 }),
    { documents: [], metrics: metricsWindow() },
    DISCLAIMER,
  );
  expect(result).toMatchObject({ status: 'pass', points: 100, paths: [], lineRanges: [] });
  expect(result.explanation).toBe(
    `Found it. Measured 68% (36 of 53) over the 30 days ending 2026-09-13, against a 60% bar. ${DISCLAIMER}`,
  );
});

test('metric-threshold compares the rounded value, so the printed number decided it', () => {
  // 59.6% rounds to 60 and must pass, because 60% is what a reader sees.
  const metrics = metricsWindow({ 'first-pass-rate': reading(149, 250) });
  const result = runCheck(
    metric({ metric: 'first-pass-rate', atLeastPercent: 60 }),
    { documents: [], metrics },
    DISCLAIMER,
  );
  expect(result.status).toBe('pass');
  expect(result.explanation).toContain('Measured 60% (149 of 250)');
});

test('metric-threshold fails below the bar and still prints the measurement', () => {
  const result = runCheck(
    metric({ metric: 'ci-recovery-rate', atLeastPercent: 50 }),
    { documents: [], metrics: metricsWindow() },
    DISCLAIMER,
  );
  expect(result).toMatchObject({ status: 'fail', points: 0 });
  expect(result.explanation).toBe(
    `Missing. Measured 25% (1 of 4) over the 30 days ending 2026-09-13, against a 50% bar. ${DISCLAIMER}`,
  );
});

test('a metric with no denominator fails rather than passing by vacuum', () => {
  const metrics = metricsWindow({ 'ci-success-rate': reading(0, 0) });
  const result = runCheck(
    metric({ metric: 'ci-success-rate', atLeastPercent: 90 }),
    { documents: [], metrics },
    DISCLAIMER,
  );
  expect(result.status).toBe('fail');
  expect(result.explanation).toBe(
    `Missing. Nothing measurable in the 30 days ending 2026-09-13. ${DISCLAIMER}`,
  );
});

test('a metric check with no window at all is a bug, not a repository state', () => {
  expect(() =>
    runCheck(
      metric({ metric: 'first-pass-rate', atLeastPercent: 60 }),
      { documents: [] },
      DISCLAIMER,
    ),
  ).toThrow(/metric evidence/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/domain/grading/primitives.test.ts`
Expected: FAIL — TypeScript rejects `{ documents }` as the second argument, and the metric tests have no branch to reach.

- [ ] **Step 3: Implement the types and the primitive**

In `src/domain/grading/types.ts`, append:

```ts
export type MetricReading = {
  /** Percentage on a 0–100 scale, unrounded. Null when nothing was measurable. */
  value: number | null;
  numerator: number;
  denominator: number;
};

export type MetricsWindow = {
  days: number;
  start: string;
  endExclusive: string;
  mergedPullRequests: number;
  // Keyed by the primitive's own metric names, so runCheck is a lookup rather
  // than a switch and a new metric is a change in one place.
  'first-pass-rate': MetricReading;
  'ci-success-rate': MetricReading;
  'ci-recovery-rate': MetricReading;
};

/** What a primitive is allowed to see: the evidence, never the manifest. */
export type CheckEvidence = {
  documents: SourceDocument[];
  metrics?: MetricsWindow | null;
};
```

In `src/domain/grading/primitives.ts`:

```ts
import { UTC_DAY_MS } from '../dashboard/range';
import type { CheckEvidence, CheckResult, EvidenceLineRange, SourceDocument } from './types';
```

Change the signature and the first line of the body:

```ts
export function runCheck(
  check: GraderCheck,
  evidence: CheckEvidence,
  disclaimer: string,
): CheckResult {
  const documents = evidence.documents;
```

Then insert this branch immediately after that line, before the `file-exists` branch:

```ts
  if (check.primitive === 'metric-threshold') {
    const { metric, atLeastPercent } = check.args;
    const window = evidence.metrics;
    // A manifest that reaches here declared fieldnote.metrics — parseManifest
    // refuses otherwise — and the dispatcher collects what a manifest declared.
    // A missing window is a wiring bug, not a state a repository can be in.
    if (!window) throw new Error('Metric evidence is missing for a metric-threshold check');
    const reading = window[metric];
    // endExclusive is midnight after the last counted day; a reader wants the
    // last day that counted.
    const ending = new Date(Date.parse(window.endExclusive) - UTC_DAY_MS)
      .toISOString()
      .slice(0, 10);
    // The rounded value is compared and the rounded value is printed, so the
    // number a reader sees is the number that decided the check.
    const rounded = reading.value === null ? null : Math.round(reading.value);
    const passed = rounded !== null && rounded >= atLeastPercent;
    const measured =
      rounded === null
        ? `Nothing measurable in the ${window.days} days ending ${ending}.`
        : `Measured ${rounded}% (${reading.numerator} of ${reading.denominator}) over the ${window.days} days ending ${ending}, against a ${atLeastPercent}% bar.`;
    return {
      id: check.id,
      points: passed ? check.points : 0,
      maxPoints: check.points,
      status: passed ? 'pass' : 'fail',
      // A metric check has nothing to point at. Its evidence is the number,
      // which is why the measurement is in the explanation rather than absent.
      paths: [],
      lineRanges: [],
      explanation: `${passed ? check.explain.pass : check.explain.fail} ${measured} ${disclaimer}`,
    };
  }
```

Extend the comment block at the top of the file so the extraction rule still reads true:

```ts
// `metric-threshold` is the fourth, extracted the same way: all three metrics
// it can read are computed today by aggregatePeriod() and rendered on the
// Delivery tab. fieldnote/delivery-health earned it.
```

**Keep the tree green.** `declarative.ts` is the only caller of `runCheck`, and
Task 3 is the task that rewrites it. Until then this commit would leave the
build failing typecheck and the acceptance suite failing, so update that one
line here:

```ts
  const checks = manifest.checks.map((check) =>
    runCheck(check, { documents: ordered(snapshot.documents) }, manifest.disclaimer),
  );
```

Task 3 replaces it properly. Every commit stands on its own, and the acceptance
test is checked per task rather than only at the end.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/domain/grading/primitives.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Confirm the acceptance test still passes and never moved**

Run: `pnpm vitest run src/domain/grading/readiness-v01.test.ts && pnpm typecheck`
Expected: PASS, and no output from `git diff main -- src/domain/grading/readiness-v01.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/domain/grading/types.ts src/domain/grading/primitives.ts src/domain/grading/primitives.test.ts src/domain/grading/declarative.ts
git commit -m "feat(grading): a check can read a number, and shows its working

runCheck takes CheckEvidence rather than a document array, because a
grader may now read a window of metrics as well as files. The file
primitives are unchanged; a fourth reads a rate against a bar.

A file check proves itself by naming lines. A metric check has nothing
to point at, so its evidence is the number, and the measurement is
composed into the explanation between the grader's prose and the
grader's disclaimer. The rounded value is compared and the rounded value
is printed: 59.6% shown as 60% beside the word Missing is not an
argument anyone can inspect.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `runDeclarative` carries the window and the grader's own reason

**Files:**
- Modify: `src/domain/grading/declarative.ts`
- Modify: `src/domain/grading/types.ts`
- Create: `src/domain/grading/declarative.test.ts`

**Interfaces:**
- Consumes: `CheckEvidence`, `MetricsWindow`, `runCheck` (Task 2).
- Produces:
  - `RepositorySnapshot` gains `metrics?: MetricsWindow | null` and `incompleteReason?: string`
  - `GradeResult` gains `window?: { start: string; endExclusive: string; days: number }`
  - `export const INCOMPLETE` from `declarative.ts` — fieldnote's sentence for collection failing, reused by the collector in Task 5.

- [ ] **Step 1: Write the failing test**

Create `src/domain/grading/declarative.test.ts`:

```ts
import { expect, test } from 'vitest';
import { INCOMPLETE, runDeclarative } from './declarative';
import { parseManifest } from './manifest';
import type { MetricsWindow, RepositorySnapshot } from './types';

const metricsManifest = parseManifest({
  id: 'fieldnote/example-metrics',
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'delivery-health',
  kind: 'declarative',
  needs: {
    'fieldnote.metrics': {
      windowDays: 30,
      minMergedPullRequests: 10,
      insufficientReason: 'Not enough merged work to judge.',
    },
  },
  disclaimer: 'A delivery record.',
  card: {
    title: 'Example Metrics',
    tagline: 'Does work reach green cleanly?',
    groups: [{ title: 'CI', checks: ['green'] }],
  },
  checks: [
    {
      id: 'green',
      title: 'CI ends green',
      points: 100,
      explain: { pass: 'Green.', fail: 'Red.' },
      primitive: 'metric-threshold',
      args: { metric: 'ci-success-rate', atLeastPercent: 90 },
    },
  ],
});

const metrics: MetricsWindow = {
  days: 30,
  start: '2026-08-15T00:00:00.000Z',
  endExclusive: '2026-09-14T00:00:00.000Z',
  mergedPullRequests: 53,
  'first-pass-rate': { numerator: 36, denominator: 53, value: (100 * 36) / 53 },
  'ci-success-rate': { numerator: 95, denominator: 100, value: 95 },
  'ci-recovery-rate': { numerator: 1, denominator: 4, value: 25 },
};

const snapshot = (over: Partial<RepositorySnapshot> = {}): RepositorySnapshot => ({
  sha: 'commit-sha',
  complete: true,
  documents: [],
  metrics,
  ...over,
});

test('a metrics grader scores and records the window it scored', () => {
  const result = runDeclarative(metricsManifest, snapshot());
  expect(result.score).toBe(100);
  expect(result.window).toEqual({
    start: '2026-08-15T00:00:00.000Z',
    endExclusive: '2026-09-14T00:00:00.000Z',
    days: 30,
  });
});

test('an incomplete window is still recorded — the dates are not in doubt', () => {
  const result = runDeclarative(metricsManifest, snapshot({ complete: false }));
  expect(result.score).toBeNull();
  expect(result.window).toEqual({
    start: '2026-08-15T00:00:00.000Z',
    endExclusive: '2026-09-14T00:00:00.000Z',
    days: 30,
  });
});

test('a file-only snapshot records no window at all', () => {
  const result = runDeclarative(metricsManifest, snapshot({ metrics: null, complete: false }));
  expect(result.window).toBeUndefined();
});

test("the snapshot's own reason wins, because it belongs to the grader", () => {
  const result = runDeclarative(
    metricsManifest,
    snapshot({ complete: false, incompleteReason: 'Not enough merged work to judge.' }),
  );
  expect(result.incompleteReason).toBe('Not enough merged work to judge.');
});

test("collection failing is fieldnote's sentence, and it is the fallback", () => {
  const result = runDeclarative(metricsManifest, snapshot({ complete: false }));
  expect(result.incompleteReason).toBe(INCOMPLETE);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/domain/grading/declarative.test.ts`
Expected: FAIL — `INCOMPLETE` is not exported and `result.window` is undefined.

- [ ] **Step 3: Implement**

In `src/domain/grading/types.ts`, extend the two existing types:

```ts
export type RepositorySnapshot = {
  sha: string;
  complete: boolean;
  documents: SourceDocument[];
  metrics?: MetricsWindow | null;
  /** The grader's own sentence when its declared floor was not met. */
  incompleteReason?: string;
};

export type GradeResult = {
  score: number | null;
  checks: CheckResult[];
  rubricVersion: string;
  evaluatorVersion: string;
  /** Present only for a grader that read a window. A saved report names the
   * dates it scored, so reopening it does not silently mean a different month. */
  window?: { start: string; endExclusive: string; days: number };
  incompleteReason?: string;
};
```

In `src/domain/grading/declarative.ts`, export the constant and rewrite the body:

```ts
export const INCOMPLETE = 'Repository evidence collection was incomplete.';

export function runDeclarative(
  manifest: GraderManifest,
  snapshot: RepositorySnapshot,
): GradeResult {
  const evidence: CheckEvidence = {
    documents: ordered(snapshot.documents),
    metrics: snapshot.metrics ?? null,
  };
  const checks = manifest.checks.map((check) => runCheck(check, evidence, manifest.disclaimer));
  const metrics = snapshot.metrics;
  return {
    score: snapshot.complete ? checks.reduce((sum, check) => sum + check.points, 0) : null,
    checks,
    rubricVersion: manifest.version,
    evaluatorVersion: manifest.evaluatorVersion,
    ...(metrics
      ? { window: { start: metrics.start, endExclusive: metrics.endExclusive, days: metrics.days } }
      : {}),
    // There are two reasons a run has no score and they belong to different
    // authors. "Not enough merged work to judge" is the grader's, and arrives
    // on the snapshot. Collection failing is fieldnote's, and no manifest is
    // in a position to explain it.
    ...(snapshot.complete ? {} : { incompleteReason: snapshot.incompleteReason ?? INCOMPLETE }),
  };
}
```

Import `CheckEvidence` in the type import at the top of the file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/domain/grading/declarative.test.ts src/domain/grading/readiness-v01.test.ts`
Expected: PASS. The readiness suite proves a file-only grader emits no `window` and keeps fieldnote's sentence.

- [ ] **Step 5: Verify the acceptance test is still byte-identical**

Run: `git diff main -- src/domain/grading/readiness-v01.test.ts`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/domain/grading/declarative.ts src/domain/grading/declarative.test.ts src/domain/grading/types.ts
git commit -m "feat(grading): a report names the window it scored

A grader that reads a window emits it on the result, so a saved report
says which dates produced its number. grade_runs.result is already
jsonb, so nothing migrates.

Splits the two reasons a run has no score by author. The grader's floor
is the grader's sentence and arrives on the snapshot; collection failing
stays fieldnote's, which is the fallback. runDeclarative still knows
nothing about which grader it is running.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The `fieldnote/delivery-health` grader

**Files:**
- Create: `src/domain/grading/graders/delivery-health.ts`
- Create: `src/domain/grading/graders/delivery-health.test.ts`
- Create: `src/domain/grading/graders/index.ts`
- Modify: `src/domain/grading/registry.ts`

**Interfaces:**
- Consumes: `registerGrader` (existing), the manifest schema (Task 1), `runDeclarative` (Task 3).
- Produces:
  - `DELIVERY_HEALTH = 'fieldnote/delivery-health'`
  - `deliveryHealthManifest: GraderManifest`
  - `listGraders(): GraderManifest[]` on the registry, in registration order
  - `src/domain/grading/graders/index.ts` — importing it registers every built-in

- [ ] **Step 1: Write the failing test**

Create `src/domain/grading/graders/delivery-health.test.ts`:

```ts
// The barrel comes first on purpose. Registration is a side effect of
// importing a grader, ES modules evaluate imports in source order, and the
// order assertion below is about the barrel's declared order — not about
// which import this test file happens to list first.
import { AGENT_READINESS, DELIVERY_HEALTH, deliveryHealthManifest } from './index';
import { expect, test } from 'vitest';
import { runDeclarative } from '../declarative';
import { getGrader, listGraders } from '../registry';
import type { MetricsWindow, RepositorySnapshot } from '../types';

const metricsWindow = (over: Partial<MetricsWindow> = {}): MetricsWindow => ({
  days: 30,
  start: '2026-08-15T00:00:00.000Z',
  endExclusive: '2026-09-14T00:00:00.000Z',
  mergedPullRequests: 53,
  'first-pass-rate': { numerator: 36, denominator: 53, value: (100 * 36) / 53 },
  'ci-success-rate': { numerator: 95, denominator: 100, value: 95 },
  'ci-recovery-rate': { numerator: 1, denominator: 4, value: 25 },
  ...over,
});

const snapshot = (metrics: MetricsWindow): RepositorySnapshot => ({
  sha: 'commit-sha',
  complete: true,
  documents: [],
  metrics,
});

test('the grader registers and is an ordinary one', () => {
  expect(getGrader(DELIVERY_HEALTH)).toBe(deliveryHealthManifest);
  expect(deliveryHealthManifest.checks.reduce((sum, c) => sum + c.points, 0)).toBe(100);
  expect(deliveryHealthManifest.mode).toBe('deterministic');
  expect(deliveryHealthManifest.category).toBe('delivery-health');
});

test('both built-ins are listed, readiness first', () => {
  // The row on the Grades tab renders in this order, so it is a product
  // decision worth pinning rather than an accident of the module graph.
  expect(listGraders().map((grader) => grader.id)).toEqual([AGENT_READINESS, DELIVERY_HEALTH]);
});

test('a repository that merges cleanly and recovers scores 100', () => {
  const result = runDeclarative(
    deliveryHealthManifest,
    snapshot(
      metricsWindow({
        'first-pass-rate': { numerator: 45, denominator: 53, value: (100 * 45) / 53 },
        'ci-recovery-rate': { numerator: 3, denominator: 4, value: 75 },
      }),
    ),
  );
  expect(result.score).toBe(100);
});

test('a repository that merges by attrition scores only CI', () => {
  const result = runDeclarative(deliveryHealthManifest, snapshot(metricsWindow()));
  // first-pass 68% >= 60 passes (40), ci-success 95% >= 90 passes (30),
  // ci-recovery 25% < 50 fails (0).
  expect(result.score).toBe(70);
  expect(result.checks.find((check) => check.id === 'failures-get-fixed')?.status).toBe('fail');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/domain/grading/graders/delivery-health.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the grader, the barrel and `listGraders()`**

Create `src/domain/grading/graders/delivery-health.ts`:

```ts
import { registerGrader } from '../registry';

export const DELIVERY_HEALTH = 'fieldnote/delivery-health';

// The second built-in, and the first consumer of fieldnote.metrics — the scope
// family no competing tool can offer, which is why it was chosen over another
// file-reading grader. It is an ordinary grader: it gets no private interface,
// no extra evidence and no code path of its own.
//
// The thresholds are this grader's judgement and nothing else's. Changing one
// is a version bump, because a repository's score would move underneath it.
export const deliveryHealthManifest = registerGrader({
  id: DELIVERY_HEALTH,
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'delivery-health',
  kind: 'declarative',
  needs: {
    'fieldnote.metrics': {
      windowDays: 30,
      // Below this there is no delivery record to read, and a quiet month is
      // not a delivery failure. The run reports no score rather than a bad one.
      minMergedPullRequests: 10,
      insufficientReason:
        'Fewer than ten pull requests merged in this window — not enough delivery record to judge.',
    },
  },
  disclaimer: 'This is a record of how work reached green, not a judgement of the code.',
  card: {
    title: 'Delivery Health',
    tagline: 'Does work here reach green cleanly, or by attrition?',
    groups: [
      { title: 'Merging', checks: ['merges-land-clean'] },
      { title: 'Continuous integration', checks: ['ci-ends-green', 'failures-get-fixed'] },
    ],
  },
  checks: [
    {
      id: 'merges-land-clean',
      title: 'Merges land clean',
      points: 40,
      explain: {
        pass: 'Most merged pull requests passed review and CI on the first attempt.',
        fail: 'Too few merged pull requests passed review and CI on the first attempt.',
      },
      primitive: 'metric-threshold',
      args: { metric: 'first-pass-rate', atLeastPercent: 60 },
    },
    {
      id: 'ci-ends-green',
      title: 'CI ends green',
      points: 30,
      explain: {
        pass: 'CI runs finished successfully.',
        fail: 'Too many CI runs ended red.',
      },
      primitive: 'metric-threshold',
      args: { metric: 'ci-success-rate', atLeastPercent: 90 },
    },
    {
      id: 'failures-get-fixed',
      title: 'Failures get fixed',
      points: 30,
      explain: {
        pass: 'Most CI failures were brought back to green.',
        fail: 'Too many CI failures were left red.',
      },
      primitive: 'metric-threshold',
      args: { metric: 'ci-recovery-rate', atLeastPercent: 50 },
    },
  ],
});
```

Create `src/domain/grading/graders/index.ts`:

```ts
// Importing this module registers every built-in. Registration is a side
// effect of importing a grader, so anything that calls listGraders() must
// import this barrel first or the row is short a card.
export { AGENT_READINESS, agentReadinessManifest } from './agent-readiness';
export { DELIVERY_HEALTH, deliveryHealthManifest } from './delivery-health';
```

Append to `src/domain/grading/registry.ts`:

```ts
/** Every registered grader, in registration order. Import graders/index first. */
export function listGraders(): GraderManifest[] {
  return [...graders.values()];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/domain/grading/graders/delivery-health.test.ts`
Expected: PASS.

Note: `listGraders()` reads a module-level map. If the ordering test is run in a file that has also registered a fixture grader, the assertion will see it. Keep the ordering assertion in this file only.

- [ ] **Step 5: Commit**

```bash
git add src/domain/grading/graders/delivery-health.ts src/domain/grading/graders/delivery-health.test.ts src/domain/grading/graders/index.ts src/domain/grading/registry.ts
git commit -m "feat(grading): a second built-in, and it reads a delivery record

fieldnote/delivery-health is the contract's second consumer and the
first reader of fieldnote.metrics — the scope family nobody else can
offer, which is why it was chosen over another file-reading grader.

Three checks at 40/30/30 over a fixed thirty days. Below ten merged
pull requests it reports no score rather than a bad one: a quiet month
is not a delivery failure.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The metrics collector

**Files:**
- Create: `src/db/queries/grade-metrics.ts`
- Create: `src/db/queries/grade-metrics.integration.test.ts`

**Interfaces:**
- Consumes: `MetricsWindow`, `MetricReading` (Task 2), `INCOMPLETE` (Task 3), `GraderManifest['needs']` (Task 1), the existing `loadBasicDashboard()` and `resolveRange()`.
- Produces:
  - `type MetricsNeed = NonNullable<GraderManifest['needs']['fieldnote.metrics']>`
  - `type MetricsCollection = { metrics: MetricsWindow; complete: boolean; incompleteReason?: string }`
  - `collectMetrics(repositoryId: string, need: MetricsNeed, now?: Date): Promise<MetricsCollection>`

- [ ] **Step 1: Write the failing test**

Create `src/db/queries/grade-metrics.integration.test.ts`.

Read `src/db/queries/basic-dashboard.integration.test.ts` first and reuse its
arrangement wholesale: it already seeds a workspace, an installation, a tracked
repository, merged pull requests, review events and workflow attempts, and it is
the only place in the repo that knows how to make `coverage` come out
`'complete'` versus `'partial'`. Duplicating that setup by hand is how the two
suites end up disagreeing about what a complete window is.

Seed two repositories: `repositoryId`, whose evidence is complete, and
`partialRepositoryId`, arranged the way that suite arranges a partial one. Then
assert:

```ts
const need = {
  windowDays: 30 as const,
  minMergedPullRequests: 10,
  insufficientReason: 'Not enough merged work to judge.',
};

test('readings come from the totals, and the window names its dates', async () => {
  const collected = await collectMetrics(repositoryId, need, new Date('2026-09-13T12:00:00Z'));
  expect(collected.metrics.days).toBe(30);
  expect(collected.metrics.endExclusive).toBe('2026-09-14T00:00:00.000Z');
  expect(collected.metrics['first-pass-rate']).toMatchObject({ numerator: 1, denominator: 2 });
});

test('the recovery rate counts only runs that went red', async () => {
  // Seeded: 8 first-pass runs, 1 recovered, 1 failed.
  // MetricTotals.ciRecovered would be 1/10 = 10%; the check asks 1/2 = 50%.
  const collected = await collectMetrics(repositoryId, need, new Date('2026-09-13T12:00:00Z'));
  expect(collected.metrics['ci-recovery-rate']).toMatchObject({ numerator: 1, denominator: 2 });
  expect(collected.metrics['ci-recovery-rate'].value).toBe(50);
});

test("too little merged work is incomplete, in the grader's own words", async () => {
  const collected = await collectMetrics(
    repositoryId,
    { ...need, minMergedPullRequests: 1000 },
    new Date('2026-09-13T12:00:00Z'),
  );
  expect(collected.complete).toBe(false);
  expect(collected.incompleteReason).toBe('Not enough merged work to judge.');
  // The window is still returned: the numbers exist, they are just not enough.
  expect(collected.metrics.mergedPullRequests).toBeGreaterThanOrEqual(0);
});

test("partial coverage is incomplete in fieldnote's words, not the grader's", async () => {
  // A second repository, seeded with the same pull requests but with its
  // import left unfinished, so aggregatePeriod reports coverage 'partial'.
  // basic-dashboard.integration.test.ts sets this up by leaving
  // repositories.trackingStartedAt in place while omitting the import record
  // its coverage reasons look for; copy that arrangement rather than inventing
  // one, so the two suites cannot disagree about what partial means.
  const collected = await collectMetrics(
    partialRepositoryId,
    need,
    new Date('2026-09-13T12:00:00Z'),
  );
  expect(collected.complete).toBe(false);
  expect(collected.incompleteReason).toBe(INCOMPLETE);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `DEMO_MODE=false pnpm test:integration -- src/db/queries/grade-metrics.integration.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

Create `src/db/queries/grade-metrics.ts`:

```ts
import { loadBasicDashboard } from './basic-dashboard';
import { resolveRange } from '../../domain/dashboard/range';
import { INCOMPLETE } from '../../domain/grading/declarative';
import type { GraderManifest } from '../../domain/grading/manifest';
import type { MetricReading, MetricsWindow } from '../../domain/grading/types';

export type MetricsNeed = NonNullable<GraderManifest['needs']['fieldnote.metrics']>;

export type MetricsCollection = {
  metrics: MetricsWindow;
  complete: boolean;
  incompleteReason?: string;
};

const reading = (numerator: number, denominator: number): MetricReading => ({
  numerator,
  denominator,
  value: denominator ? (100 * numerator) / denominator : null,
});

/**
 * fieldnote.metrics, collected for one repository over one window.
 *
 * Trusted worker primitive. loadBasicDashboard() documents that its repository
 * ids must come from accessibleRepositories() or requireTrackedRepository() for
 * the current request; a grade run has no session and is authorized instead by
 * validateGradeRun(), which re-checks installation, workspace link, membership
 * and demo mode before collection and again before completion — the same route
 * collectReadiness() already relies on. visiblePrIds() is a flat per-repository
 * history cap with no session component, so the Free limit applies identically.
 */
export async function collectMetrics(
  repositoryId: string,
  need: MetricsNeed,
  now = new Date(),
): Promise<MetricsCollection> {
  const range = resolveRange({ days: need.windowDays }, now);
  const data = await loadBasicDashboard([repositoryId], range);
  const { merged, firstPass, ciSuccess, ci } = data.totals;
  const metrics: MetricsWindow = {
    days: range.days,
    start: range.start,
    endExclusive: range.endExclusive,
    mergedPullRequests: merged,
    'first-pass-rate': reading(firstPass.numerator, firstPass.denominator),
    'ci-success-rate': reading(ciSuccess.numerator, ciSuccess.denominator),
    // Deliberately not MetricTotals.ciRecovered. That is recovered over every
    // completed run, which falls as a repository gets healthier and would score
    // a green repository badly. The check asks how many red runs came back, so
    // the denominator is only the red ones.
    'ci-recovery-rate': reading(ci.recovered, ci.recovered + ci.failed),
  };
  // Partial coverage is fieldnote's failure to collect, and fieldnote's
  // sentence. Too little merged work is the grader's floor, and the grader's.
  if (data.coverage !== 'complete')
    return { metrics, complete: false, incompleteReason: INCOMPLETE };
  if (merged < need.minMergedPullRequests)
    return { metrics, complete: false, incompleteReason: need.insufficientReason };
  return { metrics, complete: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `DEMO_MODE=false pnpm test:integration -- src/db/queries/grade-metrics.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/queries/grade-metrics.ts src/db/queries/grade-metrics.integration.test.ts
git commit -m "feat(grading): collect a window of delivery evidence

collectMetrics turns MetricTotals into a MetricsWindow over one of the
product's own presets. Nothing new is measured.

One ratio is taken over a narrower denominator and the reason is written
down at the call site: MetricTotals.ciRecovered is recovered over every
completed run, which falls as a repository gets healthier. The check
asks how many red runs came back.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The evidence dispatcher, and the job that uses it

**Files:**
- Create: `src/grading/evidence.ts`
- Create: `src/grading/evidence.test.ts`
- Modify: `src/inngest/functions/grade-repository.ts`
- Modify: `src/db/queries/grade-runs.ts`

**Interfaces:**
- Consumes: `collectReadiness()` (existing), `collectMetrics()` (Task 5), `INCOMPLETE` (Task 3).
- Produces:
  - `type CollectedEvidence = { snapshot: RepositorySnapshot; incompleteCode: 'incomplete_collection' | 'insufficient_evidence' }`
  - `collectEvidence(manifest: GraderManifest, repositoryId: string, sha: string): Promise<CollectedEvidence>`
  - `failGrade()` accepts `'insufficient_evidence'`

- [ ] **Step 1: Write the failing test**

Create `src/grading/evidence.test.ts`:

```ts
import { expect, test, vi, beforeEach } from 'vitest';

const collectReadiness = vi.fn();
const collectMetrics = vi.fn();
vi.mock('../github/collect-readiness', () => ({ collectReadiness }));
vi.mock('../db/queries/grade-metrics', () => ({ collectMetrics }));

const { collectEvidence } = await import('./evidence');
const { agentReadinessManifest } = await import('../domain/grading/graders/agent-readiness');
const { deliveryHealthManifest } = await import('../domain/grading/graders/delivery-health');
const { INCOMPLETE } = await import('../domain/grading/declarative');

const metrics = {
  days: 30,
  start: '2026-08-15T00:00:00.000Z',
  endExclusive: '2026-09-14T00:00:00.000Z',
  mergedPullRequests: 53,
  'first-pass-rate': { numerator: 36, denominator: 53, value: (100 * 36) / 53 },
  'ci-success-rate': { numerator: 95, denominator: 100, value: 95 },
  'ci-recovery-rate': { numerator: 1, denominator: 4, value: 25 },
};

beforeEach(() => {
  collectReadiness.mockReset();
  collectMetrics.mockReset();
});

test('a file grader calls only the file collector', async () => {
  collectReadiness.mockResolvedValue({ sha: 'abc', complete: true, documents: [] });
  const { snapshot } = await collectEvidence(agentReadinessManifest, 'repo', 'abc');
  expect(collectReadiness).toHaveBeenCalledWith('repo', 'abc');
  expect(collectMetrics).not.toHaveBeenCalled();
  expect(snapshot.metrics).toBeNull();
});

test('a metrics grader calls only the metrics collector', async () => {
  collectMetrics.mockResolvedValue({ metrics, complete: true });
  const { snapshot } = await collectEvidence(deliveryHealthManifest, 'repo', 'abc');
  expect(collectReadiness).not.toHaveBeenCalled();
  expect(collectMetrics).toHaveBeenCalledWith('repo', deliveryHealthManifest.needs['fieldnote.metrics']);
  expect(snapshot).toMatchObject({ sha: 'abc', complete: true, documents: [], metrics });
});

test("the grader's floor is reported as insufficient evidence, not a collection failure", async () => {
  collectMetrics.mockResolvedValue({
    metrics,
    complete: false,
    incompleteReason: 'Not enough merged work to judge.',
  });
  const collected = await collectEvidence(deliveryHealthManifest, 'repo', 'abc');
  expect(collected.snapshot.complete).toBe(false);
  expect(collected.snapshot.incompleteReason).toBe('Not enough merged work to judge.');
  expect(collected.incompleteCode).toBe('insufficient_evidence');
});

test('a failed file collection is reported as a collection failure', async () => {
  collectReadiness.mockResolvedValue({ sha: 'abc', complete: false, documents: [] });
  const collected = await collectEvidence(agentReadinessManifest, 'repo', 'abc');
  expect(collected.snapshot.incompleteReason).toBe(INCOMPLETE);
  expect(collected.incompleteCode).toBe('incomplete_collection');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/grading/evidence.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the dispatcher**

Create `src/grading/evidence.ts`:

```ts
import { collectReadiness } from '../github/collect-readiness';
import { collectMetrics } from '../db/queries/grade-metrics';
import { INCOMPLETE } from '../domain/grading/declarative';
import type { GraderManifest } from '../domain/grading/manifest';
import type { RepositorySnapshot } from '../domain/grading/types';

export type CollectedEvidence = {
  snapshot: RepositorySnapshot;
  /** Which failure to record when the snapshot is incomplete. */
  incompleteCode: 'incomplete_collection' | 'insufficient_evidence';
};

/**
 * Slice 2's evidence dispatcher: two families, honoured because a manifest
 * declared them and parseManifest refuses a manifest that declares a family no
 * check reads. There is no consent prompt, no cache, no history collector and
 * no schedule — those are slice 3's, which replaces this file. The call site in
 * grade-repository.ts does not move.
 */
export async function collectEvidence(
  manifest: GraderManifest,
  repositoryId: string,
  sha: string,
): Promise<CollectedEvidence> {
  const filesNeed = manifest.needs['repo.files'];
  const metricsNeed = manifest.needs['fieldnote.metrics'];
  const files = filesNeed ? await collectReadiness(repositoryId, sha) : null;
  const metrics = metricsNeed ? await collectMetrics(repositoryId, metricsNeed) : null;
  // Collection failing outranks a grader's floor: if fieldnote could not read
  // the evidence, what the grader would have made of it is unknown.
  const filesFailed = files !== null && !files.complete;
  const metricsShort = metrics !== null && !metrics.complete;
  const complete = !filesFailed && !metricsShort;
  return {
    snapshot: {
      sha,
      complete,
      documents: files?.documents ?? [],
      metrics: metrics?.metrics ?? null,
      ...(filesFailed
        ? { incompleteReason: INCOMPLETE }
        : metricsShort
          ? { incompleteReason: metrics.incompleteReason }
          : {}),
    },
    incompleteCode: filesFailed ? 'incomplete_collection' : 'insufficient_evidence',
  };
}
```

In `src/db/queries/grade-runs.ts`, add `'insufficient_evidence'` to the `safe` array inside `failGrade`:

```ts
  const safe = [
    'collection_failed',
    'access_revoked',
    'unsupported_version',
    'incomplete_collection',
    'insufficient_evidence',
  ].includes(code)
```

In `src/inngest/functions/grade-repository.ts`, replace the import of `collectReadiness` with `collectEvidence` (keep `resolveReadinessSha` and `ReadinessCollectionError`), and replace the body of the `try` block in `evaluateGradeRun`:

```ts
  try {
    const manifest = getGrader(run.graderId);
    const { snapshot, incompleteCode } = await collectEvidence(manifest, run.repositoryId, run.sha);
    const result = runDeclarative(manifest, snapshot);
    if (result.score === null) {
      await failGrade(runId, incompleteCode);
      return;
    }
    // Recheck authorization after collection too; result contains metadata only.
    if (!(await validated(runId))) return;
    await completeGrade(runId, result);
  } catch (error) {
    return collectionFailure(runId, error);
  }
```

Delete the `repo.files` assertion and its comment.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/grading/evidence.test.ts src/inngest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/grading/evidence.ts src/grading/evidence.test.ts src/inngest/functions/grade-repository.ts src/db/queries/grade-runs.ts
git commit -m "feat(grading): fan out over the families a manifest declared

Replaces the slice 1 assertion that refused anything but repo.files with
a dispatcher over exactly two families. It is deliberately dumb: slice 3
replaces this file with the broker, and the call site does not move.

Separates the two ways a run ends without a score. Collection failing
outranks a grader's floor, because if fieldnote could not read the
evidence then what the grader would have made of it is unknown.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The identity strip

**Files:**
- Create: `src/domain/grading/mode-names.ts`
- Create: `src/domain/grading/mode-names.test.ts`
- Create: `src/domain/grading/category-names.ts`
- Modify: `packages/design-system/src/grade-card.tsx`
- Modify: `packages/design-system/src/grade-card.css`
- Modify: `src/components/grading/grade-presentation.ts`
- Test: `src/components/grading/grade-presentation.test.ts`

**Interfaces:**
- Consumes: `card.title` (Task 1), `deliveryHealthManifest` (Task 4).
- Produces:
  - `modeNames: Record<'deterministic' | 'llm' | 'hybrid', string>`
  - `categoryNames: Record<GraderCategory, string>` — a reader sees `Agent readiness`, never `agent-readiness`
  - `GradeCardProps` gains `title: string; author: string; mode: string; category: string`

- [ ] **Step 1: Write the failing tests**

Create `src/domain/grading/mode-names.test.ts`:

```ts
import { expect, test } from 'vitest';
import { modeNames } from './mode-names';
import { categoryNames } from './category-names';
import { GRADER_CATEGORIES } from './manifest';

test('every mode has a user-facing name', () => {
  expect(modeNames).toEqual({
    deterministic: 'Deterministic',
    llm: 'Model-judged',
    hybrid: 'Hybrid',
  });
});

test('every category has one too, and none is a slug', () => {
  for (const category of GRADER_CATEGORIES) {
    expect(categoryNames[category]).toBeTruthy();
    expect(categoryNames[category]).not.toContain('-');
  }
});
```

Append to `src/components/grading/grade-presentation.test.ts`:

```ts
import { DELIVERY_HEALTH, deliveryHealthManifest } from '../../domain/grading/graders/delivery-health';

test('a card carries its grader identity, not fieldnote assumptions', () => {
  const props = gradeCardProps({
    score: 70,
    repositoryName: 'acme / checkout',
    sha: 'a'.repeat(40),
    rubricVersion: deliveryHealthManifest.version,
    checks: [],
    graderId: DELIVERY_HEALTH,
  });
  expect(props).toMatchObject({
    title: 'Delivery Health',
    author: 'fieldnote',
    mode: 'Deterministic',
    category: 'Delivery health',
    flavour: 'Does work here reach green cleanly, or by attrition?',
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/domain/grading/mode-names.test.ts src/components/grading/grade-presentation.test.ts`
Expected: FAIL — `mode-names` and `category-names` do not exist, and `gradeCardProps` returns no `title`.

- [ ] **Step 3: Implement**

Create `src/domain/grading/mode-names.ts`:

```ts
import type { GraderManifest } from './manifest';

/**
 * A user-facing word for a schema value is domain knowledge, tested where it
 * lives, never spelled in a component — the same reason finish-names.ts exists.
 *
 * The mode is the honesty the grader-factory design traded the README's "no LLM
 * judges anywhere in the pipeline" claim for. It is shown wherever a grade is
 * shown, which now means every card in the row.
 */
export const modeNames: Record<GraderManifest['mode'], string> = {
  deterministic: 'Deterministic',
  llm: 'Model-judged',
  hybrid: 'Hybrid',
};
```

Create `src/domain/grading/category-names.ts`:

```ts
import type { GRADER_CATEGORIES } from './manifest';

/**
 * The browsing axis, spelled for a reader rather than for a URL. The schema
 * value is a slug because a marketplace filters on it; the card is read by a
 * person, and `agent-readiness` on a card is a leaked identifier.
 */
export const categoryNames: Record<(typeof GRADER_CATEGORIES)[number], string> = {
  'harness-integrity': 'Harness integrity',
  'delivery-health': 'Delivery health',
  'agent-readiness': 'Agent readiness',
  architecture: 'Architecture',
  'test-discipline': 'Test discipline',
  'code-quality': 'Code quality',
  documentation: 'Documentation',
  'supply-chain': 'Supply chain',
};
```

In `src/components/grading/grade-presentation.ts`, import `modeNames` and `categoryNames`, and add four fields to the returned object:

```ts
    title: grader.card.title,
    // owner/name. A marketplace has two people who both want the name
    // test-coverage, so the owner is part of the identity, not decoration.
    author: input.graderId.split('/')[0],
    mode: modeNames[grader.mode],
    category: categoryNames[grader.category],
```

In `packages/design-system/src/grade-card.tsx`, extend `GradeCardProps`:

```ts
  title: string;
  author: string;
  mode: string;
  category: string;
```

Destructure them in the component signature. Replace the hardcoded heading and the `aria-label`:

```tsx
      aria-label={`${title}: ${score} out of 100, ${label}`}
```

```tsx
        <h2>{title}</h2>
        {/* Author, version, mode and category. Four facts that were implicit
            while there was one grader and become load-bearing the moment a
            reader sees two cards side by side. */}
        <p className="grade-card-identity">
          <span>{author}</span>
          <span>v{rubricVersion}</span>
          <span>{mode}</span>
          <span>{category}</span>
        </p>
```

Replace the footer's hardcoded rubric name:

```tsx
        <div className="grade-card-rubric">
          <span>Rubric</span>
          <strong>
            {title} v{rubricVersion}
          </strong>
        </div>
```

In `packages/design-system/src/grade-card.css`, add, following the existing conventions in that file for spacing and muted colour:

```css
.grade-card-identity {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.5rem;
  margin: 0.25rem 0 0;
  font-size: 0.6875rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.72;
}
.grade-card-identity span + span::before {
  content: '·';
  margin-right: 0.5rem;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/domain/grading/mode-names.test.ts src/components/grading src/components/marketing`
Expected: PASS. The marketing suites render `GradeCard` through `sample-grades.ts`, so a missing prop surfaces here.

- [ ] **Step 5: Typecheck the workspace**

Run: `pnpm typecheck`
Expected: PASS. Every `GradeCard` call site goes through `gradeCardProps()`, so no component should need editing.

- [ ] **Step 6: Commit**

```bash
git add src/domain/grading/mode-names.ts src/domain/grading/mode-names.test.ts src/domain/grading/category-names.ts src/components/grading/grade-presentation.ts src/components/grading/grade-presentation.test.ts packages/design-system/src/grade-card.tsx packages/design-system/src/grade-card.css
git commit -m "feat(design-system): a card says whose grade it is

The card had Agent Readiness typed into its heading, its footer and its
aria-label. A card that can render two graders cannot hold one grader's
name, so the name comes from the manifest and the strip beneath it
carries author, version, mode and category.

The mode is the disclosure the design traded the no-LLM-judges claim
for. It is shown wherever a grade is shown, which now means every card
in the row.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The report belongs to its grader too

**Files:**
- Modify: `src/components/grading/report.tsx`
- Modify: `src/app/api/repos/[repoId]/grades/[runId]/route.ts`
- Test: `src/components/grading/report.test.ts`
- Test: `src/app/api/repos/[repoId]/grades/[runId]/route.test.ts`

**Interfaces:**
- Consumes: `card.title` and `disclaimer` from the manifest (Task 1), `insufficient_evidence` (Task 6).
- Produces:
  - `GradeReport` props gain `graderTitle: string` and `disclaimer: string`
  - `Status` in `report.tsx` gains `errorCode: string | null`
  - the status route returns `{ id, state, errorCode }`

- [ ] **Step 1: Write the failing tests**

`report.tsx` has three readiness strings hardcoded: `aria-label="Readiness evidence"`, `Readiness v{grade.rubricVersion}`, and the closing paragraph *"This assessment checks files and documented commands…"*, which is the readiness grader's disclaimer wearing fieldnote's voice.

Append to `src/components/grading/report.test.ts`:

```ts
import { deliveryHealthManifest } from '../../domain/grading/graders/delivery-health';

test('the report wears its grader name and its grader disclaimer', () => {
  const html = renderToStaticMarkup(
    createElement(GradeReport, {
      grade,
      owner: 'acme',
      name: 'checkout',
      outdated: false,
      checkTitles: { 'merges-land-clean': 'Merges land clean' },
      graderTitle: deliveryHealthManifest.card.title,
      disclaimer: deliveryHealthManifest.disclaimer,
    }),
  );
  expect(html).toContain('Delivery Health v0.1.0');
  expect(html).toContain(deliveryHealthManifest.disclaimer);
  expect(html).not.toContain('Readiness v');
  expect(html).not.toContain('does not execute repository code');
});

test('a metric check renders its measurement and no empty evidence block', () => {
  const metricGrade = {
    ...grade,
    checks: [
      {
        id: 'merges-land-clean',
        points: 40,
        maxPoints: 40,
        status: 'pass',
        paths: [],
        lineRanges: [],
        explanation: 'Most merged pull requests passed review and CI on the first attempt.',
      } satisfies CheckResult,
    ],
  };
  const html = renderToStaticMarkup(
    createElement(GradeReport, {
      grade: metricGrade,
      owner: 'acme',
      name: 'checkout',
      outdated: false,
      checkTitles: { 'merges-land-clean': 'Merges land clean' },
      graderTitle: deliveryHealthManifest.card.title,
      disclaimer: deliveryHealthManifest.disclaimer,
    }),
  );
  expect(html).toContain('Most merged pull requests passed review');
  expect(html).not.toContain('Show pinned evidence');
});
```

Append to `src/app/api/repos/[repoId]/grades/[runId]/route.test.ts`, following the existing fixtures in that file:

```ts
test('the status carries the error code, so the page can say what went wrong', async () => {
  // This file already mocks loadGradeRun, hasCurrentSession and
  // requireRepository. Point the run mock at a failed run and assert the body:
  // errorCode is written only from failGrade's whitelist, so nothing a provider
  // or a user typed can reach a client through it.
  loadGradeRun.mockResolvedValue({
    id: 'run',
    repositoryId: 'repo',
    state: 'failed',
    errorCode: 'insufficient_evidence',
  });
  const response = await GET(new Request('http://test'), {
    params: Promise.resolve({ repoId: 'repo', runId: 'run' }),
  });
  expect(await response.json()).toEqual({
    id: 'run',
    state: 'failed',
    errorCode: 'insufficient_evidence',
  });
});
```

Match the mock names and the `GET` invocation to whatever that file already
uses; the assertion on the body shape is the part that matters.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/components/grading/report.test.ts "src/app/api/repos/[repoId]/grades/[runId]/route.test.ts"`
Expected: FAIL — `GradeReport` takes no `graderTitle`, and the route returns no `errorCode`.

- [ ] **Step 3: Implement**

In `src/components/grading/report.tsx`:

Widen `Status` and read the code in the status paragraph:

```ts
type Status = {
  id: string;
  state: 'queued' | 'running' | 'complete' | 'failed';
  errorCode?: string | null;
};
```

Replace the `'failed'` arm of that paragraph's conditional:

```tsx
              : run?.state === 'failed'
                ? run.errorCode === 'insufficient_evidence'
                  ? 'There is not enough record in this window to score. Try again once more work has merged.'
                  : 'The grader could not finish. Your last completed report is unchanged. Try again.'
                : ''
```

In the polling `useEffect`, keep `next.errorCode` when the response carries it:

```ts
        const next: Status = await response.json();
```
is already assigned wholesale, so no change is needed there beyond the widened type.

Add the two props to `GradeReport` and use them:

```tsx
export function GradeReport({
  grade,
  owner,
  name,
  outdated,
  checkTitles,
  graderTitle,
  disclaimer,
}: {
  grade: CompletedGrade;
  owner: string;
  name: string;
  outdated: boolean;
  checkTitles: Record<string, string>;
  graderTitle: string;
  disclaimer: string;
}) {
```

```tsx
    <section className="grading-report" aria-label={`${graderTitle} evidence`}>
```

```tsx
          {graderTitle} v{grade.rubricVersion} · Evaluator {grade.evaluatorVersion}
```

and replace the closing paragraph's hardcoded sentence with `<p>{disclaimer}</p>`.

The `check.paths.length > 0` guard already suppresses the evidence block for a metric check, so no change is needed for that.

In `src/app/api/repos/[repoId]/grades/[runId]/route.ts`:

```ts
    return Response.json(
      { id: run.id, state: run.state, errorCode: run.errorCode },
      { headers },
    );
```

`errorCode` is written only from `failGrade()`'s whitelist, so no provider or user text can reach a client through it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/components/grading src/app/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/grading/report.tsx src/components/grading/report.test.ts "src/app/api/repos/[repoId]/grades/[runId]/route.ts" "src/app/api/repos/[repoId]/grades/[runId]/route.test.ts"
git commit -m "feat(grading): the report names its grader and quotes its disclaimer

The report had Readiness in its label and its footer, and the readiness
grader's caveat written out as if it were fieldnote's. Both come from
the manifest now.

The status route returns the run's error code so the page can say there
was not enough record to score, rather than claiming the grader could
not finish when collection worked perfectly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The Grades tab

**Files:**
- Modify: `src/components/repository/tabs.ts`
- Modify: `src/app/repos/[repoId]/grading/page.tsx`
- Modify: `src/app/repos/[repoId]/grading/actions.ts`
- Modify: `src/db/queries/grade-runs.ts`
- Test: `src/components/repository/tabs.test.ts`

**Interfaces:**
- Consumes: `listGraders()` (Task 4), `gradeCardProps` (Task 7), `GradeReport` props (Task 8).
- Produces:
  - `runGrade(repositoryId: string, graderId: string): Promise<{ runId: string }>`
  - `gradeSummaries(repositoryIds: string[], graderIds: string[]): Promise<GradeSummary[]>`
  - `GradeSummary` gains `graderId: string`

- [ ] **Step 1: Write the failing test**

In `src/components/repository/tabs.test.ts`, change every assertion naming the label `Readiness` to `Grades`. If the file asserts the tab list wholesale, update that array.

Add to the same file:

```ts
test('the grades tab keeps its route, so old links still land', () => {
  const grades = tabs.find((tab) => tab.segment === 'grading');
  expect(grades).toMatchObject({ segment: 'grading', label: 'Grades' });
  expect(tabHref('r1', grades!, '')).toBe('/repos/r1/grading');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/repository/tabs.test.ts`
Expected: FAIL — the label is still `Readiness`.

- [ ] **Step 3: Implement the label, the action and the query**

In `src/components/repository/tabs.ts`, change one line:

```ts
  // The route stays `grading`: renaming it buys a redirect and nothing else.
  { segment: 'grading', label: 'Grades' },
```

In `src/app/repos/[repoId]/grading/actions.ts`:

```ts
export async function runGrade(
  repositoryId: string,
  graderId: string,
): Promise<{ runId: string }> {
  // requestGrade resolves the grader through the registry, which throws on an
  // unknown id, and checks workspace membership, repository connection and
  // demo mode.
  const run = await requestGrade(repositoryId, graderId);
```

Delete the now-unused `AGENT_READINESS` import from that file.

In `src/db/queries/grade-runs.ts`, generalise `gradeSummaries` — it has one call site, so a second near-identical function would be two things to keep in step for no gain:

```ts
export type GradeSummary = {
  repositoryId: string;
  graderId: string;
  latest: CompletedGrade | null;
  status: Pick<GradeRun, 'id' | 'state' | 'errorCode' | 'createdAt'> | null;
};

export async function gradeSummaries(
  repositoryIds: string[],
  graderIds: string[],
): Promise<GradeSummary[]> {
  const allowed = new Set((await accessibleRepositories()).map((repo) => repo.id));
  const ids = [...new Set(repositoryIds)].filter((id) => allowed.has(id));
  const graders = [...new Set(graderIds)];
  if (!ids.length || !graders.length) return [];
  const records = await db()
    .select()
    .from(runs)
    .where(and(inArray(runs.repositoryId, ids), inArray(runs.graderId, graders)))
    .orderBy(desc(runs.createdAt), desc(runs.id));
  return ids.flatMap((repositoryId) =>
    graders.map((graderId) => {
      const history = records.filter(
        (run) => run.repositoryId === repositoryId && run.graderId === graderId,
      );
      const current = history[0];
      const latest = history.find((run) => run.state === 'complete');
      return {
        repositoryId,
        graderId,
        latest: latest ? completed(latest) : null,
        status: current
          ? {
              id: current.id,
              state: current.state,
              errorCode: current.errorCode,
              createdAt: current.createdAt,
            }
          : null,
      };
    }),
  );
}
```

- [ ] **Step 4: Rewrite the page**

In `src/app/repos/[repoId]/grading/page.tsx`:

Replace the readiness imports with the barrel and the registry:

```ts
import { AGENT_READINESS } from '../../../../domain/grading/graders';
import { getGrader, graderCheckTitles, listGraders } from '../../../../domain/grading/registry';
import { ManifestError } from '../../../../domain/grading/manifest';
```

Widen the search params and resolve the selected grader:

```ts
export default async function Grading({
  params,
  searchParams,
}: {
  params: Promise<{ repoId: string }>;
  searchParams: Promise<{ run?: string; grader?: string }>;
}) {
  const repoId = pageRouteId((await params).repoId);
  const repo = await requireRepository(repoId);
  const { run, grader } = await searchParams;
  // Every registered grader gets a card, whether or not it has ever run: a
  // second grader should advertise itself before anyone has used it.
  const graders = listGraders();
  // Selection is route state. An unregistered id is a 404 rather than a silent
  // fall back to the built-in, which would hide a broken link.
  let selectedGrader;
  try {
    selectedGrader = getGrader(grader ?? AGENT_READINESS);
  } catch (error) {
    if (error instanceof ManifestError) notFound();
    throw error;
  }
  const checkTitles = graderCheckTitles(selectedGrader.id);
  const [summaries, history, selected, enabled, plan] = await Promise.all([
    gradeSummaries([repoId], graders.map((entry) => entry.id)),
    gradeHistory(repoId, selectedGrader.id),
    run ? getGrade(repoId, run, selectedGrader.id) : Promise.resolve(null),
    actEnabled(repoId),
    latestPlan(repoId),
  ]);
  if (run && !selected) notFound();
  const summaryFor = (graderId: string) =>
    summaries.find((entry) => entry.graderId === graderId) ?? null;
  const summary = summaryFor(selectedGrader.id);
  const grade = run ? selected : summary?.latest;
  const href = `/repos/${encodeURIComponent(repoId)}/grading`;
  const hrefFor = (graderId: string) =>
    graderId === AGENT_READINESS ? href : `${href}?grader=${encodeURIComponent(graderId)}`;
```

Keep the Act block exactly as it is, but gate it on the readiness grader being the selected one, so no Act button appears under a delivery report:

```tsx
      {grade && selectedGrader.id === AGENT_READINESS && (
        <ActEntry
          repositoryId={repoId}
          availability={availability}
          latest={plan ? { id: plan.id, state: plan.state } : null}
        />
      )}
```

Compute `availability` from the readiness summary rather than the selected one, so switching tabs does not change what Act says:

```ts
  const readinessGrade = summaryFor(AGENT_READINESS)?.latest ?? null;
  const availability = actAvailability({
    enabled,
    permissions,
    failingCheckCount:
      readinessGrade?.checks.filter((check) => check.status === 'fail').length ?? 0,
  });
```

Replace the single card with the row:

```tsx
      <div className="grade-row">
        {graders.map((entry) => {
          const entrySummary = summaryFor(entry.id);
          const entryGrade = entry.id === selectedGrader.id ? grade : entrySummary?.latest;
          const selectedNow = entry.id === selectedGrader.id;
          return (
            <div
              className="grade-row-item"
              key={entry.id}
              aria-current={selectedNow ? 'true' : undefined}
            >
              {entryGrade?.score !== null && entryGrade?.score !== undefined ? (
                <Link href={hrefFor(entry.id)} className="grade-row-link">
                  <GradeCard
                    {...gradeCardProps({
                      score: entryGrade.score,
                      repositoryName: `${repo.owner} / ${repo.name}`,
                      sha: entryGrade.sha,
                      rubricVersion: entryGrade.rubricVersion,
                      checks: entryGrade.checks,
                      graderId: entry.id,
                    })}
                  />
                </Link>
              ) : (
                <section className="grading-ungraded">
                  <h3>{entry.card.title}</h3>
                  <p>{entry.card.tagline}</p>
                  <p>
                    A score appears only after all evidence is collected. Run this grader to create
                    your first report.
                  </p>
                </section>
              )}
              <GradeControls
                key={`${repoId}:${entry.id}`}
                repositoryId={repoId}
                graderId={entry.id}
                initial={entrySummary?.status ?? null}
                canRun={!repo.isDemo}
              />
            </div>
          );
        })}
      </div>
```

Pass the two new props to the report, and keep the history block beneath the selected grader:

```tsx
        {grade && (
          <GradeReport
            grade={grade}
            owner={repo.owner}
            name={repo.name}
            checkTitles={checkTitles}
            graderTitle={selectedGrader.card.title}
            disclaimer={selectedGrader.disclaimer}
            outdated={
              grade.rubricVersion !== selectedGrader.version ||
              grade.evaluatorVersion !== selectedGrader.evaluatorVersion
            }
          />
        )}
```

Rewrite the history block so a saved report keeps the grader it belongs to. It
sits beneath the row and lists only the selected grader's runs:

```tsx
      {history.length > 0 && (
        <details className="grading-history">
          <summary>
            {selectedGrader.card.title} — completed reports ({history.length})
          </summary>
          <ul>
            {history.map((item) => (
              <li key={item.id}>
                <Link
                  href={`${href}?${new URLSearchParams({
                    grader: selectedGrader.id,
                    run: item.id,
                  })}`}
                  aria-current={grade?.id === item.id ? 'page' : undefined}
                >
                  {item.score} / 100 · {item.sha.slice(0, 7)} ·{' '}
                  {item.computedAt.toISOString().slice(0, 10)} · v{item.rubricVersion}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
```

The "viewing a saved report" line above it must return to the selected grader,
not to readiness:

```tsx
      {run && (
        <p>
          Viewing a saved report. <Link href={hrefFor(selectedGrader.id)}>View latest completed report</Link>
        </p>
      )}
```

Change the panel heading and intro so they describe a row rather than one grader:

```tsx
      <div className="eyebrow panel-eyebrow">Repository / Grades</div>
      <h2>A record you can inspect.</h2>
      <p className="page-intro">Every grader that has an opinion about this repository.</p>
```

In `src/components/grading/report.tsx`, `GradeControls` takes the grader it runs:

```tsx
export function GradeControls({
  repositoryId,
  graderId,
  initial,
  canRun,
}: {
  repositoryId: string;
  graderId: string;
  initial: Status | null;
  canRun: boolean;
}) {
```

and passes it through: `await runGrade(repositoryId, graderId)`.

Add to `src/app/style.css`, beside the existing `.grading-layout` rules:

```css
.grade-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  gap: 1.5rem;
}
.grade-row-link {
  display: block;
  text-decoration: none;
  color: inherit;
}
.grade-row-item[aria-current='true'] .grade-row-link {
  outline: 2px solid var(--grade, currentColor);
  outline-offset: 4px;
  border-radius: var(--radius, 0.75rem);
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/components src/domain/grading`
Expected: PASS.
Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/repository/tabs.ts src/components/repository/tabs.test.ts "src/app/repos/[repoId]/grading/page.tsx" "src/app/repos/[repoId]/grading/actions.ts" src/components/grading/report.tsx src/db/queries/grade-runs.ts src/app/style.css
git commit -m "feat(grading): a row of cards, one per grader

Answers the open question slice 1 deferred. A repository with two grades
shows both, side by side, and selecting a card shows that grader's
report and history. No primary grader and no composite score: the
graders answer different questions, and a mean of can an agent work here
and does work reach green cleanly is a number about nothing.

Every registered grader gets a card whether or not it has run, so a
second grader advertises itself before anyone has used it. The route
stays /grading; only the label changes.

Act keeps naming the readiness grader, and its entry renders only under
the readiness report. Nothing an agent writes into a repository raises a
first-pass rate.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: The demo shows two cards

**Files:**
- Modify: `src/demo/fixtures.ts`
- Modify: `scripts/seed.ts`
- Test: `src/demo/fixtures.test.ts`

**Interfaces:**
- Consumes: `deliveryHealthManifest` (Task 4), `runDeclarative` (Task 3).
- Produces: `demoDeliveryGrade: GradeResult`, `demoDeliveryWindow: MetricsWindow`.

The demo is how anyone who has not read the design sees what this slice did, and
it currently renders exactly one card.

- [ ] **Step 1: Write the failing test**

Append to `src/demo/fixtures.test.ts`:

```ts
import { demoDeliveryGrade } from './fixtures';
import { DELIVERY_HEALTH } from '../domain/grading/graders/delivery-health';

describe('demoDeliveryGrade', () => {
  test('is produced by the real evaluator and differs from the readiness card', () => {
    // checkout-service merges cleanly and keeps CI green, but leaves failures
    // red: 40 + 30 + 0.
    expect(demoDeliveryGrade.score).toBe(70);
    expect(demoDeliveryGrade.rubricVersion).toBe('0.1.0');
    expect(demoDeliveryGrade.checks.map((check) => check.id)).toEqual([
      'merges-land-clean',
      'ci-ends-green',
      'failures-get-fixed',
    ]);
  });

  test('names the window it scored, so the seeded report is not ambiguous', () => {
    expect(demoDeliveryGrade.window).toMatchObject({ days: 30 });
  });

  test('a metric check carries its measurement and points at no files', () => {
    const check = demoDeliveryGrade.checks[0];
    expect(check.paths).toEqual([]);
    expect(check.explanation).toContain('Measured');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/demo/fixtures.test.ts`
Expected: FAIL — `demoDeliveryGrade` is not exported.

- [ ] **Step 3: Implement**

Append to `src/demo/fixtures.ts`:

```ts
import { deliveryHealthManifest } from '../domain/grading/graders/delivery-health';
import type { MetricsWindow } from '../domain/grading/types';

// The window the demo delivery grade is scored over. It is written out rather
// than aggregated from the seeded pull requests: the seed's dates move with
// whatever the demo fixture says, and the card should show a stable number.
export const demoDeliveryWindow: MetricsWindow = {
  days: 30,
  start: '2026-08-31T00:00:00.000Z',
  endExclusive: '2026-09-30T00:00:00.000Z',
  mergedPullRequests: 24,
  // 17 of 24 merged clean — a repository that ships, with room to improve.
  'first-pass-rate': { numerator: 17, denominator: 24, value: (100 * 17) / 24 },
  'ci-success-rate': { numerator: 38, denominator: 40, value: 95 },
  // Two runs went red and neither came back. This is the failing check, and
  // the one that makes the delivery card read differently from the readiness
  // card beside it.
  'ci-recovery-rate': { numerator: 0, denominator: 2, value: 0 },
};

// Graded by the real evaluator, for the same reason demoGrade is: a seeded
// card must not claim a score, a check id or an explanation the rubric would
// not produce.
export const demoDeliveryGrade = runDeclarative(deliveryHealthManifest, {
  sha: demoGradeSha,
  complete: true,
  documents: [],
  metrics: demoDeliveryWindow,
});
```

In `scripts/seed.ts`, import `demoDeliveryGrade` and `deliveryHealthManifest`, and insert a second grade run beside the first, copying the existing block exactly and changing five values:

```ts
  await db()
    .insert(gradeRuns)
    .values({
      id: 'demo-delivery-grade-run',
      repositoryId: 'demo-repository',
      graderId: deliveryHealthManifest.id,
      rubricVersion: deliveryHealthManifest.version,
      evaluatorVersion: deliveryHealthManifest.evaluatorVersion,
      requestedBy: 'demo-user',
      requestedWorkspaceId: 'demo-workspace',
      state: 'complete',
      sha: demoGradeSha,
      result: demoDeliveryGrade,
      dispatchedAt: graded,
      startedAt: graded,
      completedAt: graded,
    })
    .onConflictDoNothing();
```

Add a line to the closing summary beside the readiness one:

```ts
  console.log(`Delivery ${demoDeliveryGrade.score}/100: /repos/demo-repository/grading`);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/demo`
Expected: PASS.

- [ ] **Step 5: See it**

Run: `pnpm dev:demo`
Open `/repos/demo-repository/grading`. Expected: two cards side by side, each with its own identity strip and Run button; clicking the delivery card switches the report beneath; the delivery report shows measurements and no evidence links, and carries the delivery disclaimer; no Act entry appears while the delivery grader is selected.

- [ ] **Step 6: Commit**

```bash
git add src/demo/fixtures.ts src/demo/fixtures.test.ts scripts/seed.ts
git commit -m "feat(demo): two cards, so the slice is visible without reading it

checkout-service ships steadily and keeps CI green but leaves failures
red, which is the check that makes the delivery card read differently
from the readiness card beside it. Graded by the real evaluator, so the
seeded card cannot claim anything the rubric would not produce.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: The roadmap says what the slices now are

**Files:**
- Modify: `docs/superpowers/specs/2026-09-13-grader-factory-design.md` (see the note below)
- Modify: PR #26 description, via `gh pr edit`

Slice 2 changed two later slices, and two places record the old shape.

**Note on the slice 1 design doc.** It lives on commit `9cda021`, which is on
`claude/landing-page-design-system-jso9cs` and **is not an ancestor of this
branch**. The link in PR #26 and the link at the top of the slice 2 spec are both
broken today. Cherry-pick it first:

```bash
git cherry-pick 9cda021
```

If the user declines the cherry-pick, skip the spec edit and do the PR edit only.

- [ ] **Step 1: Update the later-slices section**

In the *The later slices* section of `docs/superpowers/specs/2026-09-13-grader-factory-design.md`:

- Under **Slice 2**, add: *Designed in
  [the slice 2 design](2026-09-13-grader-factory-slice-2-design.md). Open
  question 5 is answered there: a row of cards.*
- Under **Slice 3**, add: *Slice 2 already builds the metrics collector and a
  dispatcher over two families, so this slice builds the remaining collectors
  and replaces `src/grading/evidence.ts` with the broker. It also owns open
  question 6: pinning a grade's window at request time, because deciding what
  evidence a run is pinned to is what the broker is for.*
- Under **Slice 5**, change the blocked list to *open questions 1, 2, 4 and 6*.

In the *Open questions* section, mark question 5 answered with a pointer to the
slice 2 design, and append question 6 as it is written at the end of the slice 2
design.

- [ ] **Step 2: Update the PR description**

```bash
gh pr view 26 --json body -q .body > /tmp/pr26.md
```

Edit `/tmp/pr26.md`: tick slice 2's checkbox only when the code lands, but update
its line now to read:

```markdown
- [ ] **Slice 2 — the identity strip and a second grader.** Designed: [`docs/superpowers/specs/2026-09-13-grader-factory-slice-2-design.md`](docs/superpowers/specs/2026-09-13-grader-factory-slice-2-design.md). Open question 5 answered — a row of cards.
- [ ] **Slice 3 — the evidence broker, consent and the schedule.** Smaller than sketched: slice 2 builds the metrics collector and the dispatcher. Gains open question 6.
- [ ] **Slice 4 — code graders.** Blocked on open question 3 (AGPL).
- [ ] **Slice 5 — registry, publishing, the public card and the pill.** Blocked on open questions 1, 2, 4 and 6.
```

Then:

```bash
gh pr edit 26 --body-file /tmp/pr26.md
```

- [ ] **Step 3: Commit the spec change**

```bash
git add docs/superpowers/specs/2026-09-13-grader-factory-design.md
git commit -m "docs(design): record what slice 2 took from slice 3

Slice 2 builds the metrics collector and a dispatcher over two families,
so slice 3 builds the remaining collectors and replaces one file. It
also inherits open question 6, because deciding what evidence a run is
pinned to is what the broker is for.

Open question 5 is answered in the slice 2 design; question 5 now blocks
nothing and question 6 blocks slice 5.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: The gate

**Files:** none.

- [ ] **Step 1: Confirm the acceptance test never moved**

Run: `git diff main -- src/domain/grading/readiness-v01.test.ts`
Expected: no output. If this prints anything, the contract change is wrong and the diff is the evidence.

- [ ] **Step 2: Confirm no built-in has a private path**

Run: `grep -rn "AGENT_READINESS\|DELIVERY_HEALTH" src --include=*.ts --include=*.tsx | grep -v "\.test\." | grep -v "domain/grading/graders"`
Expected: only call sites that *name* a grader — the Agents tab, `authoring-runs.ts`, the Act gate on the grading page, and the grading page's default selection. No `if (graderId === …)` branching inside the grading domain, the primitives, the engine or the dispatcher.

- [ ] **Step 3: Confirm the two-grader concurrency test still holds**

The spec lists it under Testing, and it already exists — slice 1 wrote it as
`src/db/grade-runs.integration.test.ts`, *"one active run per grader: a second
grader may run alongside, the same one may not"*. Do not write a second one.
It builds its fixture manifest by spreading `agentReadinessManifest.card`, so it
inherits `card.title` from Task 1 without an edit.

Run: `DEMO_MODE=false pnpm test:integration -- src/db/grade-runs.integration.test.ts`
Expected: PASS, unchanged.

- [ ] **Step 4: Run the full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && DEMO_MODE=false pnpm test:integration && pnpm build`
Expected: all pass. Record the counts in the PR description the way slice 1 did.

- [ ] **Step 5: Commit anything the formatter moved**

```bash
pnpm format
git add -A
git diff --cached --quiet || git commit -m "style: prettier

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
