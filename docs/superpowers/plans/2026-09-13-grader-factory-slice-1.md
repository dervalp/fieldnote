# Grader Factory — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn fieldnote's one compiled-in grader into a public contract — a validated manifest interpreted by a primitive engine — and move the built-in readiness grader onto it, so `evaluateReadiness()` is no longer a function fieldnote calls.

**Architecture:** A **manifest** (id, version, subject, mode, category, kind, needs, card, checks) is validated at registration and interpreted by `runDeclarative()`, which composes three **primitives** extracted verbatim from `readiness-v01.ts`. Readiness-specific prose (`check-titles.ts`, `flavour.ts`) moves into the built-in's manifest; `finish-names.ts` and `next-tier.ts` stay in core. `family` becomes `grader_id` in the schema and a parameter on every grade query.

**Tech Stack:** TypeScript, Next.js 16, Drizzle ORM + Postgres, Zod 4, Vitest, Inngest, React 19.

**Spec:** `docs/superpowers/specs/2026-09-13-grader-factory-design.md` (committed as `9cda021`). The spec is the binding authority. Read it before Task 1.

---

## Global Constraints

Copied from the spec and the slice brief. Every task's requirements implicitly include this section.

- **The acceptance test is `src/domain/grading/readiness-v01.test.ts`, and it must pass UNCHANGED.** Not adapted, not re-pointed at new helpers. If that suite needs editing to accommodate the contract, **the contract is wrong**: stop and report it rather than editing the test. Its pinned surface is `evaluateReadiness(snapshot)` and `readinessRubric` with `{ family: 'agent-readiness', version: '0.1.0', evaluatorVersion: '1.0.0' }`, five frozen checks of `maxPoints: 20`, a frozen `checks` array, check order `[root-agent-instructions, root-readme, docs-markdown, documented-setup, documented-tests]`, and every explanation containing `not semantic quality`.
- **`tier` is taken.** `next-tier.ts` uses it for the next grade band and it is user-facing on the card. The execution distinction is `kind: declarative | code`. Never "tier A" / "tier B" in schema, prose, identifiers or comments.
- **The three primitives are EXTRACTED, not written.** `file-exists` from `isRootFile()` + `presenceCheck()`; `glob-count` from `isDocsMarkdown()` + `presenceCheck()`; `heading-has-fence` from `documentedCommand()` + `commandCheck()`. `documentedCommand()` is the fence-and-heading walker that already handles nested fences, tilde fences, closing-fence length and heading-depth reset. Give it a name and a config surface; do not reimplement it.
- **The flavour regression is deliberate.** `flavour.ts` varies its line by finish; under the contract a grader supplies one `card.tagline`. Do NOT special-case the built-in to keep the six sentences. Do not smuggle the readiness prose back into core.
- **`rainbow` becomes `prismatic` in one commit.** `GradePresentation['finish']`, the `[data-finish='rainbow']` selectors in `grade-card.css`, and the `grade.finish === 'rainbow'` comparison in `grade-card.tsx` change together. Renaming one without the others renders a perfect score with no foil. `grade-card.css` is the only card stylesheet this slice may touch, and only as a rename — no region added, moved or restyled.
- **Out of scope, and the schema must accept-then-reject rather than omit:** a second grader, the sandbox, `kind: code` execution, the model broker, the evidence broker, scheduling, the registry, the marketplace, any card design change.
- **Every primitive must produce a full `CheckResult`, including `paths` and `lineRanges`.** A primitive that cannot point at its own evidence is not admissible, because evidence is the product.
- **Points must total exactly 100**, check ids unique within a grader, and `card.groups` must name every check exactly once. Enforced at registration.
- **TDD throughout** (superpowers:test-driven-development): write the failing test, watch it fail, write the minimum to pass, watch it pass, commit.
- **Verification command:** `pnpm check` (= `lint && typecheck && test && test:integration && build`). Integration tests need Postgres at `TEST_DATABASE_URL` (`.env` points at `postgres://reliability:reliability@localhost:55432/reliability_test`). Never claim anything passes without running it.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Decisions this plan makes that the spec left implicit

Three places where the spec under-determines the work. Each is resolved here; each is called out so a reviewer can overrule it rather than discover it.

1. **`next-tier.ts` cannot stay literally untouched.** The spec says it "operates on `CheckResult[]` and `maxPoints` alone" and simultaneously deletes `check-titles.ts` — but `next-tier.ts:31` imports `checkTitles`. The resolution that honours the *substance* (no readiness prose in core) with the smallest possible change: `nextTier(score, checks, titles = {})` gains a third parameter and drops the import. It becomes more grader-agnostic, not less, and `next-tier.test.ts` passes unchanged because the default is `{}`.
2. **The manifest needs three fields the spec's YAML sketch omits**, because `GradeResult` and the acceptance test require them: `evaluatorVersion` (recorded on every run and asserted by the suite), `checks[].explain.{pass,fail}` (the per-check explanation prose, which is grader prose), and `disclaimer` (the shared caveat appended to every explanation — today's `LIMITATION` constant, also grader prose).
3. **`glob-count` and `heading-has-fence` need per-pattern case-insensitivity.** `isDocsMarkdown()` matches `DOCS/guide.MARKDOWN` and `isRootFile(…, true)` matches `readME.MD`, while `AGENTS.md` is case-sensitive — so a single scope list mixes sensitivities. Scope entries are `{ pattern, caseInsensitive? }` objects, and `glob-count` takes a `caseInsensitive` flag alongside `pattern`. The spec's config table is a sketch; porting exactly is the binding requirement.

## File Structure

**New, in `src/domain/grading/`:**

| File | Responsibility |
| --- | --- |
| `glob.ts` | `globToRegExp(pattern, caseInsensitive)` — `**`, `*`, `?`, `{a,b}`. No new dependency. |
| `markdown-sections.ts` | The extracted fence-and-heading walker: `sectionsWithFencedBlock(document, headings)`. |
| `manifest.ts` | `GraderManifest` type, the Zod schema, `parseManifest()`, `ManifestError` with codes. |
| `manifest-hash.ts` | `manifestHash(manifest)` — canonical (key-sorted) SHA-256. |
| `primitives.ts` | `file-exists`, `glob-count`, `heading-has-fence`; each returns a full `CheckResult`. |
| `declarative.ts` | `runDeclarative(manifest, snapshot): GradeResult`. |
| `rubric-view.ts` | `rubricView(manifest)` — the immutable stored rubric derived from a manifest. |
| `registry.ts` | `registerGrader()`, `getGrader()`, `graderCheckTitles()`. Built-ins register at module load. |
| `graders/agent-readiness.ts` | The built-in manifest. Registered on import. |

**Rewritten:** `readiness-v01.ts` — from a 247-line evaluator to thin compatibility bindings over the contract.

**Deleted:** `check-titles.ts`, `flavour.ts`, `flavour.test.ts`.

**Modified:** `presentation.ts`, `finish-names.ts`, `next-tier.ts`, `src/db/schema.ts`, `src/db/queries/grade-runs.ts`, `src/inngest/functions/grade-repository.ts`, `src/demo/fixtures.ts`, the grading page, `grade-card.tsx`, `grade-card.css`, `report.tsx`, `plan-view.tsx`.

---

### Task 1: Rename `rainbow` to `prismatic`

The type key, both stylesheet selectors and the SVG-fill comparison move together. Pure rename, no behaviour change.

**Files:**
- Modify: `src/domain/grading/presentation.ts:3,11`
- Modify: `src/domain/grading/finish-names.ts:8`
- Modify: `src/domain/grading/flavour.ts:10`
- Modify: `src/components/grading/grade-card.tsx:42`
- Modify: `src/components/grading/grade-card.css:332,351`
- Test: `src/domain/grading/presentation.test.ts:13`, `src/components/grading/report.test.ts:111`

**Interfaces:**
- Produces: `GradePresentation['finish'] = 'common' | 'shimmer' | 'bronze' | 'silver' | 'gold' | 'prismatic'`. Every later task uses `prismatic`.

- [ ] **Step 1: Write the failing test** — change the two pinned expectations to the new key.

In `src/domain/grading/presentation.test.ts`, line 13: `[100, 'rainbow'],` becomes `[100, 'prismatic'],`

In `src/components/grading/report.test.ts`, line 111: `[100, 'rainbow', 'Nothing the rubric asks for is missing'],` becomes `[100, 'prismatic', 'Nothing the rubric asks for is missing'],`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/domain/grading/presentation.test.ts src/components/grading/report.test.ts`

Expected: FAIL — `expected 'rainbow' to be 'prismatic'`, and `data-finish="prismatic"` not found.

- [ ] **Step 3: Rename in all five source locations**

`presentation.ts` — the union member and the `score === 100` branch:

```ts
  finish: 'common' | 'shimmer' | 'bronze' | 'silver' | 'gold' | 'prismatic';
```

```ts
    return { label: 'Excellent', finish: 'prismatic', color: '#7359a3', symbol: 'star', count: 3 };
```

`finish-names.ts` — the key only; the display string was already right:

```ts
  prismatic: 'Prismatic · Perfect score',
```

`flavour.ts` — the key only (this file is deleted in Task 10; it must compile until then):

```ts
  prismatic: 'Nothing the rubric asks for is missing.',
```

`grade-card.tsx:42`:

```tsx
                fill={grade.finish === 'prismatic' ? `url(#${gradient})` : 'currentColor'}
