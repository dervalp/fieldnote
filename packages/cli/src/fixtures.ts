import type { GradeComplete } from './api.ts';

// Shared by bin.test.ts and grade-run.test.ts, which test the two halves of
// the same flow — the dispatch and the run — against the same git state, the
// same POST echo and the same completed grade. Kept in one place because
// byte-identical copies of a fixture do not stay byte-identical: the moment
// one file's CLEAN_STATE grows a field the other does not, the two suites are
// quietly testing different worlds.
//
// Not a *.test.ts file on purpose: vitest collects those, and a file with no
// test in it fails collection.

export const CLEAN_STATE = {
  slug: 'dervalp/fieldnote',
  sha: 'a'.repeat(40),
  upstreamSha: 'a'.repeat(40),
  dirtyCount: 0,
  unpushedCount: 0,
  hasUpstream: true,
};

export const REQUESTED = {
  runId: 'r1',
  graderId: 'agent-brief',
  mode: 'deterministic' as const,
  requestedSha: CLEAN_STATE.sha,
};

export function completeFixture(overrides: Partial<GradeComplete> = {}): GradeComplete {
  return {
    state: 'complete',
    score: 92,
    checks: [],
    titles: {},
    graderId: 'agent-brief',
    graderVersion: '1',
    rubricVersion: '1',
    evaluatorVersion: '1',
    mode: 'deterministic',
    tagline: 'reads like a brief',
    disclaimer: 'This grader uses a language model.',
    gradedSha: CLEAN_STATE.sha,
    presentation: { label: 'Solid', finish: 'green' },
    nextTier: null,
    url: 'https://fieldnote.dev/g/1',
    ...overrides,
  };
}
