import { describe, expect, it } from 'vitest';
import { LADDER_SCORES, ladderCards } from './sample-grades';
import { finishNames } from '../../domain/grading/finish-names';
import { gradePresentation } from '../../domain/grading/presentation';

// The ladder must not be able to advertise a tier the rubric cannot issue.
// Every rung is derived by putting its score through gradePresentation, so
// these assertions are really about that derivation staying in place — if
// someone replaces it with a hand-written table, the table will disagree with
// the rubric here rather than in production.

describe('the tier ladder', () => {
  const rungs = ladderCards();

  it('renders six rungs, one per finish, with no duplicate', () => {
    expect(rungs).toHaveLength(6);
    expect(new Set(rungs.map((rung) => rung.finish)).size).toBe(6);
  });

  it('is in ascending score order', () => {
    const scores = rungs.map((rung) => rung.score);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    expect(scores).toEqual([...LADDER_SCORES]);
  });

  it('covers exactly the finishes the domain defines', () => {
    expect(new Set(rungs.map((rung) => rung.finish))).toEqual(new Set(Object.keys(finishNames)));
  });

  it('claims no tier the rubric would not produce for that score', () => {
    for (const rung of rungs) {
      const truth = gradePresentation(rung.score);
      expect(rung.finish).toBe(truth.finish);
      expect(rung.label).toBe(truth.label);
      expect(rung.color).toBe(truth.color);
      expect(rung.count).toBe(truth.count);
      expect(rung.symbol).toBe(truth.symbol);
    }
  });

  // The identifier and the name a reader sees are both Prismatic now. The top
  // rung is the one place that could plausibly still leak the old `rainbow`.
  it('puts Prismatic last, and calls it Prismatic', () => {
    const top = rungs.at(-1);
    expect(top?.score).toBe(100);
    expect(top?.finish).toBe('prismatic');
    expect(top?.finishName.split(' · ')[0]).toBe('Prismatic');
    expect(rungs.map((rung) => rung.finishName.split(' · ')[0])).not.toContain('rainbow');
  });
});
