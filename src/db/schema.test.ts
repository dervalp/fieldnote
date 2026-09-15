import { expect, test } from 'vitest';
import { graders, graderVersions, graderInstalls, users, workspaces } from './schema';
import * as schema from './schema';

test('the registry tables exist with the columns the slice needs', () => {
  expect(Object.keys(graders)).toEqual(expect.arrayContaining(['id', 'ownedByWorkspaceId']));
  expect(Object.keys(graderVersions)).toEqual(
    expect.arrayContaining([
      'graderId',
      'version',
      'manifest',
      'evaluatorVersion',
      'publishedBy',
      'publishedAt',
      'verifiedAt',
      'verifiedBy',
      'withdrawnAt',
      'withdrawnNote',
    ]),
  );
  expect(Object.keys(graderInstalls)).toEqual(
    expect.arrayContaining(['workspaceId', 'graderId', 'version', 'installedBy', 'consentedNeeds']),
  );
  expect(Object.keys(workspaces)).toContain('handle');
  expect(Object.keys(users)).toContain('staff');
});

test('grading_rubrics is gone: grader_versions is the immutable manifest per version', () => {
  expect('gradingRubrics' in schema).toBe(false);
});
