import { gradePresentation } from './presentation';
import { finishNames } from './finish-names';
import type { CheckResult } from './types';
export interface Move {
  id: string;
  title: string;
  points: number;
}
export interface NextTier {
  targetScore: number;
  targetFinish: string;
  moves: Move[];
}
export function nextTier(
  score: number,
  checks: CheckResult[],
  // Check titles belong to the grader that defined the checks, so a caller
  // supplies them. Defaulting to {} keeps nextTier honest about knowing
  // nothing: an unrecognised check is named by its id, as it always was.
  titles: Record<string, string> = {},
): NextTier | null {
  // "There is no higher tier" is a claim about the score, not about the
  // checks. Under today's binary 5x20 rubric a perfect score and zero failing
  // checks coincide, so guarding on either looked the same; under the
  // finer-grained rubric the design doc names as the natural direction they
  // come apart, and a card at 100 with a failing partial-credit check must not
  // be offered a "next tier" it is already standing on.
  if (score >= 100) return null;
  const failing = checks.filter((check) => check.status === 'fail');
  // Below 100 with nothing failing there is no move to name — not the same
  // statement as the guard above, but the same empty result.
  if (failing.length === 0) return null;
  const moves = [...failing]
    .sort((a, b) => b.maxPoints - a.maxPoints)
    .map((check) => ({
      id: check.id,
      title: titles[check.id] ?? check.id,
      points: check.maxPoints,
    }));
  const currentFinish = gradePresentation(score).finish;
  let accumulated = 0;
  let targetScore = score;
  for (const move of moves) {
    accumulated += move.points;
    targetScore = Math.min(100, score + accumulated);
    if (gradePresentation(targetScore).finish !== currentFinish) break;
  }
  const targetFinish = finishNames[gradePresentation(targetScore).finish].split(' · ')[0];
  return { targetScore, targetFinish, moves };
}
