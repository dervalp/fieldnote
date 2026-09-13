import { expect, test } from 'vitest';
import { globToRegExp } from './glob';

const matches = (pattern: string, path: string, ci = false) => globToRegExp(pattern, ci).test(path);

test('a literal pattern matches only itself', () => {
  expect(matches('AGENTS.md', 'AGENTS.md')).toBe(true);
  expect(matches('AGENTS.md', 'agents.md')).toBe(false);
  expect(matches('AGENTS.md', 'docs/AGENTS.md')).toBe(false);
  expect(matches('AGENTS.md', 'AGENTSxmd')).toBe(false); // the dot is literal
});

test('caseInsensitive relaxes the whole pattern', () => {
  expect(matches('README.md', 'readME.MD', true)).toBe(true);
  expect(matches('docs/**/*.{md,markdown}', 'DOCS/guide.MARKDOWN', true)).toBe(true);
});

test('** spans zero or more directories and * stays inside one segment', () => {
  expect(matches('docs/**/*.md', 'docs/guide.md')).toBe(true);
  expect(matches('docs/**/*.md', 'docs/a/b/guide.md')).toBe(true);
  expect(matches('docs/**/*.md', 'notdocs/guide.md')).toBe(false);
  expect(matches('docs/*.md', 'docs/a/guide.md')).toBe(false);
});

test('brace alternation offers each branch', () => {
  expect(matches('*.{md,markdown}', 'x.md')).toBe(true);
  expect(matches('*.{md,markdown}', 'x.markdown')).toBe(true);
  expect(matches('*.{md,markdown}', 'x.txt')).toBe(false);
  expect(matches('{AGENTS,CLAUDE}.md', 'CLAUDE.md')).toBe(true);
  expect(matches('{AGENTS,CLAUDE}.md', 'README.md')).toBe(false);
});

test('regex metacharacters in a pattern are literal', () => {
  expect(matches('a+b(c).md', 'a+b(c).md')).toBe(true);
  expect(matches('a+b(c).md', 'aab c.md')).toBe(false);
});

test('? matches one character but never a separator', () => {
  expect(matches('doc?.md', 'docs.md')).toBe(true);
  expect(matches('doc?.md', 'doc/.md')).toBe(false);
});
