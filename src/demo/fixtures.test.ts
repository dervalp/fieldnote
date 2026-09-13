import { describe, expect, it, test } from 'vitest';
import { demoGrade, demoDeliveryGrade } from './fixtures';
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
