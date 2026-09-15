import type { GradeCardProps } from '@fieldnote/design-system';
import { gradePresentation } from '../../domain/grading/presentation';
import { finishNames } from '../../domain/grading/finish-names';
import { modeNames } from '../../domain/grading/mode-names';
import { categoryNames } from '../../domain/grading/category-names';
import { nextTier } from '../../domain/grading/next-tier';
import type { GraderManifest } from '../../domain/grading/manifest';
import type { CheckResult } from '../../domain/grading/types';

/**
 * Exactly what the card needs to know about a grader: its identity line, its
 * mode and category, and its checks' titles — never the full manifest.
 * `PublicGrader` (src/domain/grading/public-grade.ts) already carries this
 * shape once `tagline` is on it, so the public page passes its redacted view
 * straight through; graderCardIdentity() below is the same reduction for a
 * caller holding a full GraderManifest.
 */
export type GraderCardIdentity = {
  id: string;
  title: string;
  tagline: string;
  author: string;
  mode: GraderManifest['mode'];
  category: GraderManifest['category'];
  checkTitles: Record<string, string>;
};

/** The reduction internal callers apply before calling gradeCardProps —
 *  never gradeCardProps itself, which must not need a GraderManifest to
 *  compile against. */
export function graderCardIdentity(manifest: GraderManifest): GraderCardIdentity {
  return {
    id: manifest.id,
    title: manifest.card.title,
    tagline: manifest.card.tagline,
    // owner/name. A marketplace has two people who both want the name
    // test-coverage, so the owner is part of the identity, not decoration.
    author: manifest.id.split('/')[0],
    mode: manifest.mode,
    category: manifest.category,
    checkTitles: Object.fromEntries(manifest.checks.map((check) => [check.id, check.title])),
  };
}

/**
 * The only place the grading domain meets the design system.
 *
 * `GradeCard` moved into @fieldnote/design-system so the product and the
 * landing page render the same component. The rubric did not move: thresholds
 * and finish names are domain knowledge, tested where they live. This function
 * resolves them once and hands the card a plain prop bag.
 *
 * No component calls gradePresentation, finishNames or nextTier directly any
 * more. That is the point — one seam, not four.
 *
 * `grader` is a structural subset, not a GraderManifest: a public caller
 * holds only PublicGrader (never `needs`, never a program's source, never the
 * full checks array) and must be able to call this without widening what it
 * carries. An internal caller reduces its manifest through
 * graderCardIdentity() first.
 */
export function gradeCardProps(input: {
  score: number;
  repositoryName: string;
  sha: string;
  rubricVersion: string;
  checks: CheckResult[];
  grader: GraderCardIdentity;
}): GradeCardProps {
  const grade = gradePresentation(input.score);
  const grader = input.grader;
  return {
    score: input.score,
    finish: grade.finish,
    label: grade.label,
    color: grade.color,
    symbol: grade.symbol,
    count: grade.count,
    finishName: finishNames[grade.finish],
    flavour: grader.tagline,
    title: grader.title,
    author: grader.author,
    mode: modeNames[grader.mode],
    category: categoryNames[grader.category],
    next: nextTier(input.score, input.checks, grader.checkTitles),
    repositoryName: input.repositoryName,
    rubricVersion: input.rubricVersion,
    sha: input.sha,
  };
}

/**
 * The banner takes the same finish, minus everything it has no room for.
 * Derived from the card's props rather than from the score a second time, so
 * the two cannot disagree about what a score means.
 */
export function gradeBannerProps(props: GradeCardProps) {
  const { score, label, color, symbol, count, finish } = props;
  return { score, label, color, symbol, count, finish };
}
