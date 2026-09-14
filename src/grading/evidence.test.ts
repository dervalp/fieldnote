import { expect, test, vi, beforeEach } from 'vitest';

const collectFiles = vi.fn();
const collectMetrics = vi.fn();
vi.mock('../github/collect-files', () => ({ collectFiles }));
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
  collectFiles.mockReset();
  collectMetrics.mockReset();
});

test('a file grader calls only the file collector', async () => {
  collectFiles.mockResolvedValue({ sha: 'abc', complete: true, documents: [] });
  const collected = await collectEvidence(agentReadinessManifest, 'repo', 'abc', new Date('2026-09-14T12:00:00.000Z'));
  expect(collectFiles).toHaveBeenCalledWith(
    'repo',
    'abc',
    agentReadinessManifest.needs['repo.files'],
  );
  expect(collectMetrics).not.toHaveBeenCalled();
  expect(collected.snapshot.metrics).toBeNull();
  // A complete snapshot has no failure to name.
  expect(collected.incompleteCode).toBeNull();
});

test('a metrics grader calls only the metrics collector', async () => {
  collectMetrics.mockResolvedValue({ metrics, complete: true });
  const requestedAt = new Date('2026-09-14T12:00:00.000Z');
  const collected = await collectEvidence(deliveryHealthManifest, 'repo', 'abc', requestedAt);
  const { snapshot } = collected;
  expect(collectFiles).not.toHaveBeenCalled();
  expect(collectMetrics).toHaveBeenCalledWith(
    'repo',
    deliveryHealthManifest.needs['fieldnote.metrics'],
    requestedAt,
  );
  expect(snapshot).toMatchObject({ sha: 'abc', complete: true, documents: [], metrics });
  // A complete snapshot has no failure to name.
  expect(collected.incompleteCode).toBeNull();
});

test("the grader's floor is reported as insufficient evidence, not a collection failure", async () => {
  collectMetrics.mockResolvedValue({
    metrics,
    complete: false,
    incompleteReason: 'Not enough merged work to judge.',
    incompleteCode: 'insufficient_evidence',
  });
  const collected = await collectEvidence(deliveryHealthManifest, 'repo', 'abc', new Date('2026-09-14T12:00:00.000Z'));
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
  const collected = await collectEvidence(deliveryHealthManifest, 'repo', 'abc', new Date('2026-09-14T12:00:00.000Z'));
  expect(collected.snapshot.complete).toBe(false);
  expect(collected.snapshot.incompleteReason).toBe(INCOMPLETE);
  expect(collected.incompleteCode).toBe('incomplete_collection');
});

test('a failed file collection is reported as a collection failure', async () => {
  collectFiles.mockResolvedValue({ sha: 'abc', complete: false, documents: [] });
  const collected = await collectEvidence(agentReadinessManifest, 'repo', 'abc', new Date('2026-09-14T12:00:00.000Z'));
  expect(collected.snapshot.incompleteReason).toBe(INCOMPLETE);
  expect(collected.incompleteCode).toBe('incomplete_collection');
});

// No real manifest needs both families yet, but the dispatcher's merge and its
// needs invariants have to hold the day one does — this is the path the next
// slice leans on hardest. Synthesized here rather than borrowed from a
// built-in grader, which each read exactly one family today.
const bothFamiliesManifest = {
  ...agentReadinessManifest,
  needs: {
    'repo.files': agentReadinessManifest.needs['repo.files'],
    'fieldnote.metrics': deliveryHealthManifest.needs['fieldnote.metrics'],
  },
} as typeof agentReadinessManifest;

test('a manifest needing both families calls both collectors and merges their evidence', async () => {
  collectFiles.mockResolvedValue({
    sha: 'abc',
    complete: true,
    documents: [{ path: 'README.md', blobSha: 'x', text: 'hi' }],
  });
  collectMetrics.mockResolvedValue({ metrics, complete: true });
  const requestedAt = new Date('2026-09-14T12:00:00.000Z');
  const collected = await collectEvidence(bothFamiliesManifest, 'repo', 'abc', requestedAt);
  expect(collectFiles).toHaveBeenCalledWith(
    'repo',
    'abc',
    agentReadinessManifest.needs['repo.files'],
  );
  expect(collectMetrics).toHaveBeenCalledWith(
    'repo',
    bothFamiliesManifest.needs['fieldnote.metrics'],
    requestedAt,
  );
  expect(collected.snapshot.documents).toEqual([{ path: 'README.md', blobSha: 'x', text: 'hi' }]);
  expect(collected.snapshot.metrics).toEqual(metrics);
  expect(collected.snapshot.complete).toBe(true);
  expect(collected.incompleteCode).toBeNull();
});

test('a failed file collection outranks an unmet metrics floor', async () => {
  collectFiles.mockResolvedValue({ sha: 'abc', complete: false, documents: [] });
  collectMetrics.mockResolvedValue({
    metrics,
    complete: false,
    incompleteReason: 'Not enough merged work to judge.',
    incompleteCode: 'insufficient_evidence',
  });
  const collected = await collectEvidence(bothFamiliesManifest, 'repo', 'abc', new Date('2026-09-14T12:00:00.000Z'));
  expect(collected.snapshot.complete).toBe(false);
  // fieldnote's own collection failing is reported, not the grader's floor,
  // even though the metrics collector also had something to say.
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
  await expect(collectEvidence(manifest, 'repo', 'abc', new Date('2026-09-14T12:00:00.000Z'))).rejects.toThrow(/some\.other\.family/);
  expect(collectFiles).not.toHaveBeenCalled();
  expect(collectMetrics).not.toHaveBeenCalled();
});

test('the metrics window is pinned to the request time, not the wall clock', async () => {
  collectMetrics.mockResolvedValue({ metrics, complete: true });
  const requestedAt = new Date('2026-09-13T23:58:00.000Z');
  await collectEvidence(deliveryHealthManifest, 'repo', 'abc', requestedAt);
  expect(collectMetrics).toHaveBeenCalledWith(
    'repo',
    deliveryHealthManifest.needs['fieldnote.metrics'],
    requestedAt,
  );
});
