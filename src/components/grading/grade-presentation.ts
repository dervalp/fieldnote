import type { GradeCardProps } from '@fieldnote/design-system';
import { gradePresentation } from '../../domain/grading/presentation';
import { finishNames } from '../../domain/grading/finish-names';
import { modeNames } from '../../domain/grading/mode-names';
import { categoryNames } from '../../domain/grading/category-names';
import { nextTier } from '../../domain/grading/next-tier';
import type { GraderManifest } from '../../domain/grading/manifest';
import type { CheckResult } from '../../domain/grading/types';

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
 * The card's line and its check titles are the grader's, not fieldnote's, so
 * they come from the manifest the caller already resolved — this seam
 * resolves nothing of its own any more.
 */
export function gradeCardProps(input: {
  score: number;
  repositoryName: string;
  sha: string;
  rubricVersion: string;
  checks: CheckResult[];
  grader: GraderManifest;
}): GradeCardProps {
  const grade = gradePresentation(input.score);
  const grader = input.grader;
  const checkTitles = Object.fromEntries(grader.checks.map((check) => [check.id, check.title]));
  return {
    score: input.score,
    finish: grade.finish,
    label: grade.label,
    color: grade.color,
    symbol: grade.symbol,
    count: grade.count,
    finishName: finishNames[grade.finish],
    flavour: grader.card.tagline,
    title: grader.card.title,
    // owner/name. A marketplace has two people who both want the name
    // test-coverage, so the owner is part of the identity, not decoration.
    author: grader.id.split('/')[0],
    mode: modeNames[grader.mode],
    category: categoryNames[grader.category],
    next: nextTier(input.score, input.checks, checkTitles),
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
