import type { GradeCardProps, GradeFinish } from '@fieldnote/design-system';
import { describe, expect, it } from 'vitest';
import { gradeBannerProps, gradeCardProps } from './grade-presentation';
import type { GradePresentation } from '../../domain/grading/presentation';
import { gradePresentation } from '../../domain/grading/presentation';
import { finishNames } from '../../domain/grading/finish-names';
import type { CheckResult } from '../../domain/grading/types';
import { AGENT_READINESS } from '../../domain/grading/graders/agent-readiness';

// The package declares its own GradeFinish because it cannot import the
// domain's. This assignment is the pin: if either union gains, loses or
// renames a member, this file stops compiling. A runtime-only check would not
// catch a finish added to one side and not the other until something rendered.
const _pinned: GradeFinish = null as unknown as GradePresentation['finish'];
const _pinnedBack: GradePresentation['finish'] = null as unknown as GradeFinish;
void _pinned;
void _pinnedBack;

const check = (id: string, status: 'pass' | 'fail', maxPoints = 20): CheckResult => ({
  id,
  points: status === 'pass' ? maxPoints : 0,
  maxPoints,
  status,
  paths: [],
  lineRanges: [],
  explanation: '',
});

const props = (score: number, checks: CheckResult[] = []): GradeCardProps =>
  gradeCardProps({
    score,
    repositoryName: 'demo/checkout-service',
    sha: '6b1f0a4abcdef',
    rubricVersion: '0.1.0',
    checks,
    graderId: AGENT_READINESS,
  });

describe('gradeCardProps', () => {
  // The six bands, one score each. A threshold change in the rubric breaks
  // this test, which is the point of driving it from real scores rather than
  // asserting a hand-written table.
  it.each([
    [32, 'common', 'Bad', 'circle', 1],
    [61, 'shimmer', 'Mediocre', 'circle', 1],
    [74, 'bronze', 'Good', 'star', 1],
    [84, 'silver', 'Very good', 'star', 2],
    [95, 'gold', 'Excellent', 'star', 3],
    [100, 'prismatic', 'Excellent', 'star', 3],
  ] as const)('resolves %i to the %s finish', (score, finish, label, symbol, count) => {
    const resolved = props(score, [check('root-readme', 'fail')]);
    expect(resolved.finish).toBe(finish);
    expect(resolved.label).toBe(label);
    expect(resolved.symbol).toBe(symbol);
    expect(resolved.count).toBe(count);
    expect(resolved.color).toBe(gradePresentation(score).color);
  });

  it('covers all six finishes across those six scores, with no duplicate', () => {
    const finishes = [32, 61, 74, 84, 95, 100].map((score) => props(score).finish);
    expect(new Set(finishes).size).toBe(6);
    expect(new Set(finishes)).toEqual(new Set(Object.keys(finishNames)));
  });

  it('reads the user-facing finish name from the domain, not from a copy', () => {
    expect(props(100).finishName).toBe('Prismatic · Perfect score');
    expect(props(84).finishName).toBe(finishNames.silver);
  });

  // Under the grader contract a grader supplies one tagline, not six lines by
  // finish. The landing page's per-band copy lives in marketing and is swapped
  // in there; the product card shows the manifest's sentence at every finish.
  it("carries the grader's tagline, the same at every finish", () => {
    expect(props(32).flavour).toBe('Can an agent work in this repository at all?');
    expect(props(100).flavour).toBe('Can an agent work in this repository at all?');
  });

  it('offers no next tier at 100, whatever the checks say', () => {
    expect(props(100, [check('root-readme', 'fail')]).next).toBeNull();
  });

  it('names the moves that reach the next tier, below 100', () => {
    const next = props(80, [check('documented-tests', 'fail'), check('root-readme', 'pass')]).next;
    expect(next).not.toBeNull();
    expect(next?.targetScore).toBe(100);
    expect(next?.moves.map((move) => move.title)).toEqual(['Validation commands']);
  });

  it('passes repository, rubric and sha through untouched', () => {
    const resolved = props(84);
    expect(resolved.repositoryName).toBe('demo/checkout-service');
    expect(resolved.rubricVersion).toBe('0.1.0');
    expect(resolved.sha).toBe('6b1f0a4abcdef');
  });
});

describe('gradeBannerProps', () => {
  it('agrees with the card about the tier, because it is derived from it', () => {
    const card = props(84);
    const banner = gradeBannerProps(card);
    expect(banner).toEqual({
      score: card.score,
      label: card.label,
      color: card.color,
      symbol: card.symbol,
      count: card.count,
      finish: card.finish,
    });
  });
});
