import { expect, test } from 'vitest';
import grade from './grader.mjs';

type Answer = {
  checks: { id: string; status: string; paths?: string[]; count?: { matched: number; of: number } }[];
  insufficient?: true;
};
const run = (...paths: string[]) =>
  grade({ tree: paths.map((path) => ({ path, size: 1 })) }) as Answer;
const check = (answer: Answer, id: string) => answer.checks.find((c) => c.id === id)!;

test('a well-tested repository passes every check', () => {
  const answer = run(
    'src/billing/invoice.ts',
    'src/billing/invoice.test.ts',
    'src/billing/tax.ts',
    'src/billing/tax.test.ts',
    'src/auth/session.ts',
    'src/auth/session.spec.ts',
    'src/auth/token.ts',
    'src/auth/token.test.ts',
    'src/index.ts',
    'src/index.test.ts',
  );
  expect(answer.insufficient).toBeUndefined();
  expect(answer.checks.map((c) => [c.id, c.status])).toEqual([
    ['tests-exist', 'pass'],
    ['tests-beside-source', 'pass'],
    ['tests-in-every-folder', 'pass'],
  ]);
  expect(check(answer, 'tests-beside-source').count).toEqual({ matched: 5, of: 5 });
  // src/billing, src/auth, and src itself for src/index.ts.
  expect(check(answer, 'tests-in-every-folder').count).toEqual({ matched: 3, of: 3 });
});

test('no tests fails every check', () => {
  const answer = run('src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts');
  expect(answer.checks.map((c) => c.status)).toEqual(['fail', 'fail', 'fail']);
  expect(check(answer, 'tests-exist').paths).toEqual([]);
  expect(check(answer, 'tests-beside-source').count).toEqual({ matched: 0, of: 5 });
});

test('half the source files having a test is enough', () => {
  const answer = run(
    'lib/a.ts', 'lib/a.test.ts', 'lib/b.ts', 'lib/b.test.ts', 'lib/c.ts', 'lib/c.test.ts',
    'lib/d.ts', 'lib/e.ts', 'lib/f.ts',
  );
  expect(check(answer, 'tests-beside-source')).toMatchObject({
    status: 'pass',
    count: { matched: 3, of: 6 },
  });
});

test('one folder without tests fails tests-in-every-folder', () => {
  const answer = run(
    'packages/api/a.ts', 'packages/api/a.test.ts', 'packages/api/b.ts', 'packages/api/b.test.ts',
    'packages/web/c.ts', 'packages/web/d.ts',
  );
  expect(check(answer, 'tests-in-every-folder')).toMatchObject({
    status: 'fail',
    count: { matched: 1, of: 2 },
  });
});

test("each language's test naming is recognised", () => {
  const answer = run(
    'pkg/store.go', 'pkg/store_test.go',
    'app/models.py', 'app/test_models.py',
    'app/views.py', 'app/views_test.py',
    'lib/user.rb', 'lib/user_spec.rb',
    'core/Parser.java', 'core/ParserTest.java',
    'web/View.kt', 'web/ViewTests.kt',
    'ui/button.tsx', 'ui/__tests__/button.tsx',
  );
  expect(check(answer, 'tests-beside-source').count).toEqual({ matched: 7, of: 7 });
});

test('excluded directories, declarations, config and dotfiles are not source', () => {
  const answer = run(
    'node_modules/x/index.js', 'dist/app.js', 'build/out.js', 'vendor/lib.go', 'coverage/lcov.js',
    '.github/scripts/run.js', 'types/global.d.ts', 'vite.config.ts', '.eslintrc.js', 'README.md',
    'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts',
  );
  expect(check(answer, 'tests-beside-source').count).toEqual({ matched: 0, of: 5 });
});

test('fewer than five source files is insufficient, and every check is still reported', () => {
  const answer = run('src/a.ts', 'src/a.test.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts');
  expect(answer.insufficient).toBe(true);
  expect(answer.checks).toHaveLength(3);
});

test('paths are capped at twenty and never repeated', () => {
  const paths = Array.from({ length: 30 }, (_, i) => [`src/m${i}.ts`, `src/m${i}.test.ts`]).flat();
  const answer = run(...paths);
  for (const c of answer.checks) {
    expect(c.paths!.length).toBeLessThanOrEqual(20);
    expect(new Set(c.paths).size).toBe(c.paths!.length);
  }
});
