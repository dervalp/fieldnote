import { expect, test } from 'vitest';
import { consentSentences, needsHash } from './needs-consent';

const files = { 'repo.files': ['README.md', 'docs/**/*.md'] } as const;
const tree = { 'repo.tree': ['**/*'] } as const;
const metrics = {
  'fieldnote.metrics': { windowDays: 30, minMergedPullRequests: 10, insufficientReason: 'Quiet.' },
} as const;

test('the same needs hash the same however the keys were ordered', () => {
  expect(needsHash({ ...files, ...tree })).toBe(needsHash({ ...tree, ...files }));
});

test('a widened need hashes differently', () => {
  expect(needsHash({ 'repo.files': ['README.md'] })).not.toBe(needsHash(files));
  expect(needsHash(files)).not.toBe(needsHash({ ...files, ...tree }));
});

test('every declared family produces one sentence, in a fixed order', () => {
  expect(consentSentences({ ...files, ...tree, ...metrics })).toEqual([
    'The contents of files matching README.md, docs/**/*.md',
    'The list of file names in your repositories',
    'Your merged pull request and CI record over 30 days',
  ]);
  expect(consentSentences(tree)).toEqual(['The list of file names in your repositories']);
});
