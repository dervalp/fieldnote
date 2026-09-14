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

// Closed for the same reason GRADER_CATEGORIES is closed, and extracted
// rather than invented: all three are read off MetricTotals today and
// rendered on the Delivery tab.
export const GRADER_METRICS = ['first-pass-rate', 'ci-success-rate', 'ci-recovery-rate'] as const;
export type GraderMetric = (typeof GRADER_METRICS)[number];

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

export function parseManifest(input: unknown): GraderManifest {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) throw new ManifestError('schema', parsed.error.message);
  const manifest = parsed.data;

  if (manifest.subject !== 'repository' && manifest.subject !== 'repository_window')
    throw new ManifestError(
      'subject_unsupported',
      `Subject '${manifest.subject}' is not yet supported; v1 grades a repository or a window over one.`,
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
