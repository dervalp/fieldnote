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
