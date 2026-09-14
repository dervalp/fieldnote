import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { localSandbox } from './local';
import { graderCommand, RUNNER_SOURCE } from './runner';
import { hostileGrader } from './hostile.fixture';
import type { SandboxHandle } from './port';

const limits = { timeoutMs: 5_000, maxOutputBytes: 256 * 1024 };
const handles: SandboxHandle[] = [];
afterEach(async () => {
  while (handles.length) await localSandbox.destroy(handles.pop()!);
});

async function box(program: string) {
  const handle = await localSandbox.create();
  handles.push(handle);
  await localSandbox.write(handle, 'grader.mjs', program);
  await localSandbox.write(handle, 'run.mjs', RUNNER_SOURCE);
  await localSandbox.write(handle, 'input.json', JSON.stringify({ evidence: { tree: [] } }));
  return handle;
}

const hostile = () => hostileGrader({ hostPath: join(process.cwd(), 'package.json'), network: false });

test('a well-behaved program runs and its answer reaches stdout', async () => {
  const handle = await box('export default (evidence) => ({ saw: Object.keys(evidence) });');
  const result = await localSandbox.exec(handle, graderCommand(handle.root), limits);
  expect(result).toMatchObject({ exitCode: 0, timedOut: false, overflowed: false });
  expect(JSON.parse(result.stdout)).toEqual({ saw: ['tree'] });
});

test('the program sees no environment variable from the worker', async () => {
  process.env.FIELDNOTE_SENTINEL = 'secret';
  try {
    const handle = await box(hostile());
    const report = JSON.parse((await localSandbox.exec(handle, graderCommand(handle.root), limits)).stdout);
    expect(report.env).not.toContain('FIELDNOTE_SENTINEL');
    // PATH is always set in the worker; its absence proves nothing was inherited.
    expect(report.env).not.toContain('PATH');
  } finally {
    delete process.env.FIELDNOTE_SENTINEL;
  }
});

test('the program cannot read outside its box, write, or start a process', async () => {
  const handle = await box(hostile());
  const report = JSON.parse((await localSandbox.exec(handle, graderCommand(handle.root), limits)).stdout);
  expect(report).toMatchObject({
    passwd: 'refused',
    host: 'refused',
    write: 'refused',
    spawn: 'refused',
  });
});

test('the same program without --permission is allowed, so the locks above are not vacuous', async () => {
  const handle = await box(hostile());
  const report = JSON.parse(
    (await localSandbox.exec(handle, ['node', `${handle.root}/run.mjs`], limits)).stdout,
  );
  expect(report.passwd).toBe('allowed');
  expect(report.host).toBe('allowed');
});

test('a program that never finishes is killed at the timeout', async () => {
  const handle = await box('export default () => new Promise(() => setInterval(() => {}, 1000));');
  const result = await localSandbox.exec(handle, graderCommand(handle.root), { ...limits, timeoutMs: 500 });
  expect(result.timedOut).toBe(true);
});

test('a program that prints past the cap is killed and flagged', async () => {
  const handle = await box("export default () => 'x'.repeat(300 * 1024);");
  const result = await localSandbox.exec(handle, graderCommand(handle.root), limits);
  expect(result.overflowed).toBe(true);
});

test('a program that throws exits non-zero with nothing on stdout', async () => {
  const handle = await box("export default () => { throw new Error('boom'); };");
  const result = await localSandbox.exec(handle, graderCommand(handle.root), limits);
  expect(result.exitCode).not.toBe(0);
  expect(result.stdout).toBe('');
});

test('destroy removes the box directory', async () => {
  const handle = await box('export default () => ({});');
  handles.pop();
  await localSandbox.destroy(handle);
  await expect(localSandbox.write(handle, 'again.txt', 'x')).rejects.toMatchObject({
    name: 'SandboxUnavailableError',
  });
});
