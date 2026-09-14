import { beforeEach, expect, test, vi } from 'vitest';

const code = vi.hoisted(() => ({ runCodeGrader: vi.fn() }));
const sandbox = vi.hoisted(() => ({ selectSandbox: vi.fn(() => ({ name: 'fake' })) }));
vi.mock('./run-code', () => code);
vi.mock('./sandbox', () => sandbox);

const { evaluate } = await import('./evaluate');
const { parseManifest } = await import('../domain/grading/manifest');
const { agentReadinessManifest } = await import('../domain/grading/graders/agent-readiness');
const { deliveryHealthManifest } = await import('../domain/grading/graders/delivery-health');

const codeManifest = parseManifest({
  id: 'fieldnote/evaluate-fixture',
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'test-discipline',
  kind: 'code',
  needs: { 'repo.tree': ['**/*'] },
  code: { source: 'export default () => ({ checks: [] });' },
  disclaimer: 'Evidence, not certification.',
  card: { title: 'Fixture', tagline: 'Is it?', groups: [{ title: 'All', checks: ['t'] }] },
  checks: [{ id: 't', title: 'T', points: 100, explain: { pass: 'Yes.', fail: 'No.' } }],
});
const sha = 'a'.repeat(40);
const scoredResult = { score: 100, checks: [], rubricVersion: '0.1.0', evaluatorVersion: '1.0.0' };

beforeEach(() => vi.clearAllMocks());

test('a declarative grader with complete evidence is scored', async () => {
  const evaluation = await evaluate(agentReadinessManifest, {
    snapshot: { sha, complete: true, documents: [] },
    incompleteCode: null,
  });
  expect(evaluation.verdict).toBe('scored');
  expect(evaluation.result.score).toBe(0);
});

const metrics = {
  days: 30,
  start: '2026-08-15T00:00:00.000Z',
  endExclusive: '2026-09-14T00:00:00.000Z',
  mergedPullRequests: 3,
  'first-pass-rate': { numerator: 1, denominator: 3, value: (100 * 1) / 3 },
  'ci-success-rate': { numerator: 3, denominator: 3, value: 100 },
  'ci-recovery-rate': { numerator: 0, denominator: 0, value: null },
};

test("a declarative grader's floor miss is insufficient", async () => {
  // A metric-threshold check throws without a window, so the floor-miss
  // snapshot carries one, as collectMetrics() always returns.
  const evaluation = await evaluate(deliveryHealthManifest, {
    snapshot: { sha, complete: false, documents: [], metrics, incompleteReason: 'Quiet.' },
    incompleteCode: 'insufficient_evidence',
  });
  expect(evaluation.verdict).toBe('insufficient');
});

test('a declarative grader whose collection failed is incomplete', async () => {
  const evaluation = await evaluate(agentReadinessManifest, {
    snapshot: { sha, complete: false, documents: [] },
    incompleteCode: 'incomplete_collection',
  });
  expect(evaluation.verdict).toBe('incomplete');
});

test('a code grader on partial evidence is incomplete and never gets a box', async () => {
  const evaluation = await evaluate(codeManifest, {
    snapshot: { sha, complete: false, documents: [], tree: [] },
    incompleteCode: 'incomplete_collection',
  });
  expect(evaluation.verdict).toBe('incomplete');
  expect(sandbox.selectSandbox).not.toHaveBeenCalled();
  expect(code.runCodeGrader).not.toHaveBeenCalled();
});

test("a code grader's own floor is insufficient, decided after collection succeeded", async () => {
  code.runCodeGrader.mockResolvedValue({ result: { ...scoredResult, score: null }, insufficient: true });
  const evaluation = await evaluate(codeManifest, {
    snapshot: { sha, complete: true, documents: [], tree: [] },
    incompleteCode: null,
  });
  expect(evaluation.verdict).toBe('insufficient');
  expect(code.runCodeGrader).toHaveBeenCalledWith(
    codeManifest,
    expect.objectContaining({ sha }),
    { name: 'fake' },
  );
});

test('a code grader that answered is scored', async () => {
  code.runCodeGrader.mockResolvedValue({ result: scoredResult, insufficient: false });
  const evaluation = await evaluate(codeManifest, {
    snapshot: { sha, complete: true, documents: [], tree: [] },
    incompleteCode: null,
  });
  expect(evaluation).toEqual({ result: scoredResult, verdict: 'scored' });
});
