import { expect, test } from 'vitest';
import { changesOverTime } from '../manifest';
import { TEST_DISCIPLINE, testDisciplineManifest } from './test-discipline';
import { source } from './test-discipline/source.generated';

test('test-discipline is an ordinary code grader over the file list', () => {
  expect(testDisciplineManifest.id).toBe(TEST_DISCIPLINE);
  expect(testDisciplineManifest).toMatchObject({
    version: '0.1.0',
    evaluatorVersion: '1.0.0',
    subject: 'repository',
    mode: 'deterministic',
    category: 'test-discipline',
    kind: 'code',
    needs: { 'repo.tree': ['**/*'] },
  });
  expect(changesOverTime(testDisciplineManifest)).toBe(false);
  if (testDisciplineManifest.kind !== 'code') throw new Error('expected a code grader');
  expect(testDisciplineManifest.code.source).toBe(source);
  expect(testDisciplineManifest.checks.map((check) => [check.id, check.points])).toEqual([
    ['tests-exist', 20],
    ['tests-beside-source', 40],
    ['tests-in-every-folder', 40],
  ]);
});
