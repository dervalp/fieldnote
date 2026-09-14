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
const code = vi.hoisted(() => ({ runCodeGrader: vi.fn() }));
vi.mock('../../grading/run-code', () => code);
const sandbox = vi.hoisted(() => ({ selectSandbox: vi.fn() }));
vi.mock('../../grading/sandbox', () => sandbox);
const client = vi.hoisted(() => ({
  createFunction: vi.fn((config: unknown, handler: unknown) => ({ config, handler })),
}));
vi.mock('../client', () => ({ inngest: client }));

const { evaluateGradeRun, finalFailureCode } = await import('./grade-repository');
const { config } = client.createFunction.mock.results[0].value as {
  config: { onFailure: (context: { event: unknown; error: unknown }) => Promise<void> };
};
const { agentReadinessManifest } = await import('../../domain/grading/graders/agent-readiness');
const { registerGrader } = await import('../../domain/grading/registry');
const { GraderFailedError } = await import('../../domain/grading/code');
const { SandboxUnavailableError } = await import('../../grading/sandbox/errors');
const { NonRetriableError } = await import('inngest');

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

const codeGrader = registerGrader({
  id: 'fieldnote/worker-code-fixture',
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'test-discipline',
  kind: 'code',
  needs: { 'repo.tree': ['**/*'] },
  code: { source: 'export default () => ({ checks: [] });' },
  insufficientReason: 'Too little code to judge.',
  disclaimer: 'Evidence, not certification.',
  card: { title: 'Fixture', tagline: 'Is it?', groups: [{ title: 'All', checks: ['t'] }] },
  checks: [{ id: 't', title: 'T', points: 100, explain: { pass: 'Yes.', fail: 'No.' } }],
});
const codeRun = {
  ...run,
  graderId: codeGrader.id,
  rubricVersion: codeGrader.version,
  evaluatorVersion: codeGrader.evaluatorVersion,
};
const treeEvidence = {
  snapshot: { sha: run.sha, complete: true, documents: [], tree: [{ path: 'a.ts', size: 1 }] },
  incompleteCode: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  queries.loadGradeRun.mockResolvedValue(run);
  queries.validateGradeRun.mockResolvedValue(undefined);
  sandbox.selectSandbox.mockReturnValue({});
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

test('a code grader that answered completes the run', async () => {
  queries.loadGradeRun.mockResolvedValue(codeRun);
  broker.collectEvidence.mockResolvedValue(treeEvidence);
  code.runCodeGrader.mockResolvedValue({
    result: { score: 100, checks: [], rubricVersion: '0.1.0', evaluatorVersion: '1.0.0' },
    insufficient: false,
  });
  await evaluateGradeRun('run-1');
  expect(queries.completeGrade).toHaveBeenCalledWith('run-1', expect.objectContaining({ score: 100 }));
  expect(queries.validateGradeRun).toHaveBeenCalledTimes(2);
});

test("a code grader's own floor stores an insufficient run with the manifest's sentence", async () => {
  queries.loadGradeRun.mockResolvedValue(codeRun);
  broker.collectEvidence.mockResolvedValue(treeEvidence);
  code.runCodeGrader.mockResolvedValue({
    result: {
      score: null,
      checks: [],
      rubricVersion: '0.1.0',
      evaluatorVersion: '1.0.0',
      incompleteReason: 'Too little code to judge.',
    },
    insufficient: true,
  });
  await evaluateGradeRun('run-1');
  expect(queries.insufficientGrade).toHaveBeenCalledWith(
    'run-1',
    expect.objectContaining({ score: null, incompleteReason: 'Too little code to judge.' }),
  );
  expect(queries.failGrade).not.toHaveBeenCalled();
});

test('a code grader on an incomplete tree fails as collection and never runs', async () => {
  queries.loadGradeRun.mockResolvedValue(codeRun);
  broker.collectEvidence.mockResolvedValue({
    snapshot: { sha: run.sha, complete: false, documents: [], tree: [] },
    incompleteCode: 'incomplete_collection',
  });
  await evaluateGradeRun('run-1');
  expect(queries.failGrade).toHaveBeenCalledWith('run-1', 'incomplete_collection');
  expect(code.runCodeGrader).not.toHaveBeenCalled();
});

test('a failing program fails the run as grader_failed, without retrying', async () => {
  queries.loadGradeRun.mockResolvedValue(codeRun);
  broker.collectEvidence.mockResolvedValue(treeEvidence);
  code.runCodeGrader.mockRejectedValue(new GraderFailedError('The grader program did not finish.'));
  await expect(evaluateGradeRun('run-1')).rejects.toBeInstanceOf(NonRetriableError);
  expect(queries.failGrade).toHaveBeenCalledWith('run-1', 'grader_failed');
});

test('no sandbox in production fails the run as sandbox_unavailable, without retrying', async () => {
  queries.loadGradeRun.mockResolvedValue(codeRun);
  broker.collectEvidence.mockResolvedValue(treeEvidence);
  code.runCodeGrader.mockRejectedValue(new SandboxUnavailableError(false));
  await expect(evaluateGradeRun('run-1')).rejects.toBeInstanceOf(NonRetriableError);
  expect(queries.failGrade).toHaveBeenCalledWith('run-1', 'sandbox_unavailable');
});

test('a code grader with no sandbox fails before a single GitHub call', async () => {
  queries.loadGradeRun.mockResolvedValue(codeRun);
  sandbox.selectSandbox.mockImplementation(() => {
    throw new SandboxUnavailableError(false);
  });
  await expect(evaluateGradeRun('run-1')).rejects.toBeInstanceOf(NonRetriableError);
  expect(broker.collectEvidence).not.toHaveBeenCalled();
  expect(code.runCodeGrader).not.toHaveBeenCalled();
  expect(queries.failGrade).toHaveBeenCalledWith('run-1', 'sandbox_unavailable');
});

test('a declarative grader never asks for a sandbox', async () => {
  broker.collectEvidence.mockResolvedValue({
    snapshot: { sha: run.sha, complete: true, documents: [], metrics: null },
    incompleteCode: null,
  });
  await evaluateGradeRun('run-1');
  expect(sandbox.selectSandbox).not.toHaveBeenCalled();
  expect(queries.completeGrade).toHaveBeenCalled();
});

test('a sandbox outage is retried under its own name and stores nothing yet', async () => {
  queries.loadGradeRun.mockResolvedValue(codeRun);
  broker.collectEvidence.mockResolvedValue(treeEvidence);
  code.runCodeGrader.mockRejectedValue(new SandboxUnavailableError(true));
  await expect(evaluateGradeRun('run-1')).rejects.toMatchObject({
    name: 'SandboxUnavailableError',
    message: 'The grading sandbox is unavailable.',
  });
  expect(queries.failGrade).not.toHaveBeenCalled();
});

test('when retries run out, a sandbox outage is recorded as one and anything else as before', () => {
  expect(finalFailureCode({ name: 'SandboxUnavailableError' })).toBe('sandbox_unavailable');
  expect(finalFailureCode({ name: 'Error' })).toBeUndefined();
  expect(finalFailureCode(undefined)).toBeUndefined();
});

test("the function's failure handler stores a spent outage as sandbox_unavailable", async () => {
  const error = new Error('vendor detail');
  error.name = 'SandboxUnavailableError';
  await config.onFailure({ event: { data: { event: { data: { runId: 'run-1' } } } }, error });
  expect(queries.failGrade).toHaveBeenCalledWith('run-1', 'sandbox_unavailable');
});

test("the function's failure handler stores any other spent failure without a code", async () => {
  await config.onFailure({
    event: { data: { event: { data: { runId: 'run-1' } } } },
    error: new Error('private stack'),
  });
  expect(queries.failGrade).toHaveBeenCalledWith('run-1', undefined);
});
