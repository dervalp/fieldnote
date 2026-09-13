import { expect, test } from 'vitest';
import { modeNames } from './mode-names';
import { categoryNames } from './category-names';
import { GRADER_CATEGORIES } from './manifest';

test('every mode has a user-facing name', () => {
  expect(modeNames).toEqual({
    deterministic: 'Deterministic',
    llm: 'Model-judged',
    hybrid: 'Hybrid',
  });
});

test('every category has one too, and none is a slug', () => {
  for (const category of GRADER_CATEGORIES) {
    expect(categoryNames[category]).toBeTruthy();
    expect(categoryNames[category]).not.toContain('-');
  }
});
