import { expect, test, vi } from 'vitest';
import { parseManifest, type CodeManifest } from '../domain/grading/manifest';
import { GraderFailedError } from '../domain/grading/code';
import { runCodeGrader } from './run-code';
import { localSandbox } from './sandbox/local';
import { selectSandbox } from './sandbox';
import { SandboxUnavailableError } from './sandbox/errors';
import type { Sandbox } from './sandbox/port';

const manifest = (source: string) =>
  parseManifest({
    id: 'fieldnote/run-code-fixture',
    version: '0.1.0',
    evaluatorVersion: '1.0.0',
    subject: 'repository',
    mode: 'deterministic',
    category: 'test-discipline',
    kind: 'code',
    needs: { 'repo.tree': ['**/*'] },
    code: { source },
    disclaimer: 'Evidence, not certification.',
    card: { title: 'Fixture', tagline: 'Is it?', groups: [{ title: 'All', checks: ['has-files'] }] },
    checks: [
      { id: 'has-files', title: 'Has files', points: 100, explain: { pass: 'Files.', fail: 'None.' } },
    ],
  }) as CodeManifest;
const snapshot = {
  sha: 'a'.repeat(40),
  complete: true,
  documents: [],
  tree: [{ path: 'src/a.ts', size: 1 }],
  metrics: null,
};
const PASSING = `export default ({ tree }) => ({
  checks: [{ id: 'has-files', status: tree.length ? 'pass' : 'fail', paths: tree.map((e) => e.path), count: { matched: tree.length, of: tree.length } }],
});`;

// Records destroy() calls around the real local adapter.
function watched(overrides: Partial<Sandbox> = {}) {
  const destroy = vi.fn(localSandbox.destroy);
  const sandbox: Sandbox = { ...localSandbox, destroy, ...overrides };
  return { sandbox, destroy };
}

test('a program runs in the box and its answer becomes a grade', async () => {
  const { sandbox, destroy } = watched();
  const { result, insufficient } = await runCodeGrader(manifest(PASSING), snapshot, sandbox);
  expect(insufficient).toBe(false);
  expect(result.score).toBe(100);
  expect(result.checks[0]).toMatchObject({
    paths: ['src/a.ts'],
    explanation: 'Files. Measured 1 of 1. Evidence, not certification.',
  });
  expect(destroy).toHaveBeenCalledTimes(1);
});

test('a crashing program is the grader failing, and the box is still destroyed', async () => {
  const { sandbox, destroy } = watched();
  await expect(
    runCodeGrader(manifest("export default () => { throw new Error('boom'); };"), snapshot, sandbox),
  ).rejects.toBeInstanceOf(GraderFailedError);
  expect(destroy).toHaveBeenCalledTimes(1);
});

test('output that is not JSON is the grader failing', async () => {
  await expect(
    runCodeGrader(manifest('export default () => undefined;'), snapshot, localSandbox),
  ).rejects.toBeInstanceOf(GraderFailedError);
});

test('an answer that breaks the contract is the grader failing', async () => {
  await expect(
    runCodeGrader(manifest("export default () => ({ checks: [], note: 'hi' });"), snapshot, localSandbox),
  ).rejects.toBeInstanceOf(GraderFailedError);
});

test('a timed-out or overflowing program is the grader failing', async () => {
  const timedOut = watched({
    exec: async () => ({ exitCode: null, stdout: '', timedOut: true, overflowed: false }),
  });
  await expect(runCodeGrader(manifest(PASSING), snapshot, timedOut.sandbox)).rejects.toBeInstanceOf(
    GraderFailedError,
  );
  const overflowed = watched({
    exec: async () => ({ exitCode: null, stdout: '', timedOut: false, overflowed: true }),
  });
  await expect(runCodeGrader(manifest(PASSING), snapshot, overflowed.sandbox)).rejects.toBeInstanceOf(
    GraderFailedError,
  );
  expect(timedOut.destroy).toHaveBeenCalledTimes(1);
  expect(overflowed.destroy).toHaveBeenCalledTimes(1);
});

test('a substrate failure passes through as unavailable, and the box is still destroyed', async () => {
  const { sandbox, destroy } = watched({
    write: async () => {
      throw new SandboxUnavailableError(true);
    },
  });
  await expect(runCodeGrader(manifest(PASSING), snapshot, sandbox)).rejects.toMatchObject({
    name: 'SandboxUnavailableError',
    retryable: true,
  });
  expect(destroy).toHaveBeenCalledTimes(1);
});

test('a destroy that fails does not replace the outcome', async () => {
  const { sandbox } = watched({
    destroy: async () => {
      throw new Error('already gone');
    },
  });
  const { result } = await runCodeGrader(manifest(PASSING), snapshot, sandbox);
  expect(result.score).toBe(100);
});

test('the program is given its evidence and the limits', async () => {
  const exec = vi.fn(localSandbox.exec);
  const write = vi.fn(localSandbox.write);
  await runCodeGrader(manifest(PASSING), snapshot, { ...localSandbox, exec, write });
  expect(write.mock.calls.map(([, name]) => name)).toEqual(['grader.mjs', 'run.mjs', 'input.json']);
  expect(JSON.parse(write.mock.calls[2][2])).toEqual({ evidence: { tree: snapshot.tree } });
  expect(exec.mock.calls[0][2]).toEqual({ timeoutMs: 20_000, maxOutputBytes: 256 * 1024 });
});

test('production with no E2B key has no sandbox, and never falls back to the local one', () => {
  expect(() => selectSandbox({ NODE_ENV: 'production' })).toThrow(SandboxUnavailableError);
  try {
    selectSandbox({ NODE_ENV: 'production' });
  } catch (error) {
    expect((error as SandboxUnavailableError).retryable).toBe(false);
  }
});

test('development and tests with no key use the local sandbox', () => {
  expect(selectSandbox({ NODE_ENV: 'test' })).toBe(localSandbox);
  expect(selectSandbox({ NODE_ENV: 'development' })).toBe(localSandbox);
});
