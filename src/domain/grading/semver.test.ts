import { expect, test } from 'vitest';
import { compareVersions, isNewerVersion } from './semver';

test('compares numerically, not lexicographically', () => {
  expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
  expect(compareVersions('0.9.0', '0.10.0')).toBeLessThan(0);
});

test('compares major, then minor, then patch, in that order', () => {
  expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
  expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0);
  expect(compareVersions('0.1.2', '0.1.1')).toBeGreaterThan(0);
});

test('equal versions compare to zero', () => {
  expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
});

test.each([
  ['0.10.0', '0.9.0', true],
  ['0.9.0', '0.10.0', false],
  ['0.2.0', '0.1.0', true],
  ['0.1.0', '0.2.0', false],
  ['0.1.0', '0.1.0', false],
])('isNewerVersion(%s, %s) is %s', (candidate, installed, expected) => {
  expect(isNewerVersion(candidate, installed)).toBe(expected);
});
