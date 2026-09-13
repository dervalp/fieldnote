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
  | 'kind_unsupported'
  | 'unknown_grader'
  | 'points_not_100'
  | 'duplicate_check_id'
  | 'check_not_grouped'
  | 'check_grouped_twice'
  | 'unknown_check_grouped'
  | 'needs_empty'
  | 'needs_mismatch';

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
  // Appended to every explanation. The caveat is the grader's, not fieldnote's.
  disclaimer: nonEmpty,
  card: z.object({
    title: nonEmpty,
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

  const declared = Object.entries(manifest.needs)
    .filter(([, value]) => value !== undefined)
    .map(([family]) => family) as Array<'repo.files' | 'fieldnote.metrics'>;
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

  return manifest;
}
