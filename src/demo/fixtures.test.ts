import { describe, expect, it } from 'vitest';
import { demoGrade } from './fixtures';
import { gradePresentation } from '../domain/grading/presentation';
import { nextTier } from '../domain/grading/next-tier';
import { AGENT_READINESS } from '../domain/grading/graders/agent-readiness';
import { graderCheckTitles } from '../domain/grading/registry';
describe('demoGrade', () => {
  it('grades the demo documents at 80, failing only documented-tests', () => {
    expect(demoGrade.score).toBe(80);
    expect(demoGrade.checks.filter((check) => check.status === 'fail').map((c) => c.id)).toEqual([
      'documented-tests',
    ]);
  });
  it('lands the card on a Silver finish one move short of perfect', () => {
    // The seeded score is chosen for what it makes the card show. Silver keeps
    // the flavour line and the next-tier block on screen; a single failing
    // check keeps that block down to one honest move. Both are assertions
    // about the demo, not about the rubric — the rubric's own arithmetic is
    // covered by presentation.test.ts and next-tier.test.ts.
    const score = demoGrade.score!;
    expect(gradePresentation(score).finish).toBe('silver');
    const next = nextTier(score, demoGrade.checks, graderCheckTitles(AGENT_READINESS));
    expect(next?.targetFinish).toBe('Prismatic');
    expect(next?.targetScore).toBe(100);
    expect(next?.moves.map((move) => move.title)).toEqual(['Validation commands']);
  });
});
