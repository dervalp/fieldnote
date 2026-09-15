// fieldnote/test-discipline. Runs inside the grading sandbox, which holds this
// file, fieldnote's runner and the evidence, and nothing else — so it imports
// nothing. It reads file names, never file contents.
//
// Every rule below is this grader's judgement. Changing one is a version bump,
// because a repository's score would move underneath it.

const SOURCE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rb', 'java', 'kt', 'rs', 'cs', 'php', 'swift',
]);
const EXCLUDED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'coverage']);
const TEST_DIRECTORIES = new Set(['__tests__', 'test', 'tests', 'spec']);
// A folder under one of these is a package or a module in its own right.
const CONTAINERS = new Set(['src', 'packages', 'apps', 'services', 'libs', 'lib']);
const MIN_SOURCE_FILES = 5;
const MAX_PATHS = 20;

function extension(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function isTestName(name) {
  const lower = name.toLowerCase();
  return (
    /\.(test|spec)\./.test(lower) ||
    lower.endsWith('_test.go') ||
    /^test_.*\.py$/.test(lower) ||
    /_test\.py$/.test(lower) ||
    /Tests?\.(java|kt)$/.test(name) ||
    lower.endsWith('_spec.rb')
  );
}

// A file's name with its extension and any test marker removed, lower-cased:
// invoice.ts, invoice.test.ts and InvoiceTest.java all have the stem "invoice".
function stem(name) {
  const ext = extension(name);
  let base = name.slice(0, name.length - ext.length - 1);
  if (ext === 'java' || ext === 'kt') base = base.replace(/Tests?$/, '');
  return base
    .toLowerCase()
    .replace(/\.(test|spec)$/, '')
    .replace(/_(test|spec)$/, '')
    .replace(/^test_/, '');
}

function classify(path) {
  const segments = path.split('/');
  const name = segments[segments.length - 1];
  const directories = segments.slice(0, -1);
  if (directories.some((directory) => directory.startsWith('.') || EXCLUDED_DIRECTORIES.has(directory)))
    return null;
  if (name.startsWith('.')) return null;
  if (!SOURCE_EXTENSIONS.has(extension(name))) return null;
  if (name.toLowerCase().endsWith('.d.ts')) return null;
  if (isTestName(name) || directories.some((directory) => TEST_DIRECTORIES.has(directory))) return 'test';
  if (/\.config\./i.test(name)) return null;
  return 'source';
}

function folderOf(path) {
  const segments = path.split('/');
  if (segments.length === 1) return '';
  if (CONTAINERS.has(segments[0]) && segments.length > 2) return `${segments[0]}/${segments[1]}`;
  return segments[0];
}

const basename = (path) => path.slice(path.lastIndexOf('/') + 1);
const byCodeUnit = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

export default function grade(evidence) {
  const sources = [];
  const tests = [];
  for (const { path } of evidence.tree) {
    const kind = classify(path);
    if (kind === 'source') sources.push(path);
    else if (kind === 'test') tests.push(path);
  }

  const testsByStem = new Map();
  for (const path of tests) {
    const key = stem(basename(path));
    testsByStem.set(key, [...(testsByStem.get(key) ?? []), path]);
  }

  const matchedTests = new Set();
  const folders = new Map();
  let matched = 0;
  for (const path of sources) folders.set(folderOf(path), new Set());
  for (const path of tests) folders.get(folderOf(path))?.add(path);
  for (const path of sources) {
    const hits = testsByStem.get(stem(basename(path)));
    if (!hits) continue;
    matched += 1;
    for (const hit of hits) {
      matchedTests.add(hit);
      folders.get(folderOf(path)).add(hit);
    }
  }

  const folderEvidence = [];
  let foldersWithTests = 0;
  for (const [, evidenceForFolder] of [...folders.entries()].sort(([left], [right]) => byCodeUnit(left, right))) {
    if (evidenceForFolder.size === 0) continue;
    foldersWithTests += 1;
    folderEvidence.push([...evidenceForFolder].sort(byCodeUnit)[0]);
  }

  return {
    checks: [
      {
        id: 'tests-exist',
        status: tests.length > 0 ? 'pass' : 'fail',
        paths: tests.slice(0, MAX_PATHS),
      },
      {
        id: 'tests-beside-source',
        status: sources.length > 0 && matched * 2 >= sources.length ? 'pass' : 'fail',
        paths: [...matchedTests].sort(byCodeUnit).slice(0, MAX_PATHS),
        count: { matched, of: sources.length },
      },
      {
        id: 'tests-in-every-folder',
        status: folders.size > 0 && foldersWithTests === folders.size ? 'pass' : 'fail',
        paths: [...new Set(folderEvidence)].slice(0, MAX_PATHS),
        count: { matched: foldersWithTests, of: folders.size },
      },
    ],
    ...(sources.length < MIN_SOURCE_FILES ? { insufficient: true } : {}),
  };
}
