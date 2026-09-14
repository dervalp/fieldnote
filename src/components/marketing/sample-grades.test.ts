import { describe, expect, test } from 'vitest';
import { gradePresentation } from '../../domain/grading/presentation';
import {
  CLIMB_FROM,
  CLIMB_STOPS,
  HERO_SCORE,
  climbCards,
  heroCard,
  ladderCards,
  LADDER_SCORES,
} from './sample-grades';

// The hero's climb is the rubric played back at speed. These tests exist to
// make sure it stays the rubric: the day a threshold moves, the animation is
// supposed to break here rather than quietly show a tier that cannot be
// earned.

describe('climbCards', () => {
  const cards = climbCards();

  test('carries one card per score from the floor to a perfect one, in order', () => {
    expect(cards).toHaveLength(101 - CLIMB_FROM);
    cards.forEach((card, index) => expect(card.score).toBe(CLIMB_FROM + index));
  });

  test('gives every card the finish the rubric gives its score', () => {
    for (const card of cards) {
      const grade = gradePresentation(card.score);
      expect(card.finish).toBe(grade.finish);
      expect(card.label).toBe(grade.label);
      expect(card.color).toBe(grade.color);
      expect(card.count).toBe(grade.count);
    }
  });

  // The whole point of the retimed animation: one beat earns one finish. If a
  // stop ever lands in the same band as the stop before it, a beat animates
  // with nothing to show for itself.
  test('lands each beat on a finish no earlier beat reached', () => {
    const finishes = CLIMB_STOPS.map((score) => cards[score - CLIMB_FROM].finish);
    expect(finishes).toEqual(['bronze', 'silver', 'gold', 'prismatic']);
  });

  test('rests on Shimmer, the tier below the first beat', () => {
    expect(cards[0].finish).toBe('shimmer');
  });

  test('ends the Self-train beat on the card the hero already ships', () => {
    expect(cards[HERO_SCORE - CLIMB_FROM]).toEqual(heroCard());
  });

  test('offers no higher tier once the score is perfect', () => {
    const perfect = cards[100 - CLIMB_FROM];
    expect(perfect.score).toBe(100);
    expect(perfect.next).toBeNull();
  });

  // A move worth 39 points would be a check the rubric does not have. Every
  // move has to be a whole check or a remainder of one.
  test('never offers a move worth more than a single check', () => {
    for (const card of cards) {
      for (const move of card.next?.moves ?? []) {
        expect(move.points).toBeGreaterThan(0);
        expect(move.points).toBeLessThanOrEqual(20);
      }
    }
  });

  test('always names a next tier while one is still unclaimed', () => {
    for (const card of cards.slice(0, -1)) {
      expect(card.next).not.toBeNull();
      expect(card.next?.targetScore).toBeGreaterThan(card.score);
      expect(card.next?.targetScore).toBeLessThanOrEqual(100);
    }
  });
});

// The stops are LADDER_SCORES from Shimmer up. Stated as a test because it is
// the reason the hero and the tier ladder below it agree about what 95 means.
describe('the climb and the ladder', () => {
  test('share their scores', () => {
    expect([CLIMB_FROM, ...CLIMB_STOPS]).toEqual(LADDER_SCORES.slice(1));
  });

  test('still renders one ladder rung per finish', () => {
    const finishes = ladderCards().map((card) => card.finish);
    expect(new Set(finishes).size).toBe(finishes.length);
    expect(finishes).toHaveLength(6);
  });
});
