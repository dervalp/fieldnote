import { expect, test } from 'vitest';
import { badgeParts, renderBadge } from './badge';
import type { PublicGradeView } from './public-grade';

const grader = {
  id: 'fieldnote/agent-readiness',
  title: 'Agent Readiness',
  author: 'fieldnote',
  mode: 'deterministic' as const,
  category: 'agent-readiness' as const,
  disclaimer: 'Evidence, not certification.',
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  checkTitles: { 'root-readme': 'Project documentation' },
};
const repository = { owner: 'acme', name: 'widgets', isPrivate: false };
const grade = {
  score: 82,
  sha: 'a'.repeat(40),
  computedAt: new Date('2026-09-01T00:00:00.000Z'),
  rubricVersion: '0.1.0',
  evaluatorVersion: '1.0.0',
  checks: [
    {
      id: 'root-readme',
      points: 0,
      maxPoints: 20,
      status: 'fail' as const,
      paths: [],
      lineRanges: [],
      explanation: 'No nonempty root README.md was found. Evidence, not certification.',
    },
  ],
};
const graded: PublicGradeView = { state: 'graded', repository, grader, grade, stale: false };

test('a fresh grade shows its score and label', () => {
  expect(badgeParts(graded)).toEqual({
    left: 'Agent Readiness',
    right: '82 · Very good',
    color: '#697e8d',
  });
});

test('a stale grade shows no number', () => {
  expect(badgeParts({ ...graded, stale: true }).right).toBe('stale');
});

test('an ungraded pair says so', () => {
  expect(badgeParts({ state: 'ungraded', repository, grader }).right).toBe('not graded');
});

test('a private view echoes nothing about what was asked for', () => {
  expect(badgeParts({ state: 'private' })).toEqual({
    left: 'fieldnote',
    right: 'private',
    color: '#6b7280',
  });
});

test('the badge never names a check', () => {
  const svg = renderBadge(graded);
  expect(svg).not.toContain('Project documentation');
  expect(svg).not.toContain('root-readme');
  expect(svg).not.toContain('README');
});

test('a grader title cannot inject markup', () => {
  const svg = renderBadge({
    ...graded,
    grader: { ...grader, title: '</text><script>alert(1)</script>' },
  });
  expect(svg).not.toContain('<script>');
  expect(svg).toContain('&lt;script&gt;');
});

test('the badge is a complete SVG document with an accessible name', () => {
  const svg = renderBadge(graded);
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(svg.endsWith('</svg>')).toBe(true);
  expect(svg).toContain('role="img"');
  expect(svg).toContain('aria-label="Agent Readiness: 82 · Very good"');
});
