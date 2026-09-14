import { expect, test } from 'vitest';
import { gradePresentation } from './presentation';
test.each([
  [49, 'common'],
  [50, 'shimmer'],
  [69, 'shimmer'],
  [70, 'bronze'],
  [79, 'bronze'],
  [80, 'silver'],
  [89, 'silver'],
  [90, 'gold'],
  [99, 'gold'],
  [100, 'prismatic'],
])('score %s has finish %s', (score, finish) => {
  expect(gradePresentation(Number(score)).finish).toBe(finish);
});
test.each([-1, 101, 0.5, NaN, Infinity, -Infinity])('rejects invalid score %s', (score) => {
  expect(() => gradePresentation(score)).toThrow();
});
test.each([
  [0, 'Bad', 'circle', 1, '#b54740'],
  [50, 'Mediocre', 'circle', 1, '#548eae'],
  [70, 'Good', 'star', 1, '#895333'],
  [80, 'Very good', 'star', 2, '#697e8d'],
  [90, 'Excellent', 'star', 3, '#a77a13'],
  [100, 'Excellent', 'star', 3, '#7359a3'],
])('score %s has consistent presentation', (score, label, symbol, count, color) => {
  expect(gradePresentation(Number(score))).toMatchObject({ label, symbol, count, color });
});
