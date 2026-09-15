import { describe, expect, test } from 'vitest';
import { gradeLines, type GradeView } from './grade-view.ts';

const sha = 'a1f2d4d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3';

const base: GradeView = {
  state: 'complete',
  slug: 'dervalp/fieldnote',
  requestedSha: sha,
  gradedSha: sha,
  graderId: 'fieldnote/agent-readiness',
  graderVersion: '1.0.0',
  rubricVersion: '1.0.0',
  evaluatorVersion: '1.0.0',
  mode: 'deterministic',
  disclaimer: 'Judged from files in the default branch only.',
  tagline: 'How ready this repository is for coding agents.',
  score: 80,
  presentation: { label: 'Very good', finish: 'Silver · Holographic' },
  checks: [
    {
      id: 'agents-md',
      points: 20,
      maxPoints: 20,
      status: 'pass',
      paths: ['AGENTS.md'],
      lineRanges: [],
      explanation: 'AGENTS.md is present.',
    },
    {
      id: 'setup-commands',
      points: 0,
      maxPoints: 20,
      status: 'fail',
      paths: [],
      lineRanges: [],
      explanation: 'No fenced command block under a setup heading.',
    },
  ],
  titles: { 'agents-md': 'An agent brief exists', 'setup-commands': 'Setup commands are runnable' },
  nextTier: {
    targetScore: 100,
    targetFinish: 'Prismatic',
    moves: [{ id: 'setup-commands', title: 'Setup commands are runnable', points: 20 }],
  },
  url: 'https://fieldnote.dev/repos/r_123/grading',
};

const text = (lines: ReturnType<typeof gradeLines>, kind: string) =>
  lines.filter((line) => line.kind === kind).map((line) => line.text);
const joined = (lines: ReturnType<typeof gradeLines>) => lines.map((line) => line.text).join('\n');

describe('gradeLines', () => {
  test('the card carries the score, the label and the finish name', () => {
    expect(text(gradeLines(base), 'card')).toEqual(['80/100 · Very good · Silver · Holographic']);
  });

  test('a passing grader check names its title, its points and its first path', () => {
    expect(text(gradeLines(base), 'pass')).toEqual(['An agent brief exists  20/20  AGENTS.md']);
  });

  test('a failing grader check names its explanation, since it has no path to name', () => {
    expect(text(gradeLines(base), 'fail')).toEqual([
      'Setup commands are runnable  0/20  No fenced command block under a setup heading.',
    ]);
  });

  test('a partially scored grader check is partial, not a pass', () => {
    const partial = {
      ...base,
      checks: [{ ...base.checks[0], points: 12, maxPoints: 20, status: 'pass' as const }],
    };
    const lines = gradeLines(partial);
    expect(text(lines, 'partial')).toEqual(['An agent brief exists  12/20  AGENTS.md']);
    expect(text(lines, 'pass')).toEqual([]);
  });

  test('an unrecognised grader check id is named by its id rather than guessed at', () => {
    expect(text(gradeLines({ ...base, titles: {} }), 'pass')[0]).toContain('agents-md');
  });

  test('a non-deterministic grader discloses itself in the grader’s own words, above the card', () => {
    const lines = gradeLines({ ...base, mode: 'hybrid' });
    const card = lines.findIndex((line) => line.kind === 'card');
    const disclosure = lines.findIndex((line) => line.text.includes('default branch only'));
    expect(disclosure).toBeGreaterThanOrEqual(0);
    expect(disclosure).toBeLessThan(card);
  });

  test('a deterministic grader says nothing about how it judged', () => {
    expect(gradeLines(base).some((line) => line.text.includes('default branch only'))).toBe(false);
  });

  test('the next tier names the moves that reach it', () => {
    expect(text(gradeLines(base), 'head')).toContain('Next: Prismatic at 100');
    expect(text(gradeLines(base), 'dim')).toContain('  Setup commands are runnable  +20');
  });

  test('no next tier means no next-tier section at all', () => {
    // nextTier is null independently of score: a perfect 100, or any score
    // where every grader check already passed.
    const lines = gradeLines({ ...base, score: 100, nextTier: null });
    expect(lines.some((line) => line.text.startsWith('Next:'))).toBe(false);
  });

  test('a null score is incomplete evidence, never a zero', () => {
    const lines = gradeLines({
      ...base,
      score: null,
      presentation: null,
      incompleteReason: 'The repository snapshot was truncated at 500 files.',
    });
    expect(text(lines, 'card')).toEqual([]);
    expect(joined(lines)).toContain('No score');
    expect(joined(lines)).toContain('truncated at 500 files');
    expect(joined(lines)).not.toContain('0/100');
  });

  test('a graded sha that differs from the requested one is disclosed above the card', () => {
    const lines = gradeLines({ ...base, gradedSha: 'b'.repeat(40) });
    const card = lines.findIndex((line) => line.kind === 'card');
    const warning = lines.findIndex((line) => line.text.includes('bbbbbbb'));
    expect(warning).toBeGreaterThanOrEqual(0);
    expect(warning).toBeLessThan(card);
    expect(joined(lines)).toContain(sha.slice(0, 7));
  });

  test('a matching sha says nothing about a mismatch', () => {
    expect(gradeLines(base).some((line) => line.text.includes('not the commit'))).toBe(false);
  });

  test('an abbreviated requested sha that is a prefix of the graded one is not a mismatch', () => {
    // The CLI's own --sha suggestion (git.ts) is a 7-character abbreviation.
    // A developer who follows it exactly must not be told their commit
    // mismatches itself.
    const lines = gradeLines({ ...base, requestedSha: sha.slice(0, 7) });
    expect(lines.some((line) => line.text.includes('not the commit'))).toBe(false);
  });

  test('a null graded sha is disclosed rather than passed off as the requested one', () => {
    const lines = gradeLines({ ...base, gradedSha: null });
    expect(joined(lines)).not.toContain(`${sha.slice(0, 7)} ·`);
    expect(joined(lines)).toContain('which commit');
  });

  test('an empty-string graded sha is treated the same as a null one, not as a mismatch', () => {
    // input.gradedSha ? … : 'commit unknown' in the head already treats ''
    // like null; the mismatch disclosure below it must agree, or an empty
    // string prints both "commit unknown" AND "Graded , not the commit you
    // are on (…)" from the same value.
    const lines = gradeLines({ ...base, gradedSha: '' });
    expect(joined(lines)).toContain('which commit');
    expect(joined(lines)).not.toContain('not the commit');
  });

  test('an empty requestedSha is never treated as matching — an empty prefix is not a shared commit', () => {
    // The one branch of shaMatches's own empty-string guard that gradeSha
    // being non-empty here can still reach: requestedSha empty, gradedSha
    // not. Without the guard, ''.startsWith('') style reasoning would treat
    // this as a match and hide a mismatch that is, if anything, more worth
    // disclosing than an ordinary one.
    const lines = gradeLines({ ...base, requestedSha: '' });
    expect(joined(lines)).toContain('not the commit');
  });

  test('the card url is the last line, so a scrolled terminal still ends on it', () => {
    expect(gradeLines(base).at(-1)).toEqual({ kind: 'url', text: base.url });
  });
});
