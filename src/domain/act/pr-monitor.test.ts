import { expect, test } from 'vitest';
import { monitorDecision, normalizeFeedback, type MonitorInput } from './pr-monitor';

const lint = {
  kind: 'ci' as const,
  reference: 'check:1',
  disposition: 'actionable' as const,
  path: '.fieldnote/profile.md',
  instruction: 'format' as const,
};
const input: MonitorInput = { outcome: 'open', failures: [lint], reviews: [], repairs: 0 };
test('repairs actionable feedback and stops at the three-round bound', () => {
  expect(monitorDecision(input)).toEqual({ kind: 'repair', trigger: lint });
  expect(monitorDecision({ ...input, repairs: 3 })).toEqual({
    kind: 'human-required',
    reason: 'repair_limit',
  });
});
test.each(['ambiguous', 'secret', 'destructive'] as const)(
  'requires human for %s even alongside actionable lint',
  (disposition) => {
    expect(
      monitorDecision({ ...input, reviews: [{ ...lint, kind: 'review', disposition }] }),
    ).toEqual({ kind: 'human-required', reason: disposition });
  },
);
test('permission loss and foreign head stop repair; pending checks and active repairs wait', () => {
  expect(monitorDecision({ ...input, permissionLost: true })).toEqual({
    kind: 'human-required',
    reason: 'permission_loss',
  });
  expect(monitorDecision({ ...input, headChanged: true })).toEqual({
    kind: 'human-required',
    reason: 'head_changed',
  });
  expect(monitorDecision({ ...input, pending: true })).toEqual({ kind: 'wait' });
  expect(monitorDecision({ ...input, repairing: true })).toEqual({ kind: 'wait' });
});
test('merged verifies, closed remains uninstalled, healthy waits for a human merge', () => {
  expect(monitorDecision({ ...input, outcome: 'merged' })).toEqual({ kind: 'verify' });
  expect(monitorDecision({ ...input, outcome: 'closed' })).toEqual({ kind: 'closed' });
  expect(monitorDecision({ ...input, failures: [] })).toEqual({ kind: 'wait' });
});
test('normalization accepts only exact bounded managed formatting feedback and never retains raw text', () => {
  expect(
    normalizeFeedback('review', 'review:12', 'Please format .fieldnote/profile.md', [
      '.fieldnote/profile.md',
    ]),
  ).toEqual({
    kind: 'review',
    reference: 'review:12',
    disposition: 'actionable',
    path: '.fieldnote/profile.md',
    instruction: 'format',
  });
  for (const [body, disposition] of [
    ['Use secret token private-value', 'secret'],
    ['Delete .fieldnote/profile.md', 'destructive'],
    ['Please improve this', 'ambiguous'],
    ['format README.md', 'ambiguous'],
    ['format .fieldnote/profile.md and deploy it', 'destructive'],
  ] as const) {
    const result = normalizeFeedback('review', 'review:12', body, ['.fieldnote/profile.md']);
    expect(result.disposition).toBe(disposition);
    expect(JSON.stringify(result)).not.toContain(body);
  }
});