```

`grade-card.css` — both selectors, `.grade-card[data-finish='rainbow']` and `.grade-card[data-finish='rainbow'] .grade-card-inner`:

```css
.grade-card[data-finish='prismatic'] {
```

```css
.grade-card[data-finish='prismatic'] .grade-card-inner {
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/domain/grading src/components/grading`

Expected: PASS. Then `grep -rn "rainbow" src/` must print nothing.

- [ ] **Step 5: Commit**

```bash
git add src/domain/grading src/components/grading
git commit -m "refactor(grading): the finish key says prismatic, as the card always did

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Extract the fence-and-heading walker

`documentedCommand()` is ~60 lines of carefully tested logic and the single most reusable thing in the grading domain. This task gives it a name and a home. Pure move: `readiness-v01.ts` imports it and behaves identically.

**Files:**
- Create: `src/domain/grading/markdown-sections.ts`
- Create: `src/domain/grading/markdown-sections.test.ts`
- Modify: `src/domain/grading/readiness-v01.ts` (delete `fenceOpening`, `closesFence`, `heading`, `documentedCommand`, `HeadingMatch`; import instead)

**Interfaces:**
- Produces: `sectionsWithFencedBlock(document: SourceDocument, headings: ReadonlySet<string>): EvidenceLineRange[]` — one range per accepted heading whose section contains a fenced block with a nonblank body, spanning the heading line to the closing-fence line, 1-indexed, carrying the document's `path` and `blobSha`.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/grading/markdown-sections.test.ts
import { expect, test } from 'vitest';
import { sectionsWithFencedBlock } from './markdown-sections';
import type { SourceDocument } from './types';

const doc = (text: string): SourceDocument => ({ path: 'README.md', blobSha: 'sha', text });
const setup = new Set(['setup', 'install', 'installation', 'getting started']);

test('a heading followed by a nonempty fence yields a range from heading to closing fence', () => {
  const ranges = sectionsWithFencedBlock(
    doc(['# Project', '## Installation', '```sh', 'pnpm install', '```'].join('\n')),
    setup,
  );
  expect(ranges).toEqual([{ path: 'README.md', blobSha: 'sha', start: 2, end: 5 }]);
});

test('tilde fences close only on tildes of at least the opening length', () => {
  const ranges = sectionsWithFencedBlock(
    doc(['## Setup', '~~~~sh', '```', 'pnpm install', '~~~', '~~~~'].join('\n')),
    setup,
  );
  expect(ranges).toEqual([{ path: 'README.md', blobSha: 'sha', start: 1, end: 6 }]);
});

test('a heading inside a fence does not start a section', () => {
  expect(
    sectionsWithFencedBlock(
      doc(['```md', '## Setup', '```sh', 'pnpm install', '```', '```'].join('\n')),
      setup,
    ),
  ).toEqual([]);
});

test('an empty fence body does not satisfy a heading, and a later section cannot rescue it', () => {
  expect(
    sectionsWithFencedBlock(
      doc(
        ['## Setup', '```sh', '   ', '```', '## Notes', '```sh', 'pnpm install', '```'].join('\n'),
      ),
      setup,
    ),
  ).toEqual([]);
});

test('a deeper heading stays inside the candidate section; a same-or-shallower one closes it', () => {
  expect(
    sectionsWithFencedBlock(
      doc(['## Getting Started', '### Shell', '```', 'pnpm dev', '```'].join('\n')),
      setup,
    ),
  ).toHaveLength(1);
  expect(
    sectionsWithFencedBlock(doc(['## Setup', '## Notes', '```', 'pnpm dev', '```'].join('\n')), setup),
  ).toEqual([]);
});

test('headings are matched case-insensitively with trailing hashes stripped', () => {
  expect(
    sectionsWithFencedBlock(doc(['## SETUP ##', '```', 'x', '```'].join('\n')), setup),
  ).toHaveLength(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/domain/grading/markdown-sections.test.ts`

Expected: FAIL — `Failed to resolve import "./markdown-sections"`.

- [ ] **Step 3: Move the walker verbatim**

Create `src/domain/grading/markdown-sections.ts`. The four functions are moved from `readiness-v01.ts:106-169` with no logic change; only the return shape changes, from `HeadingMatch[]` (which carried the `SourceDocument`) to `EvidenceLineRange[]` (which carries `path` and `blobSha`), because that is what every primitive must produce.

```ts
import type { EvidenceLineRange, SourceDocument } from './types';

function fenceOpening(line: string): { marker: '`' | '~'; length: number } | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return undefined;
  const marker = match[1][0] as '`' | '~';
  if (marker === '`' && match[2].includes('`')) return undefined;
  return { marker, length: match[1].length };
}

function closesFence(line: string, fence: { marker: '`' | '~'; length: number }) {
  const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
  return Boolean(match && match[1][0] === fence.marker && match[1].length >= fence.length);
}

function heading(line: string): { depth: number; text: string } | undefined {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/.exec(line);
  if (!match) return undefined;
  return {
    depth: match[1].length,
    text: match[2]
      .replace(/[ \t]+#+[ \t]*$/, '')
      .trim()
      .toLowerCase(),
  };
}

/**
 * Every heading in `headings` whose section contains a fenced block with a
 * nonblank body, as a range from the heading line to the closing fence.
 *
 * Extracted unchanged from readiness-v01's documentedCommand(). It is the one
 * piece of the readiness grader that was never about readiness: nested fences,
 * tilde fences, closing-fence length and heading-depth reset are Markdown
 * facts, not rubric opinions. Named here so any declarative grader can use it.
 */
export function sectionsWithFencedBlock(
  document: SourceDocument,
  headings: ReadonlySet<string>,
): EvidenceLineRange[] {
  const lines = document.text.split(/\r?\n/);
  const ranges: EvidenceLineRange[] = [];
  let activeHeading: { depth: number; line: number } | undefined;
  let fence: { marker: '`' | '~'; length: number; hasBody: boolean } | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      if (closesFence(line, fence)) {
        if (activeHeading && fence.hasBody) {
          ranges.push({
            path: document.path,
            blobSha: document.blobSha,
            start: activeHeading.line,
            end: index + 1,
          });
          activeHeading = undefined;
        }
        fence = undefined;
      } else if (line.trim()) {
        fence.hasBody = true;
      }
      continue;
    }

    const nextHeading = heading(line);
    if (nextHeading) {
      if (activeHeading && nextHeading.depth <= activeHeading.depth) activeHeading = undefined;
      if (headings.has(nextHeading.text)) {
        activeHeading = { depth: nextHeading.depth, line: index + 1 };
      }
      continue;
    }

    const opening = fenceOpening(line);
    if (opening) fence = { ...opening, hasBody: false };
  }

  return ranges;
}
```

- [ ] **Step 4: Point `readiness-v01.ts` at it**

Delete `HeadingMatch`, `fenceOpening`, `closesFence`, `heading` and `documentedCommand` from `readiness-v01.ts`. Add `import { sectionsWithFencedBlock } from './markdown-sections';` and rewrite `commandCheck`'s first two statements:

```ts
function commandCheck(
  id: string,
  documents: SourceDocument[],
  headings: string[],
  label: string,
): CheckResult {
  const accepted = new Set(headings);
  const lineRanges = documents.flatMap((document) => sectionsWithFencedBlock(document, accepted));
  const passed = lineRanges.length > 0;
```

The rest of `commandCheck` is unchanged. Remove the `EvidenceLineRange` import only if TypeScript reports it unused (`firstNonblankLine` still returns one).

- [ ] **Step 5: Run the tests to verify they pass — including the acceptance suite**

Run: `pnpm vitest run src/domain/grading`

Expected: PASS, with `readiness-v01.test.ts` green and unedited.

- [ ] **Step 6: Commit**

```bash
git add src/domain/grading
git commit -m "refactor(grading): name the fence-and-heading walker

The most reusable thing in the grading domain had no name and lived inside
one grader. Nested fences, tilde fences, closing-fence length and heading
depth are Markdown facts, not rubric opinions.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: A glob matcher

`glob-count` takes a `pattern` and `heading-has-fence` takes a `scope`. Both need a matcher. No new dependency — the subset needed is small, and a manifest is untrusted input, so a matcher we can read end to end is worth more than a general one.

**Files:**
- Create: `src/domain/grading/glob.ts`
- Create: `src/domain/grading/glob.test.ts`

**Interfaces:**
- Produces: `globToRegExp(pattern: string, caseInsensitive = false): RegExp` — anchored, supporting `**/` (zero or more path segments), `*` (within one segment), `?` (one character within a segment), and `{a,b}` alternation. Every other character is literal.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/grading/glob.test.ts
import { expect, test } from 'vitest';
import { globToRegExp } from './glob';

const matches = (pattern: string, path: string, ci = false) => globToRegExp(pattern, ci).test(path);

test('a literal pattern matches only itself', () => {
  expect(matches('AGENTS.md', 'AGENTS.md')).toBe(true);
  expect(matches('AGENTS.md', 'agents.md')).toBe(false);
  expect(matches('AGENTS.md', 'docs/AGENTS.md')).toBe(false);
  expect(matches('AGENTS.md', 'AGENTSxmd')).toBe(false); // the dot is literal
});

test('caseInsensitive relaxes the whole pattern', () => {
  expect(matches('README.md', 'readME.MD', true)).toBe(true);
  expect(matches('docs/**/*.{md,markdown}', 'DOCS/guide.MARKDOWN', true)).toBe(true);
});

test('** spans zero or more directories and * stays inside one segment', () => {
  expect(matches('docs/**/*.md', 'docs/guide.md')).toBe(true);
  expect(matches('docs/**/*.md', 'docs/a/b/guide.md')).toBe(true);
  expect(matches('docs/**/*.md', 'notdocs/guide.md')).toBe(false);
  expect(matches('docs/*.md', 'docs/a/guide.md')).toBe(false);
});

test('brace alternation offers each branch', () => {
  expect(matches('*.{md,markdown}', 'x.md')).toBe(true);
  expect(matches('*.{md,markdown}', 'x.markdown')).toBe(true);
  expect(matches('*.{md,markdown}', 'x.txt')).toBe(false);
  expect(matches('{AGENTS,CLAUDE}.md', 'CLAUDE.md')).toBe(true);
});

test('regex metacharacters in a pattern are literal', () => {
  expect(matches('a+b(c).md', 'a+b(c).md')).toBe(true);
  expect(matches('a+b(c).md', 'aab c.md')).toBe(false);
});

test('? matches one character but never a separator', () => {
  expect(matches('doc?.md', 'docs.md')).toBe(true);
  expect(matches('doc?.md', 'doc/.md')).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/domain/grading/glob.test.ts`

Expected: FAIL — `Failed to resolve import "./glob"`.

- [ ] **Step 3: Write the matcher**

```ts
// src/domain/grading/glob.ts

// A manifest names evidence with globs, so fieldnote needs a matcher. This is
// deliberately the smallest one that covers what a declarative grader can
// request: `**/` for directory depth, `*` and `?` within a segment, and
// `{a,b}` for extensions. Everything else is literal. A third-party manifest
// is untrusted input, so the compiled expression must never be able to
// backtrack catastrophically — every construct here is linear.
const LITERAL = /[\\^$.*+?()[\]{}|]/g;

export function globToRegExp(pattern: string, caseInsensitive = false): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern.startsWith('**/', i)) {
        source += '(?:[^/]+/)*';
        i += 2;
      } else if (pattern.startsWith('**', i)) {
        source += '.*';
        i += 1;
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    if (char === '{') {
      const close = pattern.indexOf('}', i);
      if (close > i) {
        const branches = pattern
          .slice(i + 1, close)
          .split(',')
          .map((branch) => branch.replace(LITERAL, '\\$&'));
        source += `(?:${branches.join('|')})`;
        i = close;
        continue;
      }
    }
    source += char.replace(LITERAL, '\\$&');
  }
  return new RegExp(`^${source}$`, caseInsensitive ? 'i' : '');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/domain/grading/glob.test.ts`

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/grading/glob.ts src/domain/grading/glob.test.ts
git commit -m "feat(grading): a glob matcher a manifest can name evidence with

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The manifest schema and its invariants

The contract's front door. A manifest that reaches `runDeclarative()` has already been proven well-formed, so the engine never validates.

**Files:**
- Create: `src/domain/grading/manifest.ts`
- Create: `src/domain/grading/manifest.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type GraderManifest` — the parsed, validated manifest (exact shape in Step 3).
  - `type GraderCheck = GraderManifest['checks'][number]`
  - `parseManifest(input: unknown): GraderManifest` — throws `ManifestError`.
  - `class ManifestError extends Error { readonly code: ManifestErrorCode }`
  - `type ManifestErrorCode = 'schema' | 'subject_unsupported' | 'kind_unsupported' | 'unknown_grader' | 'points_not_100' | 'duplicate_check_id' | 'check_not_grouped' | 'check_grouped_twice' | 'unknown_check_grouped'`
  - `const GRADER_CATEGORIES` — the closed set of eight from the spec.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/grading/manifest.test.ts
import { expect, test } from 'vitest';
import { ManifestError, parseManifest } from './manifest';

type Draft = Record<string, unknown>;

const valid = (): Draft => ({
  id: 'fieldnote/example',
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'documentation',
  kind: 'declarative',
  needs: { 'repo.files': ['README.md'] },
  disclaimer: 'Evidence, not certification.',
  card: {
    tagline: 'Is anything written down?',
    groups: [{ title: 'Docs', checks: ['a', 'b'] }],
  },
  checks: [
    {
      id: 'a',
      title: 'A',
      points: 60,
      explain: { pass: 'Found it.', fail: 'Did not find it.' },
      primitive: 'file-exists',
      args: { root: true, nonempty: true, anyOf: ['README.md'] },
    },
    {
      id: 'b',
      title: 'B',
      points: 40,
      explain: { pass: 'Found it.', fail: 'Did not find it.' },
      primitive: 'glob-count',
      args: { pattern: 'docs/**/*.md', nonempty: true, min: 1 },
    },
  ],
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rejects = (mutate: (manifest: any) => void, code: string) => {
  const manifest = valid();
  mutate(manifest);
  try {
    parseManifest(manifest);
  } catch (error) {
    expect(error).toBeInstanceOf(ManifestError);
    expect((error as ManifestError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
};

test('a well-formed manifest parses', () => {
  const manifest = parseManifest(valid());
  expect(manifest.id).toBe('fieldnote/example');
  expect(manifest.checks).toHaveLength(2);
});

test('points that do not total 100 are rejected', () => {
  rejects((m) => void (m.checks[0].points = 59), 'points_not_100');
});

test('a duplicate check id is rejected', () => {
  rejects((m) => {
    m.checks[1].id = 'a';
    m.card.groups[0].checks = ['a', 'a'];
  }, 'duplicate_check_id');
});

test('a check absent from card.groups is rejected', () => {
  rejects((m) => void (m.card.groups[0].checks = ['a']), 'check_not_grouped');
});

test('a check named twice in card.groups is rejected', () => {
  rejects((m) => void m.card.groups.push({ title: 'Again', checks: ['a'] }), 'check_grouped_twice');
});

test('a group naming an unknown check is rejected', () => {
  rejects((m) => void m.card.groups[0].checks.push('c'), 'unknown_check_grouped');
});

test('an unknown subject is accepted by the schema and rejected by the invariants', () => {
  rejects((m) => void (m.subject = 'pull_request'), 'subject_unsupported');
});

test('kind: code parses — it is rejected at registration, not here', () => {
  const manifest = valid();
  manifest.kind = 'code';
  expect(parseManifest(manifest).kind).toBe('code');
});

test('an unknown category, an unknown primitive and a missing field are schema errors', () => {
  rejects((m) => void (m.category = 'vibes'), 'schema');
  rejects((m) => void (m.checks[0].primitive = 'file-vibes'), 'schema');
  rejects((m) => void delete m.card, 'schema');
  rejects((m) => void (m.card.tagline = ''), 'schema');
});

test('heading-has-fence scope entries carry their own case sensitivity', () => {
  const manifest = valid();
  (manifest.checks as Draft[])[1] = {
    id: 'b',
    title: 'B',
    points: 40,
    explain: { pass: 'Found it.', fail: 'Did not find it.' },
    primitive: 'heading-has-fence',
    args: {
      headings: ['setup'],
      scope: [{ pattern: 'README.md', caseInsensitive: true }, { pattern: 'AGENTS.md' }],
    },
  };
  const parsed = parseManifest(manifest);
  expect(parsed.checks[1].primitive).toBe('heading-has-fence');
  expect(parsed.checks[1].args).toMatchObject({
    scope: [
      { pattern: 'README.md', caseInsensitive: true },
      { pattern: 'AGENTS.md', caseInsensitive: false },
    ],
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/domain/grading/manifest.test.ts`

Expected: FAIL — `Failed to resolve import "./manifest"`.

- [ ] **Step 3: Write the schema**

```ts
// src/domain/grading/manifest.ts
import { z } from 'zod';

// Closed on purpose. Category answers "what does this grader look at" — the
// axis a browsing developer filters on — and an open tag field makes a
// marketplace unbrowsable at about forty entries.
export const GRADER_CATEGORIES = [
  'harness-integrity',
  'delivery-health',
  'agent-readiness',
  'architecture',
  'test-discipline',
  'code-quality',
  'documentation',
  'supply-chain',
] as const;

export type ManifestErrorCode =
  | 'schema'
  | 'subject_unsupported'
  | 'kind_unsupported'
  | 'unknown_grader'
  | 'points_not_100'
  | 'duplicate_check_id'
  | 'check_not_grouped'
  | 'check_grouped_twice'
  | 'unknown_check_grouped';

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
]);

const manifestSchema = z.object({
  // owner/name. Namespaced because a marketplace has two people who both want
  // the name `test-coverage`. Immutable for the life of a grader.
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/),
  version: semver,
  evaluatorVersion: semver,
  // Accepted as a free string so a `pull_request` subject can arrive later
  // without breaking published graders; rejected below for anything but
  // `repository` in v1.
  subject: nonEmpty,
  mode: z.enum(['deterministic', 'llm', 'hybrid']),
  category: z.enum(GRADER_CATEGORIES),
  kind: z.enum(['declarative', 'code']),
  needs: z.object({ 'repo.files': z.array(nonEmpty).min(1) }),
  // Appended to every explanation. The caveat is the grader's, not fieldnote's.
  disclaimer: nonEmpty,
  card: z.object({
    tagline: nonEmpty,
    groups: z.array(z.object({ title: nonEmpty, checks: z.array(nonEmpty).min(1) })).min(1),
  }),
  checks: z.array(checkSchema).min(1),
});

export type GraderManifest = z.infer<typeof manifestSchema>;
export type GraderCheck = GraderManifest['checks'][number];

export function parseManifest(input: unknown): GraderManifest {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) throw new ManifestError('schema', parsed.error.message);
  const manifest = parsed.data;

  if (manifest.subject !== 'repository')
    throw new ManifestError(
      'subject_unsupported',
      `Subject '${manifest.subject}' is not yet supported; v1 grades a repository.`,
    );

  const ids = manifest.checks.map((check) => check.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate)
    throw new ManifestError('duplicate_check_id', `Check id '${duplicate}' appears twice.`);

  // grade_runs_score already constrains a stored score to 0..100 and
  // gradePresentation throws outside it. A grader whose points do not total
  // 100 is rejected here rather than at run time, when a repository would
  // wear the failure.
  const total = manifest.checks.reduce((sum, check) => sum + check.points, 0);
  if (total !== 100)
    throw new ManifestError('points_not_100', `Check points total ${total}, not 100.`);

  // A check missing from the groups would be invisible on the card while
  // still counting toward the score.
  const grouped = manifest.card.groups.flatMap((group) => group.checks);
  const twice = grouped.find((id, index) => grouped.indexOf(id) !== index);
  if (twice)
    throw new ManifestError('check_grouped_twice', `Check '${twice}' is grouped more than once.`);
  const unknown = grouped.find((id) => !ids.includes(id));
  if (unknown)
    throw new ManifestError('unknown_check_grouped', `Group names unknown check '${unknown}'.`);
  const ungrouped = ids.find((id) => !grouped.includes(id));
  if (ungrouped)
    throw new ManifestError('check_not_grouped', `Check '${ungrouped}' is in no card group.`);

  return manifest;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/domain/grading/manifest.test.ts`

Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/grading/manifest.ts src/domain/grading/manifest.test.ts
git commit -m "feat(grading): a grader is a manifest, and the manifest has a schema

Points total 100, check ids are unique, and every check is on the card
exactly once — enforced before a grader can be registered rather than when
a repository would wear the failure.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The three primitives

Extracted from `readiness-v01.ts`, given a name and a config surface. Each returns a full `CheckResult` including `paths` and `lineRanges` — a primitive that cannot point at its own evidence is not admissible, because evidence is the product.

**Files:**
- Create: `src/domain/grading/primitives.ts`
- Create: `src/domain/grading/primitives.test.ts`

**Interfaces:**
- Consumes: `globToRegExp` (Task 3), `sectionsWithFencedBlock` (Task 2), `GraderCheck` (Task 4), and `CheckResult`/`SourceDocument`/`EvidenceLineRange` from `./types`.
- Produces: `runCheck(check: GraderCheck, documents: SourceDocument[], disclaimer: string): CheckResult`. `documents` arrive already sorted by the engine; `runCheck` preserves that order.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/grading/primitives.test.ts
import { expect, test } from 'vitest';
import { runCheck } from './primitives';
import type { GraderCheck } from './manifest';
import type { SourceDocument } from './types';

const doc = (path: string, text: string): SourceDocument => ({
  path,
  blobSha: `${path}-sha`,
  text,
});
const explain = { pass: 'Found it.', fail: 'Missing.' };
const DISCLAIMER = 'Evidence, not certification.';
const check = (over: Record<string, unknown>): GraderCheck =>
  ({ id: 'c', title: 'C', points: 100, explain, ...over }) as unknown as GraderCheck;

const fileExists = (args: Record<string, unknown>) => check({ primitive: 'file-exists', args });

test('file-exists finds a root file, case-sensitively by default', () => {
  const args = {
    root: true,
    nonempty: true,
    anyOf: ['AGENTS.md', 'CLAUDE.md'],
    caseInsensitive: false,
  };
  const documents = [doc('AGENTS.md', '\nUse pnpm.'), doc('docs/AGENTS.md', 'nope')];
  const result = runCheck(fileExists(args), documents, DISCLAIMER);
  expect(result).toMatchObject({ status: 'pass', points: 100, paths: ['AGENTS.md'] });
  expect(result.lineRanges).toEqual([
    { path: 'AGENTS.md', blobSha: 'AGENTS.md-sha', start: 2, end: 2 },
  ]);
  expect(result.explanation).toBe(`Found it. ${DISCLAIMER}`);
});

test('file-exists with nonempty rejects a blank file and explains the failure', () => {
  const args = { root: true, nonempty: true, anyOf: ['AGENTS.md'], caseInsensitive: false };
  const result = runCheck(fileExists(args), [doc('AGENTS.md', ' \n\t')], DISCLAIMER);
  expect(result).toMatchObject({ status: 'fail', points: 0, paths: [], lineRanges: [] });
  expect(result.explanation).toBe(`Missing. ${DISCLAIMER}`);
});

test('file-exists honours caseInsensitive', () => {
  const args = { root: true, nonempty: true, anyOf: ['README.md'], caseInsensitive: true };
  expect(runCheck(fileExists(args), [doc('readME.MD', '# Project')], DISCLAIMER).paths).toEqual([
    'readME.MD',
  ]);
});

test('glob-count counts matching nonempty documents against min', () => {
  const counted = check({
    primitive: 'glob-count',
    args: { pattern: 'docs/**/*.{md,markdown}', caseInsensitive: true, nonempty: true, min: 2 },
  });
  const one = [doc('DOCS/a.MARKDOWN', 'A'), doc('docs/empty.md', '  '), doc('docs/n.txt', 'no')];
  expect(runCheck(counted, one, DISCLAIMER).status).toBe('fail');
  const result = runCheck(counted, [...one, doc('docs/b.md', 'B')], DISCLAIMER);
  expect(result.status).toBe('pass');
  expect(result.paths).toEqual(['DOCS/a.MARKDOWN', 'docs/b.md']);
});

test('heading-has-fence scans its scope in the order the scope names it', () => {
  const scoped = check({
    primitive: 'heading-has-fence',
    args: {
      headings: ['setup'],
      scope: [
        { pattern: 'README.md', caseInsensitive: true },
        { pattern: 'AGENTS.md', caseInsensitive: false },
      ],
    },
  });
  const body = ['## Setup', '```sh', 'pnpm install', '```'].join('\n');
  const result = runCheck(scoped, [doc('AGENTS.md', body), doc('README.md', body)], DISCLAIMER);
  expect(result.paths).toEqual(['README.md', 'AGENTS.md']);
  expect(result.status).toBe('pass');
});

test('a document matched by two scope entries is scanned once', () => {
  const scoped = check({
    primitive: 'heading-has-fence',
    args: {
      headings: ['setup'],
      scope: [
        { pattern: '*.md', caseInsensitive: false },
        { pattern: 'README.md', caseInsensitive: false },
      ],
    },
  });
  const result = runCheck(
    scoped,
    [doc('README.md', ['## Setup', '```', 'x', '```'].join('\n'))],
    DISCLAIMER,
  );
  expect(result.lineRanges).toHaveLength(1);
});

// The property the spec asks of every primitive: evidence must resolve.
const generated: SourceDocument[] = Array.from({ length: 40 }, (_, i) =>
  doc(
    ['AGENTS.md', 'README.md', 'docs/a.md', 'docs/deep/b.markdown', 'src/x.ts'][i % 5],
    [
      '',
      '# Title',
      ['## Setup', '```sh', `cmd ${i}`, '```'].join('\n'),
      ['```md', '## Setup', '```'].join('\n'),
      `line ${i}\n\n## Install\n~~~\nrun\n~~~`,
    ][i % 5],
  ),
);

test.each([
  fileExists({
    root: true,
    nonempty: true,
    anyOf: ['AGENTS.md', 'README.md'],
    caseInsensitive: true,
  }),
  check({
    primitive: 'glob-count',
    args: { pattern: 'docs/**/*.{md,markdown}', caseInsensitive: true, nonempty: true, min: 1 },
  }),
  check({
    primitive: 'heading-has-fence',
    args: {
      headings: ['setup', 'install'],
      scope: [{ pattern: '**/*.{md,markdown}', caseInsensitive: true }],
    },
  }),
])('$primitive points only at line ranges that resolve inside the document they name', (subject) => {
  const result = runCheck(subject, generated, DISCLAIMER);
  expect(result.paths).toEqual(result.lineRanges.map((range) => range.path));
  for (const range of result.lineRanges) {
    const document = generated.find((d) => d.path === range.path && d.blobSha === range.blobSha);
    expect(document).toBeDefined();
    const lines = document!.text.split(/\r?\n/);
    expect(range.start).toBeGreaterThanOrEqual(1);
    expect(range.end).toBeGreaterThanOrEqual(range.start);
    expect(range.end).toBeLessThanOrEqual(lines.length);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/domain/grading/primitives.test.ts`

Expected: FAIL — `Failed to resolve import "./primitives"`.

- [ ] **Step 3: Write the primitives**

```ts
// src/domain/grading/primitives.ts
import { globToRegExp } from './glob';
import { sectionsWithFencedBlock } from './markdown-sections';
import type { GraderCheck } from './manifest';
import type { CheckResult, EvidenceLineRange, SourceDocument } from './types';

// The rule for adding a primitive: it is extracted from a grader that earned
// it, never speculated into existence. All three below already existed inside
// readiness-v01 as isRootFile/presenceCheck, isDocsMarkdown/presenceCheck and
// documentedCommand/commandCheck. If a proposed primitive has no grader behind
// it, the answer is `kind: code`, not a fourth entry here.

function firstNonblankLine(document: SourceDocument): EvidenceLineRange | undefined {
  const index = document.text.split(/\r?\n/).findIndex((line) => line.trim().length > 0);
  if (index < 0) return undefined;
  return { path: document.path, blobSha: document.blobSha, start: index + 1, end: index + 1 };
}

// A document with no nonblank line still has a line 1 to point at. Evidence is
// the product, so a passing check always names somewhere to look.
function presence(document: SourceDocument, nonempty: boolean): EvidenceLineRange | undefined {
  const range = firstNonblankLine(document);
  if (range) return range;
  return nonempty ? undefined : { path: document.path, blobSha: document.blobSha, start: 1, end: 1 };
}

function result(
  check: GraderCheck,
  passed: boolean,
  lineRanges: EvidenceLineRange[],
  disclaimer: string,
): CheckResult {
  return {
    id: check.id,
    points: passed ? check.points : 0,
    maxPoints: check.points,
    status: passed ? 'pass' : 'fail',
    paths: passed ? lineRanges.map(({ path }) => path) : [],
    lineRanges: passed ? lineRanges : [],
    explanation: `${passed ? check.explain.pass : check.explain.fail} ${disclaimer}`,
  };
}

export function runCheck(
  check: GraderCheck,
  documents: SourceDocument[],
  disclaimer: string,
): CheckResult {
  if (check.primitive === 'file-exists') {
    const { root, nonempty, anyOf, caseInsensitive } = check.args;
    const names = caseInsensitive ? anyOf.map((name) => name.toLowerCase()) : anyOf;
    const evidence = documents.flatMap((document) => {
      if (root && document.path.includes('/')) return [];
      const path = caseInsensitive ? document.path.toLowerCase() : document.path;
      if (!names.includes(path)) return [];
      const range = presence(document, nonempty);
      return range ? [range] : [];
    });
    return result(check, evidence.length > 0, evidence, disclaimer);
  }

  if (check.primitive === 'glob-count') {
    const { pattern, caseInsensitive, nonempty, min } = check.args;
    const expression = globToRegExp(pattern, caseInsensitive);
    const evidence = documents.flatMap((document) => {
      if (!expression.test(document.path)) return [];
      const range = presence(document, nonempty);
      return range ? [range] : [];
    });
    return result(check, evidence.length >= min, evidence, disclaimer);
  }

  // heading-has-fence. Scope entries are honoured in the order the manifest
  // names them, and a document matched by two entries is scanned once — that
  // order is what a reader of the evidence list sees, so it is part of the
  // contract, not an implementation detail.
  const headings = new Set(check.args.headings.map((heading) => heading.toLowerCase()));
  const seen = new Set<string>();
  const scoped: SourceDocument[] = [];
  for (const entry of check.args.scope) {
    const expression = globToRegExp(entry.pattern, entry.caseInsensitive);
    for (const document of documents) {
      const key = `${document.path}::${document.blobSha}`;
      if (seen.has(key) || !expression.test(document.path)) continue;
      seen.add(key);
      scoped.push(document);
    }
  }
  const evidence = scoped.flatMap((document) => sectionsWithFencedBlock(document, headings));
  return result(check, evidence.length > 0, evidence, disclaimer);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/domain/grading/primitives.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/grading/primitives.ts src/domain/grading/primitives.test.ts
git commit -m "feat(grading): three primitives, extracted from the grader that earned them

file-exists, glob-count and heading-has-fence all already existed inside
readiness-v01. They are given a name and a config surface, not written.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The declarative engine, the rubric view and the registry

**Files:**
- Create: `src/domain/grading/declarative.ts`
- Create: `src/domain/grading/rubric-view.ts`
- Create: `src/domain/grading/manifest-hash.ts`
- Create: `src/domain/grading/registry.ts`
- Create: `src/domain/grading/registry.test.ts`

**Interfaces:**
- Consumes: `runCheck` (Task 5); `parseManifest`, `ManifestError`, `GraderManifest` (Task 4).
- Produces:
  - `runDeclarative(manifest: GraderManifest, snapshot: RepositorySnapshot): GradeResult`
  - `rubricView(manifest: GraderManifest): RubricView` where `RubricView = { graderId: string; version: string; evaluatorVersion: string; checks: readonly { id: string; maxPoints: number }[] }`, frozen at both levels.
  - `manifestHash(manifest: unknown): string` — hex SHA-256 over a key-sorted serialisation.
  - `registerGrader(input: unknown): GraderManifest` — parses, rejects `kind: code`, stores, returns.
  - `getGrader(graderId: string): GraderManifest` — throws `ManifestError('unknown_grader')` if absent.
  - `graderCheckTitles(graderId: string): Record<string, string>`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/grading/registry.test.ts
import { expect, test } from 'vitest';
import { ManifestError } from './manifest';
import { getGrader, graderCheckTitles, registerGrader } from './registry';
import { runDeclarative } from './declarative';
import { rubricView } from './rubric-view';
import { manifestHash } from './manifest-hash';

const manifest = (over: Record<string, unknown> = {}) => ({
  id: 'fieldnote/registry-fixture',
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'documentation',
  kind: 'declarative',
  needs: { 'repo.files': ['README.md'] },
  disclaimer: 'Evidence, not certification.',
  card: { tagline: 'Is anything written down?', groups: [{ title: 'Docs', checks: ['readme'] }] },
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

test('a registered grader is retrievable by id and publishes its check titles', () => {
  registerGrader(manifest());
  expect(getGrader('fieldnote/registry-fixture').card.tagline).toBe('Is anything written down?');
  expect(graderCheckTitles('fieldnote/registry-fixture')).toEqual({
    readme: 'Project documentation',
  });
});

test('kind: code is accepted by the schema and rejected at registration', () => {
  try {
    registerGrader(manifest({ id: 'fieldnote/code-fixture', kind: 'code' }));
  } catch (error) {
    expect(error).toBeInstanceOf(ManifestError);
    expect((error as ManifestError).code).toBe('kind_unsupported');
    expect((error as ManifestError).message).toMatch(/not yet supported/);
    return;
  }
  throw new Error('expected kind_unsupported');
});

test('an unknown grader id is a distinguishable error, not undefined', () => {
  expect(() => getGrader('someone/absent')).toThrow(ManifestError);
});

test('the rubric view is frozen and carries only the versioned check arithmetic', () => {
  const view = rubricView(getGrader('fieldnote/registry-fixture'));
  expect(view).toEqual({
    graderId: 'fieldnote/registry-fixture',
    version: '0.1.0',
    evaluatorVersion: '1.0.0',
    checks: [{ id: 'readme', maxPoints: 100 }],
  });
  expect(Object.isFrozen(view)).toBe(true);
  expect(Object.isFrozen(view.checks)).toBe(true);
});

test('the manifest hash ignores key order and changes with content', () => {
  const registered = getGrader('fieldnote/registry-fixture');
  expect(manifestHash(registered)).toBe(manifestHash(JSON.parse(JSON.stringify(registered))));
  expect(manifestHash({ x: 1, y: 2 })).toBe(manifestHash({ y: 2, x: 1 }));
  expect(manifestHash(registered)).not.toBe(manifestHash({ ...registered, version: '0.2.0' }));
});

test('runDeclarative scores a complete snapshot and withholds a score from an incomplete one', () => {
  const grader = getGrader('fieldnote/registry-fixture');
  const documents = [{ path: 'README.md', blobSha: 'sha', text: '# Project' }];
  expect(runDeclarative(grader, { sha: 'c', complete: true, documents })).toMatchObject({
    score: 100,
    rubricVersion: '0.1.0',
    evaluatorVersion: '1.0.0',
  });
  const partial = runDeclarative(grader, { sha: 'c', complete: false, documents });
  expect(partial.score).toBeNull();
  expect(partial.incompleteReason).toBeDefined();
});

test('runDeclarative emits checks in manifest order over path-sorted documents', () => {
  const grader = registerGrader(
    manifest({
      id: 'fieldnote/order-fixture',
      card: { tagline: 'Order', groups: [{ title: 'All', checks: ['readme', 'agents'] }] },
      checks: [
        {
          id: 'readme',
          title: 'R',
          points: 50,
          explain: { pass: 'p', fail: 'f' },
          primitive: 'file-exists',
          args: { root: true, nonempty: true, anyOf: ['README.md'] },
        },
        {
          id: 'agents',
          title: 'A',
          points: 50,
          explain: { pass: 'p', fail: 'f' },
          primitive: 'file-exists',
          args: { root: true, nonempty: true, anyOf: ['AGENTS.md', 'CLAUDE.md'] },
        },
      ],
    }),
  );
  const result = runDeclarative(grader, {
    sha: 'c',
    complete: true,
    documents: [
      { path: 'CLAUDE.md', blobSha: 'c', text: 'c' },
      { path: 'AGENTS.md', blobSha: 'a', text: 'a' },
      { path: 'README.md', blobSha: 'r', text: 'r' },
    ],
  });
  expect(result.checks.map((entry) => entry.id)).toEqual(['readme', 'agents']);
  expect(result.checks[1].paths).toEqual(['AGENTS.md', 'CLAUDE.md']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/domain/grading/registry.test.ts`

Expected: FAIL — unresolved imports.

- [ ] **Step 3: Write the four modules**

```ts
// src/domain/grading/manifest-hash.ts
import { createHash } from 'node:crypto';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}

/**
 * A stable fingerprint of a manifest, so a grade cannot complete against a
 * manifest that changed after the run was queued. Key order is not identity:
 * the same manifest through a JSONB round-trip must hash the same.
 */
export function manifestHash(manifest: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(manifest))).digest('hex');
}
```

```ts
// src/domain/grading/rubric-view.ts
import type { GraderManifest } from './manifest';

export type RubricView = {
  readonly graderId: string;
  readonly version: string;
  readonly evaluatorVersion: string;
  readonly checks: readonly { readonly id: string; readonly maxPoints: number }[];
};

/**
 * The rubric a run is pinned to: the immutable, versioned definition of checks
 * and their points, and nothing operational. Derived from the manifest so the
 * two can never disagree, and stored in grading_rubrics.definition as it
 * always was.
 */
export function rubricView(manifest: GraderManifest): RubricView {
  return Object.freeze({
    graderId: manifest.id,
    version: manifest.version,
    evaluatorVersion: manifest.evaluatorVersion,
    checks: Object.freeze(
      manifest.checks.map((check) => Object.freeze({ id: check.id, maxPoints: check.points })),
    ),
  });
}
```

```ts
// src/domain/grading/declarative.ts
import { runCheck } from './primitives';
import type { GraderManifest } from './manifest';
import type { GradeResult, RepositorySnapshot, SourceDocument } from './types';

// fieldnote's sentence, not the grader's: it describes fieldnote's collection
// failing, which no manifest is in a position to explain.
const INCOMPLETE = 'Repository evidence collection was incomplete.';

function ordered(documents: SourceDocument[]): SourceDocument[] {
  return [...documents].sort(
    (left, right) =>
      left.path.localeCompare(right.path, 'en') || left.blobSha.localeCompare(right.blobSha, 'en'),
  );
}

/**
 * A declarative grader is its manifest. This is the whole engine: sort the
 * evidence once, run each check's primitive in manifest order, sum the points.
 * It never validates — a manifest that reaches here was proven well-formed at
 * registration — and it knows nothing about which grader it is running, which
 * is the only available evidence that the contract is a contract.
 */
export function runDeclarative(
  manifest: GraderManifest,
  snapshot: RepositorySnapshot,
): GradeResult {
  const documents = ordered(snapshot.documents);
  const checks = manifest.checks.map((check) => runCheck(check, documents, manifest.disclaimer));
  return {
    score: snapshot.complete ? checks.reduce((sum, check) => sum + check.points, 0) : null,
    checks,
    rubricVersion: manifest.version,
    evaluatorVersion: manifest.evaluatorVersion,
    ...(snapshot.complete ? {} : { incompleteReason: INCOMPLETE }),
  };
}
```

```ts
// src/domain/grading/registry.ts
import { ManifestError, parseManifest, type GraderManifest } from './manifest';

// Built-ins are registered at boot, the way registerRubric() already works.
// There is no install flow, no publishing and no marketplace in this slice —
// but a built-in grader is an ordinary grader, so it comes through this door
// and gets no private interface behind it.
const graders = new Map<string, GraderManifest>();

export function registerGrader(input: unknown): GraderManifest {
  const manifest = parseManifest(input);
  if (manifest.kind === 'code')
    throw new ManifestError(
      'kind_unsupported',
      `Grader '${manifest.id}' ships code, which is not yet supported.`,
    );
  graders.set(manifest.id, manifest);
  return manifest;
}

export function getGrader(graderId: string): GraderManifest {
  const manifest = graders.get(graderId);
  if (!manifest) throw new ManifestError('unknown_grader', `No grader '${graderId}' is registered.`);
  return manifest;
}

export function graderCheckTitles(graderId: string): Record<string, string> {
  return Object.fromEntries(getGrader(graderId).checks.map((check) => [check.id, check.title]));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/domain/grading/registry.test.ts`

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/grading
git commit -m "feat(grading): the engine, the registry and the rubric a run is pinned to

runDeclarative knows nothing about which grader it is running.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The built-in readiness manifest — the acceptance test

**The slice's load-bearing task.** `readiness-v01.test.ts` must pass unchanged against a readiness grader running entirely through the public contract. Do not open that file to edit it.

**Files:**
- Create: `src/domain/grading/graders/agent-readiness.ts`
- Rewrite: `src/domain/grading/readiness-v01.ts`
- Unchanged and untouched: `src/domain/grading/readiness-v01.test.ts`

**Interfaces:**
- Consumes: `registerGrader`, `runDeclarative`, `rubricView` (Task 6).
- Produces:
  - `AGENT_READINESS = 'fieldnote/agent-readiness'` (from `graders/agent-readiness.ts`)
  - `agentReadinessManifest: GraderManifest` — registered on import of that module.
  - From `readiness-v01.ts`, the compatibility surface the acceptance suite pins: `evaluateReadiness(snapshot)` and `readinessRubric`.

- [ ] **Step 1: Run the acceptance test to confirm it is green before the move**

Run: `pnpm vitest run src/domain/grading/readiness-v01.test.ts`

Expected: PASS. This is the baseline; the same command must pass after Step 3 with the file untouched.

- [ ] **Step 2: Write the manifest**

Every string below is lifted from `readiness-v01.ts` (explanations, disclaimer) and `check-titles.ts` (titles). Nothing is invented except the tagline and the group titles, which come from the spec's YAML.

```ts
// src/domain/grading/graders/agent-readiness.ts
import { registerGrader } from '../registry';

export const AGENT_READINESS = 'fieldnote/agent-readiness';

// fieldnote's own grader, and an ordinary one. It gets no private interface,
// no extra evidence and no code path of its own — which is the only way to
// find out whether the contract is any good before strangers depend on it.
//
// The five checks port exactly from the compiled-in evaluator: same ids, same
// order, same 20 points each, same explanations. The card tagline is new: the
// six per-finish flavour lines this grader used to supply are a deliberate
// loss, recorded in the design. Do not smuggle them back in as a special case.
export const agentReadinessManifest = registerGrader({
  id: AGENT_READINESS,
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'agent-readiness',
  kind: 'declarative',
  needs: {
    'repo.files': ['README.md', 'AGENTS.md', 'CLAUDE.md', 'docs/**/*.{md,markdown}'],
  },
  disclaimer: 'This file and documentation evidence is not semantic quality certification.',
  card: {
    tagline: 'Can an agent work in this repository at all?',
    groups: [
      { title: 'Instructions', checks: ['root-agent-instructions', 'root-readme'] },
      {
        title: 'Documented commands',
        checks: ['docs-markdown', 'documented-setup', 'documented-tests'],
      },
    ],
  },
  checks: [
    {
      id: 'root-agent-instructions',
      title: 'Agent instructions',
      points: 20,
      explain: {
        pass: 'Found root agent instructions.',
        fail: 'No nonempty root AGENTS.md or CLAUDE.md was found.',
      },
      primitive: 'file-exists',
      args: { root: true, nonempty: true, anyOf: ['AGENTS.md', 'CLAUDE.md'] },
    },
    {
      id: 'root-readme',
      title: 'Project documentation',
      points: 20,
      explain: {
        pass: 'Found a root README.md.',
        fail: 'No nonempty root README.md was found.',
      },
      primitive: 'file-exists',
      args: { root: true, nonempty: true, anyOf: ['README.md'], caseInsensitive: true },
    },
    {
      id: 'docs-markdown',
      title: 'Documentation',
      points: 20,
      explain: {
        pass: 'Found Markdown documentation beneath docs/.',
        fail: 'No nonempty Markdown documentation beneath docs/ was found.',
      },
      primitive: 'glob-count',
      args: { pattern: 'docs/**/*.{md,markdown}', caseInsensitive: true, nonempty: true, min: 1 },
    },
    // The scope order is load-bearing: the compiled-in evaluator scanned
    // READMEs, then root agent instructions, then docs, and that order is what
    // a reader of the evidence list sees.
    {
      id: 'documented-setup',
      title: 'Setup instructions',
      points: 20,
      explain: {
        pass: 'Found documented setup commands.',
        fail: 'No documented setup commands were found.',
      },
      primitive: 'heading-has-fence',
      args: {
        headings: ['setup', 'install', 'installation', 'getting started'],
        scope: [
          { pattern: 'README.md', caseInsensitive: true },
          { pattern: '{AGENTS,CLAUDE}.md' },
          { pattern: 'docs/**/*.{md,markdown}', caseInsensitive: true },
        ],
      },
    },
    {
      id: 'documented-tests',
      title: 'Validation commands',
      points: 20,
      explain: {
        pass: 'Found documented test commands.',
        fail: 'No documented test commands were found.',
      },
      primitive: 'heading-has-fence',
      args: {
        headings: ['test', 'testing', 'validation', 'verification', 'checks'],
        scope: [
          { pattern: 'README.md', caseInsensitive: true },
          { pattern: '{AGENTS,CLAUDE}.md' },
          { pattern: 'docs/**/*.{md,markdown}', caseInsensitive: true },
        ],
      },
    },
  ],
});
```

- [ ] **Step 3: Replace the evaluator with bindings over the contract**

`readiness-v01.ts` loses all 247 lines of evaluator and becomes:

```ts
// src/domain/grading/readiness-v01.ts
import { runDeclarative } from './declarative';
import { rubricView } from './rubric-view';
import { agentReadinessManifest } from './graders/agent-readiness';
import type { GradeResult, RepositorySnapshot } from './types';

/**
 * The pre-contract surface of the readiness grader, kept because
 * readiness-v01.test.ts is this slice's acceptance test and must pass
 * unchanged against a grader running entirely through the public contract.
 *
 * Nothing in fieldnote calls these any more: the Inngest function runs
 * runDeclarative(getGrader(run.graderId), …) and every query takes a graderId.
 * `family` is the pre-rename spelling of a grader's unnamespaced name; the
 * column, the parameter and every new caller say grader_id.
 */
export const readinessRubric = Object.freeze({
  ...rubricView(agentReadinessManifest),
  family: agentReadinessManifest.id.split('/')[1],
});

export function evaluateReadiness(snapshot: RepositorySnapshot): GradeResult {
  return runDeclarative(agentReadinessManifest, snapshot);
}
```

- [ ] **Step 4: Run the acceptance test — unchanged**

Run: `git diff --exit-code src/domain/grading/readiness-v01.test.ts && pnpm vitest run src/domain/grading`

Expected: the `git diff` exits 0 (the suite is untouched) and every test passes.

**If any assertion in `readiness-v01.test.ts` fails, the contract is wrong. Fix the contract. Do not edit the test — stop and report instead.** The three most likely culprits, in order: check order in `manifest.checks`; the `heading-has-fence` scope order not reproducing `[...readmes, ...agentInstructions, ...docs]`; case sensitivity on `glob-count`'s `docs/**/*.{md,markdown}`.

- [ ] **Step 5: Commit**

```bash
git add src/domain/grading
git commit -m "feat(grading): the readiness grader is a manifest

evaluateReadiness is no longer an evaluator — it is a binding over
runDeclarative. readiness-v01.test.ts passes unchanged, which is the only
proof available that the contract survives contact with the one grader we
already understand.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `family` becomes `grader_id` in the schema

**Files:**
- Modify: `src/db/schema.ts:621-670`
- Create: `drizzle/0012_*.sql` and its `drizzle/meta` entries, produced by `pnpm db:generate`
- Create: `src/db/grader-id-migration.integration.test.ts`

**Interfaces:**
- Produces: `gradingRubrics.graderId`, `gradingRubrics.manifest` (jsonb, not null), `gradeRuns.graderId`, and `grade_runs_one_active` unique on `(repository_id, grader_id)`.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/db/grader-id-migration.integration.test.ts
import { afterAll, beforeAll, expect, test } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, closeDb } from './index';

beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
});
afterAll(async () => {
  await closeDb();
});

test('both grading tables identify a grader by grader_id, and no family column survives', async () => {
  const rows = [
    ...(await db().execute(sql`
      select table_name, column_name, is_nullable
      from information_schema.columns
      where table_name in ('grade_runs','grading_rubrics')
        and column_name in ('family','grader_id','manifest')
      order by table_name, column_name
    `)),
  ] as { table_name: string; column_name: string; is_nullable: string }[];
  expect(rows.map((row) => `${row.table_name}.${row.column_name}`)).toEqual([
    'grade_runs.grader_id',
    'grading_rubrics.grader_id',
    'grading_rubrics.manifest',
  ]);
  expect(rows.find((row) => row.column_name === 'manifest')?.is_nullable).toBe('NO');
});

test('one active run per grader per repository, not one per repository', async () => {
  const [index] = [
    ...(await db().execute(sql`
      select indexdef from pg_indexes
      where tablename = 'grade_runs' and indexname = 'grade_runs_one_active'
    `)),
  ] as { indexdef: string }[];
  expect(index.indexdef).toMatch(/repository_id/);
  expect(index.indexdef).toMatch(/grader_id/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --config vitest.integration.config.ts src/db/grader-id-migration.integration.test.ts`

Expected: FAIL — `grade_runs.family` is still there and `manifest` is absent. (If Postgres is not up, start it first; the config refuses to run without a `_test` database.)

- [ ] **Step 3: Change the schema**

In `src/db/schema.ts`, `gradingRubrics`:

```ts
export const gradingRubrics = pgTable(
  'grading_rubrics',
  {
    graderId: text('grader_id').notNull(),
    version: text('version').notNull(),
    evaluatorVersion: text('evaluator_version').notNull(),
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    // The full validated manifest. `definition` remains the rubric a run is
    // pinned to — checks and points, nothing operational — and is derived from
    // this, so the two can never disagree.
    manifest: jsonb('manifest').$type<Record<string, unknown>>().notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.graderId, t.version] })],
);
```

In `gradeRuns`, `family: text('family').notNull()` becomes `graderId: text('grader_id').notNull()`, and the unique index becomes:

```ts
    uniqueIndex('grade_runs_one_active')
      .on(t.repositoryId, t.graderId)
      .where(sql`${t.state} IN ('queued','running')`),
```

- [ ] **Step 4: Generate the migration, then rewrite it as a rename**

Run: `pnpm db:generate`. Drizzle-kit will offer to drop-and-add the columns; **that loses every stored grade**. Replace the generated `drizzle/0012_*.sql` body with the SQL below, keeping the generated filename and its `drizzle/meta` entries.

```sql
ALTER TABLE "grading_rubrics" RENAME COLUMN "family" TO "grader_id";--> statement-breakpoint
ALTER TABLE "grade_runs" RENAME COLUMN "family" TO "grader_id";--> statement-breakpoint
UPDATE "grading_rubrics" SET "grader_id" = 'fieldnote/' || "grader_id" WHERE "grader_id" NOT LIKE '%/%';--> statement-breakpoint
UPDATE "grade_runs" SET "grader_id" = 'fieldnote/' || "grader_id" WHERE "grader_id" NOT LIKE '%/%';--> statement-breakpoint
ALTER TABLE "grading_rubrics" ADD COLUMN "manifest" jsonb;--> statement-breakpoint
DELETE FROM "grading_rubrics" WHERE "manifest" IS NULL;--> statement-breakpoint
ALTER TABLE "grading_rubrics" ALTER COLUMN "manifest" SET NOT NULL;--> statement-breakpoint
DROP INDEX "grade_runs_one_active";--> statement-breakpoint
CREATE UNIQUE INDEX "grade_runs_one_active" ON "grade_runs" USING btree ("repository_id","grader_id") WHERE "grade_runs"."state" IN ('queued','running');
```

Two notes for the reviewer, to be repeated as SQL comments in the file:

- A grader id is namespaced by owner, because a marketplace has two people who both want the name `test-coverage`. Existing rows predate the namespace and all belong to fieldnote's own grader.
- Registered rubrics that predate the contract carry no manifest, and no grade can validate against one. `registerRubric()` writes them back on the next request; completed runs are read without re-validation and are unaffected.

If the generated file also renames the primary-key constraint on `grading_rubrics`, keep that statement — the constraint name is cosmetic but should follow the column.

- [ ] **Step 5: Run the migration test to verify it passes**

Run: `pnpm vitest run --config vitest.integration.config.ts src/db/grader-id-migration.integration.test.ts`

Expected: PASS. `pnpm typecheck` will still fail — `grade-runs.ts` is Task 9.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle src/db/grader-id-migration.integration.test.ts
git commit -m "feat(grading): family becomes grader_id, and a rubric carries its manifest

grade_runs_one_active was already the right constraint — one running grade
per grader per repository — under a name chosen when there was only one
value to put in it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Every grade query names its grader

The functions that filtered on `readinessRubric.family` take a `graderId` instead. `latestGrade`, `gradeHistory`, `gradeSummaries` and `latestCompletedGrade` keep today's meaning by being passed the built-in's id **explicitly at each call site**, so the single-grader assumption becomes visible rather than implicit. Spec open question 5 — what the dashboard shows when a repository has four grades — blocks slice 2, not this one.

**Files:**
- Modify: `src/db/queries/grade-runs.ts`
- Modify: `src/app/repos/[repoId]/grading/actions.ts:8`
- Modify: `src/app/repos/[repoId]/page.tsx:53`
- Modify: `src/app/repos/[repoId]/grading/page.tsx:26-30,126-129`
- Modify: `src/db/queries/authoring-runs.ts:35`
- Modify: `src/inngest/functions/plan-repository.ts:47`
- Test: `src/db/grade-runs.integration.test.ts`, `src/app/repos/[repoId]/grading/actions.test.ts:15`

**Interfaces:**
- Consumes: `AGENT_READINESS`, `agentReadinessManifest` (Task 7); `getGrader` (Task 6), `rubricView` (Task 6), `manifestHash` (Task 6).
- Produces: `registerRubric(manifest: GraderManifest)`, `requestGrade(repositoryId, graderId)`, `latestGrade(repositoryId, graderId)`, `gradeHistory(repositoryId, graderId)`, `getGrade(repositoryId, runId, graderId)`, `gradeSummaries(repositoryIds, graderId)`, `latestCompletedGrade(repositoryId, graderId)`. `loadGradeRun`, `beginGrade`, `pinGradeSha`, `completeGrade`, `failGrade` and `listUndispatchedGrades` keep their signatures.

- [ ] **Step 1: Write the failing integration test**

Append to `src/db/grade-runs.integration.test.ts`:

```ts
test('one active run per grader: a second grader may run alongside, the same one may not', async () => {
  const repo = await seed();
  const first = await requestGrade(repo, AGENT_READINESS);
  expect((await requestGrade(repo, AGENT_READINESS)).id).toBe(first.id);
  const other = registerGrader({
    ...agentReadinessManifest,
    id: 'fieldnote/second-fixture',
    card: { ...agentReadinessManifest.card, tagline: 'A second grader, for the index only.' },
  });
  const second = await requestGrade(repo, other.id);
  expect(second.id).not.toBe(first.id);
  expect(await gradeHistory(repo, other.id)).toEqual([]);
  expect((await loadGradeRun(second.id))?.graderId).toBe('fieldnote/second-fixture');
});
```

Add to that file's imports:

```ts
import { AGENT_READINESS, agentReadinessManifest } from '../domain/grading/graders/agent-readiness';
import { registerGrader } from '../domain/grading/registry';
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --config vitest.integration.config.ts src/db/grade-runs.integration.test.ts`

Expected: FAIL — `requestGrade` takes one argument and `run.graderId` does not exist.

- [ ] **Step 3: Thread `graderId` through the queries**

In `src/db/queries/grade-runs.ts`, replace the `readinessRubric` import with:

```ts
import { getGrader } from '../../domain/grading/registry';
import { manifestHash } from '../../domain/grading/manifest-hash';
import { rubricView } from '../../domain/grading/rubric-view';
import type { GraderManifest } from '../../domain/grading/manifest';
```

`registerRubric` persists both the rubric view and the manifest:

```ts
export async function registerRubric(manifest: GraderManifest) {
  const definition = rubricView(manifest);
  await db()
    .insert(gradingRubrics)
    .values({
      graderId: manifest.id,
      version: manifest.version,
      evaluatorVersion: manifest.evaluatorVersion,
      definition,
      manifest,
    })
    .onConflictDoNothing();
  const [stored] = await db()
    .select()
    .from(gradingRubrics)
    .where(
      and(eq(gradingRubrics.graderId, manifest.id), eq(gradingRubrics.version, manifest.version)),
    );
  if (
    !stored ||
    stored.evaluatorVersion !== manifest.evaluatorVersion ||
    manifestHash(stored.definition) !== manifestHash(definition) ||
    manifestHash(stored.manifest) !== manifestHash(manifest)
  )
    throw new Error('Rubric version definition mismatch');
  return stored;
}
```

> `manifestHash` rather than `isDeepStrictEqual` on both comparisons: JSONB returns plain objects with no key-order or `Object.freeze` guarantee, and a canonical hash is the identity test that survives the round-trip. `isDeepStrictEqual` and its `node:util` import are no longer needed in this file.

`requestGrade(repositoryId: string, graderId: string)` — resolve the manifest first and use its fields:

```ts
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
  return db().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${repositoryId}:grade:${graderId}`},0))`,
    );
    // …the rest is unchanged…
```

> The advisory lock key gains the grader id: two graders on one repository must not serialise against each other now that the unique index no longer makes them conflict.

Inside the transaction, every `eq(runs.family, readinessRubric.family)` becomes `eq(runs.graderId, graderId)`, and the insert's values become `graderId, rubricVersion: manifest.version, evaluatorVersion: manifest.evaluatorVersion`.

`latestGrade(repositoryId, graderId)`, `gradeHistory(repositoryId, graderId)`, `getGrade(repositoryId, runId, graderId)`, `latestCompletedGrade(repositoryId, graderId)` and `gradeSummaries(repositoryIds, graderId)` each take the id and substitute `eq(runs.graderId, graderId)` for the `readinessRubric.family` predicate. `latestGrade` forwards its `graderId` to `latestCompletedGrade`.

`validateGradeRun` compares the run against the live manifest and the stored row:

```ts
export async function validateGradeRun(run: GradeRun) {
  const [available] = await db() /* …unchanged… */;
  if (!available || process.env.DEMO_MODE === 'true') throw new Error('Grade access revoked');
  let manifest: GraderManifest;
  try {
    manifest = getGrader(run.graderId);
  } catch {
    throw new Error('Unsupported rubric version');
  }
  const [rubric] = await db()
    .select()
    .from(gradingRubrics)
    .where(
      and(eq(gradingRubrics.graderId, run.graderId), eq(gradingRubrics.version, run.rubricVersion)),
    );
  if (
    !rubric ||
    run.rubricVersion !== manifest.version ||
    run.evaluatorVersion !== manifest.evaluatorVersion ||
    rubric.evaluatorVersion !== run.evaluatorVersion ||
    // A grade must not complete against a manifest that changed after the run
    // was queued.
    manifestHash(rubric.manifest) !== manifestHash(manifest) ||
    manifestHash(rubric.definition) !== manifestHash(rubricView(manifest))
  )
    throw new Error('Unsupported rubric version');
}
```

- [ ] **Step 4: Update every call site to name the built-in explicitly**

Each of these imports `AGENT_READINESS` from the right relative path to `domain/grading/graders/agent-readiness`.

- `src/app/repos/[repoId]/grading/actions.ts:8` → `await requestGrade(repositoryId, AGENT_READINESS)`
- `src/app/repos/[repoId]/page.tsx:53` → `latestGrade(repo.id, AGENT_READINESS)`
- `src/db/queries/authoring-runs.ts:35` → `latestGrade(repositoryId, AGENT_READINESS)`
- `src/inngest/functions/plan-repository.ts:47` → `latestCompletedGrade(run.repositoryId, AGENT_READINESS)`
- `src/app/repos/[repoId]/grading/page.tsx:27-30`:

```ts
    gradeSummaries([repoId], AGENT_READINESS),
    gradeHistory(repoId, AGENT_READINESS),
    run ? getGrade(repoId, run, AGENT_READINESS) : Promise.resolve(null),
```

and the `outdated` expression stops reaching for the legacy rubric:

```tsx
            outdated={
              grade.rubricVersion !== readinessGrader.version ||
              grade.evaluatorVersion !== readinessGrader.evaluatorVersion
            }
```

with `const readinessGrader = getGrader(AGENT_READINESS);` near the top of the component, and the `readinessRubric` import replaced by:

```ts
import { AGENT_READINESS } from '../../../../domain/grading/graders/agent-readiness';
import { getGrader } from '../../../../domain/grading/registry';
```

Update `src/app/repos/[repoId]/grading/actions.test.ts:15`:

```ts
  expect(requestGrade).toHaveBeenCalledWith('repo', 'fieldnote/agent-readiness');
```

In `src/db/grade-runs.integration.test.ts`, pass `AGENT_READINESS` to every `requestGrade`/`latestGrade`/`gradeHistory`/`getGrade`/`gradeSummaries` call, and change the rubric-identity test's fixtures from the rubric to the manifest:

```ts
  await registerRubric(agentReadinessManifest);
  await registerRubric(agentReadinessManifest);
  await expect(registerRubric({ ...agentReadinessManifest, checks: [] })).rejects.toThrow(
    'mismatch',
  );
  const definition = { ...agentReadinessManifest, version: 'future-test' };
  await registerRubric(definition);
```

- [ ] **Step 5: Run the integration suite to verify it passes**

Run: `pnpm vitest run --config vitest.integration.config.ts src/db`

Expected: PASS. `pnpm typecheck` will still fail on `grade-repository.ts` — that is Task 10.

- [ ] **Step 6: Commit**

```bash
git add src/db src/app src/inngest
git commit -m "feat(grading): every grade query names the grader it means

latestGrade and its neighbours keep today's behaviour by being handed the
built-in's id at the call site, which makes the single-grader assumption
visible instead of implicit. What the dashboard shows when a repository has
four grades is slice 2's decision.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: The Inngest function, the demo fixture, and the prose that leaves core

The last compiled-in callers move to the contract, and `check-titles.ts` and `flavour.ts` are deleted.

**Files:**
- Modify: `src/inngest/functions/grade-repository.ts:12-17,53-54`
- Modify: `src/demo/fixtures.ts:1,139`
- Modify: `src/domain/grading/next-tier.ts:3,31`
- Modify: `src/components/grading/grade-card.tsx`
- Modify: `src/components/grading/report.tsx:7,143`
- Modify: `src/components/act/plan-view.tsx:2,26`
- Modify: `src/app/repos/[repoId]/grading/page.tsx`
- Delete: `src/domain/grading/check-titles.ts`, `src/domain/grading/flavour.ts`, `src/domain/grading/flavour.test.ts`
- Test: `src/components/grading/report.test.ts`, `src/demo/fixtures.test.ts`

**Interfaces:**
- Consumes: `getGrader`, `graderCheckTitles`, `runDeclarative` (Task 6); `AGENT_READINESS`, `agentReadinessManifest` (Task 7).
- Produces:
  - `nextTier(score: number, checks: CheckResult[], titles?: Record<string, string>): NextTier | null`
  - `GradeCard({ score, repositoryName, sha, rubricVersion, checks, tagline, checkTitles })`
  - `GradeReport({ grade, owner, name, outdated, checkTitles })`
  - `PlanView({ run, remedies, checkTitles })`

- [ ] **Step 1: Write the failing tests**

In `src/components/grading/report.test.ts`, add near the top:

```ts
import { agentReadinessManifest } from '../../domain/grading/graders/agent-readiness';
import { graderCheckTitles } from '../../domain/grading/registry';

const titles = graderCheckTitles(agentReadinessManifest.id);
const tagline = agentReadinessManifest.card.tagline;
```

Replace the flavour table (lines 105-131) with:

```ts
test.each([
  [0, 'common'],
  [50, 'shimmer'],
  [70, 'bronze'],
  [80, 'silver'],
  [90, 'gold'],
  [100, 'prismatic'],
] as const)('score %s renders the %s finish with the grader tagline', (score, finish) => {
  const html = renderToStaticMarkup(
    createElement(GradeCard, {
      score,
      repositoryName: 'demo/repo',
      sha,
      rubricVersion: '0.1.0',
      checks: score === 100 ? [passingCheck] : [passingCheck, failingCheck],
      tagline,
      checkTitles: titles,
    }),
  );
  expect(html).toContain(`data-finish="${finish}"`);
  // One tagline per grader, at every finish. The six per-finish flavour lines
  // are a deliberate loss: under the contract a grader supplies one sentence,
  // and a special case for the built-in would make the contract a fiction.
  expect(html).toContain('Can an agent work in this repository at all?');
  if (score === 100) {
    expect(html).toContain('No higher tier.');
    expect(html).not.toContain('Next tier');
  }
});
```

Rewrite the last test to run through the contract:

```ts
test('actual grader checks have readable report headings', async () => {
  const { runDeclarative } = await import('../../domain/grading/declarative');
  const evaluated = runDeclarative(agentReadinessManifest, { sha, complete: true, documents: [] });
  const html = renderToStaticMarkup(
    createElement(GradeReport, {
      grade: { ...grade, ...evaluated },
      owner: 'owner',
      name: 'repo',
      outdated: false,
      checkTitles: titles,
    }),
  );
  for (const label of [
    'Agent instructions',
    'Project documentation',
    'Documentation',
    'Setup instructions',
    'Validation commands',
  ])
    expect(html).toContain(label);
  for (const check of evaluated.checks) expect(html).not.toContain(check.id);
});
```

Add `checkTitles: titles` to the two earlier `GradeReport` elements and `tagline` + `checkTitles` to the earlier `GradeCard` element (the `test.each([0, 49, …])` block).

In `src/demo/fixtures.test.ts:20`:

```ts
    const next = nextTier(score, demoGrade.checks, graderCheckTitles(AGENT_READINESS));
```

with `import { AGENT_READINESS } from '../domain/grading/graders/agent-readiness';` and `import { graderCheckTitles } from '../domain/grading/registry';` added.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/components/grading src/demo`

Expected: FAIL — `tagline` and `checkTitles` are not props, and `nextTier` takes two arguments.

- [ ] **Step 3: Move the prose out of core**

`next-tier.ts` — drop the `check-titles` import and take titles as a parameter:

```ts
export function nextTier(
  score: number,
  checks: CheckResult[],
  // Check titles belong to the grader that defined the checks, so a caller
  // supplies them. Defaulting to {} keeps nextTier honest about knowing
  // nothing: an unrecognised check is named by its id, as it always was.
  titles: Record<string, string> = {},
): NextTier | null {
```

and line 31 becomes `title: titles[check.id] ?? check.id,`.

`grade-card.tsx` — drop the `flavour` import, add the two props, pass titles to `nextTier`, and render the tagline in the existing `grade-card-flavour` paragraph (the element and its CSS are untouched; only what it says changes):

```tsx
export function GradeCard({
  score,
  repositoryName,
  sha,
  rubricVersion,
  checks,
  tagline,
  checkTitles,
}: {
  score: number;
  repositoryName: string;
  sha: string;
  rubricVersion: string;
  checks: CheckResult[];
  tagline: string;
  checkTitles: Record<string, string>;
}) {
  const grade = gradePresentation(score);
  const gradient = useId();
  const next = nextTier(score, checks, checkTitles);
```

```tsx
        <p className="grade-card-flavour">{tagline}</p>
```

`report.tsx` — drop the `check-titles` import, add `checkTitles: Record<string, string>` to `GradeReport`'s props, and use it at line 143:

```tsx
            <span>{checkTitles[check.id] ?? check.id}</span>
```

`plan-view.tsx` — the same shape: add `checkTitles: Record<string, string>` to the props and use it at line 26.

`src/app/repos/[repoId]/grading/page.tsx` — supply all three from the grader named at the call site:

```tsx
  const checkTitles = graderCheckTitles(AGENT_READINESS);
```

```tsx
            <GradeCard
              score={grade.score}
              repositoryName={`${repo.owner} / ${repo.name}`}
              sha={grade.sha}
              rubricVersion={grade.rubricVersion}
              checks={grade.checks}
              tagline={readinessGrader.card.tagline}
              checkTitles={checkTitles}
            />
```

and `checkTitles={checkTitles}` on the `GradeReport` element. Find `PlanView`'s render site (`grep -rn "PlanView" src/app src/components`) and pass `checkTitles` there the same way, importing `AGENT_READINESS` and `graderCheckTitles` at that site.

Delete the three files:

```bash
git rm src/domain/grading/check-titles.ts src/domain/grading/flavour.ts src/domain/grading/flavour.test.ts
```

- [ ] **Step 4: Move the Inngest function and the demo fixture onto the contract**

`src/inngest/functions/grade-repository.ts` — replace the `evaluateReadiness` import with:

```ts
import { getGrader } from '../../domain/grading/registry';
import { runDeclarative } from '../../domain/grading/declarative';
```

and rewrite the two lines in `evaluateGradeRun`:

```ts
    const manifest = getGrader(run.graderId);
    // Slice 1 has no evidence broker: collectReadiness supplies repo.files and
    // nothing else, so a manifest that needs anything more must not silently
    // be graded against the files collector. Slice 3 replaces this assertion
    // with the broker.
    if (Object.keys(manifest.needs).join() !== 'repo.files')
      throw new NonRetriableError('Grader needs evidence fieldnote cannot yet collect');
    const snapshot = await collectReadiness(run.repositoryId, run.sha);
    const result = runDeclarative(manifest, snapshot);
```

`src/demo/fixtures.ts` — line 1 and line 139:

```ts
import { runDeclarative } from '../domain/grading/declarative';
import { agentReadinessManifest } from '../domain/grading/graders/agent-readiness';
```

```ts
export const demoGrade = runDeclarative(agentReadinessManifest, {
  sha: demoGradeSha,
  complete: true,
  documents: demoDocuments,
});
```

- [ ] **Step 5: Run the unit suites to verify they pass**

Run: `pnpm vitest run`

Expected: PASS, including `readiness-v01.test.ts` still unedited. Then confirm the prose is gone:

```bash
git diff --exit-code src/domain/grading/readiness-v01.test.ts
grep -rn "An agent will guess" src/ && echo "PROSE STILL IN CORE" || echo "clean"
```

- [ ] **Step 6: Commit**

```bash
git add -A src
git commit -m "feat(grading): the grader's prose leaves fieldnote's core

check-titles.ts and flavour.ts were readiness-specific writing wearing
generic names. Titles are checks[].title; the tagline is card.tagline. The
six per-finish flavour lines are a deliberate, recorded loss — the recovery
path is an optional author slot every grader can use, not a special case
for ours. finish-names.ts stays: a finish is fieldnote's, not any grader's.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Full verification

- [ ] **Step 1: Run the whole check**

Run: `pnpm check`

Expected: lint, typecheck, unit tests, integration tests and build all pass. Paste the tail of the output into the final report; do not claim success without it.

- [ ] **Step 2: Prove the acceptance criterion explicitly**

```bash
git diff --exit-code main -- src/domain/grading/readiness-v01.test.ts && echo "ACCEPTANCE: suite unchanged since main"
grep -rn "evaluateReadiness" src/
grep -rn "rainbow" src/
```

Expected: the diff is empty; the only `evaluateReadiness` hits are its definition in `readiness-v01.ts` and the acceptance suite that imports it — no other fieldnote module calls it; and `rainbow` prints nothing.

- [ ] **Step 3: Report**

Report to the user: the `pnpm check` output, the acceptance-criterion proof above, the three spec-ambiguity decisions from the header of this plan, and the flavour regression as a visible behaviour change.

---

## Self-review

**Spec coverage.** Contract/manifest → Task 4. Invariants (points 100, unique ids, groups cover, `kind: code`, unknown subject) → Tasks 4 and 6. Primitives extracted → Tasks 2, 3, 5, with the per-primitive evidence property test in Task 5. Readiness rubric ported → Task 7. `check-titles.ts` and `flavour.ts` move out, `finish-names.ts` and `next-tier.ts` stay in core → Task 10. `rainbow` → `prismatic` → Task 1. Schema migration → Task 8. Queries take `graderId` → Task 9. Inngest function → Task 10. `validateGradeRun` gains the manifest hash → Task 9. `grade_runs_one_active` under two grader ids → Tasks 8 and 9. Acceptance test unchanged → Tasks 7, 10 and 11.

**Not covered, deliberately:** categories are in the schema but only `agent-readiness` is used (a second grader is slice 2); `mode` is stored and never displayed (the identity strip is slice 2); `needs` is declared and asserted rather than brokered (the broker is slice 3).
