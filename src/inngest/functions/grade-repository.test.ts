import { beforeEach, expect, test, vi } from 'vitest';

const queries = vi.hoisted(() => ({
  loadGradeRun: vi.fn(),
  validateGradeRun: vi.fn(),
  completeGrade: vi.fn(),
  failGrade: vi.fn(),
  insufficientGrade: vi.fn(),
  beginGrade: vi.fn(),
  pinGradeSha: vi.fn(),
}));
const broker = vi.hoisted(() => ({ collectEvidence: vi.fn() }));
vi.mock('../../db/queries/grade-runs', () => queries);
vi.mock('../../grading/evidence', () => broker);
vi.mock('../../github/collect-files', () => ({
  resolveHeadSha: vi.fn(),
  FileCollectionError: class extends Error {},
}));

const { evaluateGradeRun } = await import('./grade-repository');
const { agentReadinessManifest } = await import('../../domain/grading/graders/agent-readiness');

const run = {
  id: 'run-1',
  repositoryId: 'repo-1',
  graderId: agentReadinessManifest.id,
  state: 'running',
  sha: 'a'.repeat(40),
  createdAt: new Date('2026-09-13T23:58:00.000Z'),
  rubricVersion: agentReadinessManifest.version,
  evaluatorVersion: agentReadinessManifest.evaluatorVersion,
};

beforeEach(() => {
  vi.resetAllMocks();
  queries.loadGradeRun.mockResolvedValue(run);
  queries.validateGradeRun.mockResolvedValue(undefined);
});

test('a grader floor miss is stored, not failed', async () => {
  broker.collectEvidence.mockResolvedValue({
    snapshot: {
      sha: run.sha,
      complete: false,
      documents: [],
      metrics: null,
      incompleteReason: 'Not enough merged work to judge.',
    },
    incompleteCode: 'insufficient_evidence',
  });
  await evaluateGradeRun('run-1');
  expect(queries.insufficientGrade).toHaveBeenCalledWith(
    'run-1',
    expect.objectContaining({ score: null, incompleteReason: 'Not enough merged work to judge.' }),
  );
  expect(queries.failGrade).not.toHaveBeenCalled();
});

test('a collection failure fails the run and stores nothing', async () => {
  broker.collectEvidence.mockResolvedValue({
    snapshot: { sha: run.sha, complete: false, documents: [], metrics: null },
    incompleteCode: 'incomplete_collection',
  });
  await evaluateGradeRun('run-1');
  expect(queries.failGrade).toHaveBeenCalledWith('run-1', 'incomplete_collection');
  expect(queries.insufficientGrade).not.toHaveBeenCalled();
});

test('the broker is handed the run request time', async () => {
  broker.collectEvidence.mockResolvedValue({
    snapshot: { sha: run.sha, complete: true, documents: [], metrics: null },
    incompleteCode: null,
  });
  await evaluateGradeRun('run-1');
  expect(broker.collectEvidence).toHaveBeenCalledWith(
    expect.objectContaining({ id: agentReadinessManifest.id }),
    'repo-1',
    run.sha,
    run.createdAt,
  );
  expect(queries.completeGrade).toHaveBeenCalled();
});
