import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// The public page, badge and share image read this module and nothing else.
// It must not be able to reach a session: a public request has none, and a
// query that silently requires one would 500 for every visitor — or worse,
// resolve the *developer's* session in a test and pass.
test('the public lookup imports no session and no workspace access', () => {
  const source = readFileSync(new URL('./public-grades.ts', import.meta.url), 'utf8');
  expect(source).not.toContain('auth/session');
  expect(source).not.toContain('workspaces/access');
  expect(source).not.toContain('next/headers');
});
