import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { source } from './source.generated';

test('the embedded program is grader.mjs, byte for byte', () => {
  expect(source).toBe(readFileSync(new URL('./grader.mjs', import.meta.url), 'utf8'));
});
