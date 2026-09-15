import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

// The public page, badge and share image read this module and nothing else.
// It must not be able to reach a session: a public request has none, and a
// query that silently requires one would 500 for every visitor — or worse,
// resolve the *developer's* session in a test and pass.
//
// Grepping one file's own text could never say that. A query module one import
// away — grade-runs, grade-schedules, public-grade-settings — pulls in
// workspaces/access and auth/session, so the constraint is about the whole
// graph. This walks it.

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../../..');

// `import x from 'y'`, `import 'y'`, `export … from 'y'` and `import('y')`. The
// clause between the keyword and the specifier never contains a quote, which is
// what stops a bare `import 'y';` from being swallowed by the next line's
// ` from `.
const SPECIFIER =
  /(?:^|[\s;{}()])(?:import|export)\s*(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
// A commented-out import is not an import. Block comments and whole-line `//`
// comments only: enough for this codebase, and it never touches a URL inside a
// string, which is the thing a greedier strip would break.
const withoutComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

/** The forbidden modules, by the path they resolve to or the package they are. */
const isForbiddenFile = (path: string) =>
  /(?:^|\/)(?:auth\/session|workspaces\/access)\.tsx?$/.test(path);
const FORBIDDEN_PACKAGES = ['next/headers', 'next/navigation'];

/** TypeScript's own resolution, narrowed to what this repository actually writes. */
function resolveModule(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier.replace(/\.js$/, ''));
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    base,
  ])
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  // A stylesheet, a JSON file or a bare asset: nothing to walk into.
  return null;
}

/**
 * Every file `entry` can reach, and every chain that ends in a module a public
 * request must not be able to reach. A chain is named in full, so a failure
 * says which import to cut.
 */
export function walk(entry: string): { files: string[]; chains: string[] } {
  const name = (path: string) => relative(repositoryRoot, path);
  const chains: string[] = [];
  const seen = new Set<string>();
  const queue: { file: string; chain: string[] }[] = [{ file: entry, chain: [name(entry)] }];
  while (queue.length) {
    const { file, chain } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of withoutComments(readFileSync(file, 'utf8')).matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2];
      if (!specifier.startsWith('.')) {
        // A bare specifier is a package: only the two Next request-time modules
        // matter, and neither has a graph worth walking.
        if (FORBIDDEN_PACKAGES.includes(specifier)) chains.push([...chain, specifier].join(' → '));
        continue;
      }
      const target = resolveModule(file, specifier);
      if (!target) continue;
      const next = [...chain, name(target)];
      if (isForbiddenFile(name(target))) chains.push(next.join(' → '));
      queue.push({ file: target, chain: next });
    }
  }
  return { files: [...seen].map(name), chains };
}

const entry = resolve(here, 'public-grades.ts');

test('the public lookup cannot reach a session, directly or transitively', () => {
  expect(walk(entry).chains).toEqual([]);
});

test('the walk goes past the entry file', () => {
  // A guard that only reads one file would pass the test above by doing
  // nothing. These are modules public-grades.ts reaches through its own
  // imports, one and two steps out.
  const { files } = walk(entry);
  expect(files).toContain('src/db/index.ts');
  expect(files).toContain('src/domain/grading/registry.ts');
  expect(files).toContain('src/domain/grading/graders/agent-readiness.ts');
});

test('the walk names a session two imports away', () => {
  // And a guard that cannot fail is not a guard. The sibling query modules the
  // public lookup deliberately does not call all reach a session; this is what
  // the failure above would read like.
  const { chains } = walk(resolve(here, 'grade-runs.ts'));
  expect(chains).toContain(
    'src/db/queries/grade-runs.ts → src/workspaces/access.ts → src/auth/session.ts',
  );
  expect(chains.some((chain) => chain.endsWith('next/headers'))).toBe(true);
});
