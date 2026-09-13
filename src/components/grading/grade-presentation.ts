import type { GradeCardProps } from '@fieldnote/design-system';
import { gradePresentation } from '../../domain/grading/presentation';
import { finishNames } from '../../domain/grading/finish-names';
import { nextTier } from '../../domain/grading/next-tier';
import { getGrader, graderCheckTitles } from '../../domain/grading/registry';
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
 * they come from the manifest `graderId` names. The caller names the grader
 * rather than the seam assuming one: there is exactly one today, and that
 * assumption should be visible where it is made.
 */
export function gradeCardProps(input: {
  score: number;
  repositoryName: string;
  sha: string;
  rubricVersion: string;
  checks: CheckResult[];
  graderId: string;
}): GradeCardProps {
  const grade = gradePresentation(input.score);
  const grader = getGrader(input.graderId);
  return {
    score: input.score,
    finish: grade.finish,
    label: grade.label,
    color: grade.color,
    symbol: grade.symbol,
    count: grade.count,
    finishName: finishNames[grade.finish],
    flavour: grader.card.tagline,
    next: nextTier(input.score, input.checks, graderCheckTitles(input.graderId)),
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
