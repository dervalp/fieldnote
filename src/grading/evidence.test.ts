import { expect, test, vi, beforeEach } from 'vitest';

const collectReadiness = vi.fn();
const collectMetrics = vi.fn();
vi.mock('../github/collect-readiness', () => ({ collectReadiness }));
vi.mock('../db/queries/grade-metrics', () => ({ collectMetrics }));

const { collectEvidence } = await import('./evidence');
const { agentReadinessManifest } = await import('../domain/grading/graders/agent-readiness');
const { deliveryHealthManifest } = await import('../domain/grading/graders/delivery-health');
const { INCOMPLETE } = await import('../domain/grading/declarative');

const metrics = {
  days: 30,
  start: '2026-08-15T00:00:00.000Z',
  endExclusive: '2026-09-14T00:00:00.000Z',
  mergedPullRequests: 53,
  'first-pass-rate': { numerator: 36, denominator: 53, value: (100 * 36) / 53 },
  'ci-success-rate': { numerator: 95, denominator: 100, value: 95 },
  'ci-recovery-rate': { numerator: 1, denominator: 4, value: 25 },
};

beforeEach(() => {
  collectReadiness.mockReset();
  collectMetrics.mockReset();
});

test('a file grader calls only the file collector', async () => {
  collectReadiness.mockResolvedValue({ sha: 'abc', complete: true, documents: [] });
  const { snapshot } = await collectEvidence(agentReadinessManifest, 'repo', 'abc');
  expect(collectReadiness).toHaveBeenCalledWith('repo', 'abc');
  expect(collectMetrics).not.toHaveBeenCalled();
  expect(snapshot.metrics).toBeNull();
});

test('a metrics grader calls only the metrics collector', async () => {
  collectMetrics.mockResolvedValue({ metrics, complete: true });
  const { snapshot } = await collectEvidence(deliveryHealthManifest, 'repo', 'abc');
  expect(collectReadiness).not.toHaveBeenCalled();
  expect(collectMetrics).toHaveBeenCalledWith(
    'repo',
    deliveryHealthManifest.needs['fieldnote.metrics'],
  );
  expect(snapshot).toMatchObject({ sha: 'abc', complete: true, documents: [], metrics });
});

test("the grader's floor is reported as insufficient evidence, not a collection failure", async () => {
  collectMetrics.mockResolvedValue({
    metrics,
    complete: false,
    incompleteReason: 'Not enough merged work to judge.',
    incompleteCode: 'insufficient_evidence',
  });
  const collected = await collectEvidence(deliveryHealthManifest, 'repo', 'abc');
  expect(collected.snapshot.complete).toBe(false);
  expect(collected.snapshot.incompleteReason).toBe('Not enough merged work to judge.');
  expect(collected.incompleteCode).toBe('insufficient_evidence');
});

test("a metrics collection fieldnote itself failed is reported as a collection failure, not the grader's floor", async () => {
  // Same shape as the floor case above (complete: false), but this time the
  // collector says its own failure was fieldnote's, not the grader's. The
  // dispatcher must read that code rather than assume 'insufficient_evidence'
  // for any incomplete metrics collection.
  collectMetrics.mockResolvedValue({
    metrics,
    complete: false,
    incompleteReason: INCOMPLETE,
    incompleteCode: 'incomplete_collection',
  });
  const collected = await collectEvidence(deliveryHealthManifest, 'repo', 'abc');
  expect(collected.snapshot.complete).toBe(false);
  expect(collected.snapshot.incompleteReason).toBe(INCOMPLETE);
  expect(collected.incompleteCode).toBe('incomplete_collection');
});

test('a failed file collection is reported as a collection failure', async () => {
  collectReadiness.mockResolvedValue({ sha: 'abc', complete: false, documents: [] });
  const collected = await collectEvidence(agentReadinessManifest, 'repo', 'abc');
  expect(collected.snapshot.incompleteReason).toBe(INCOMPLETE);
  expect(collected.incompleteCode).toBe('incomplete_collection');
});

// Unreachable through normal validation: parseManifest's needs_mismatch
// invariant already refuses a manifest that declares a family no check reads,
// and the schema itself has no key for a third family. This pins the
// dispatcher's own refusal so it fails loudly by name if a family is ever
// added to the schema without a matching branch here, rather than silently
// collecting nothing for it.
test('a family the dispatcher does not handle is refused by name', async () => {
  const manifest = {
    ...agentReadinessManifest,
    needs: { ...agentReadinessManifest.needs, 'some.other.family': ['x'] },
  } as unknown as typeof agentReadinessManifest;
  await expect(collectEvidence(manifest, 'repo', 'abc')).rejects.toThrow(/some\.other\.family/);
  expect(collectReadiness).not.toHaveBeenCalled();
  expect(collectMetrics).not.toHaveBeenCalled();
});
