import { CommandExitError, TimeoutError } from 'e2b';
import { expect, test, vi } from 'vitest';
import { e2bSandbox } from './e2b';
import { SandboxUnavailableError } from './errors';

const SECRET = 'e2b_test_secret_value';
const limits = { timeoutMs: 20_000, maxOutputBytes: 256 * 1024 };

function fakeSdk(run: (command: string, opts: unknown) => Promise<unknown> = async () => ({ exitCode: 0, stdout: '{}', stderr: '' })) {
  const box = {
    sandboxId: 'box-1',
    files: { write: vi.fn(async () => ({})) },
    commands: { run: vi.fn(run) },
    kill: vi.fn(async () => true),
  };
  const sdk = { create: vi.fn(async () => box) };
  // Cast once here: the fake satisfies the calls the adapter makes, not the
  // SDK's full declared types.
  return { sdk: sdk as never, create: sdk.create, box };
}

test('a box is created with no internet, no environment and a one-minute life', async () => {
  const { sdk, create } = fakeSdk();
  await e2bSandbox(SECRET, sdk).create();
  expect(create).toHaveBeenCalledWith({
    apiKey: SECRET,
    allowInternetAccess: false,
    envs: {},
    timeoutMs: 60_000,
  });
});

test('the key reaches the SDK and nothing that enters the box', async () => {
  const { sdk, box } = fakeSdk();
  const sandbox = e2bSandbox(SECRET, sdk);
  const handle = await sandbox.create();
  await sandbox.write(handle, 'grader.mjs', 'export default () => ({});');
  await sandbox.exec(handle, ['node', '--permission', `--allow-fs-read=${handle.root}`, `${handle.root}/run.mjs`], limits);
  expect(JSON.stringify(box.files.write.mock.calls)).not.toContain(SECRET);
  expect(JSON.stringify(box.commands.run.mock.calls)).not.toContain(SECRET);
  expect(box.commands.run).toHaveBeenCalledWith(expect.any(String), { envs: {}, timeoutMs: 20_000 });
  expect(box.files.write).toHaveBeenCalledWith('/home/user/grader/grader.mjs', 'export default () => ({});');
});

test('every argument is shell-quoted', async () => {
  const { sdk, box } = fakeSdk();
  const sandbox = e2bSandbox(SECRET, sdk);
  const handle = await sandbox.create();
  await sandbox.exec(handle, ['node', '-e', "console.log('it''s')"], limits);
  expect(box.commands.run.mock.calls[0][0]).toBe(`'node' '-e' 'console.log('\\''it'\\'''\\''s'\\'')'`);
});

test("a non-zero exit is the program's outcome, not an outage", async () => {
  const { sdk } = fakeSdk(async () => {
    throw new CommandExitError({ exitCode: 1, stdout: '', stderr: 'boom', error: undefined });
  });
  const sandbox = e2bSandbox(SECRET, sdk);
  const result = await sandbox.exec(await sandbox.create(), ['node'], limits);
  expect(result).toEqual({ exitCode: 1, stdout: '', timedOut: false, overflowed: false });
});

test('a command timeout is the program timing out', async () => {
  const { sdk } = fakeSdk(async () => {
    throw new TimeoutError('command timed out');
  });
  const sandbox = e2bSandbox(SECRET, sdk);
  const result = await sandbox.exec(await sandbox.create(), ['node'], limits);
  expect(result.timedOut).toBe(true);
});

test('output past the cap is flagged and discarded', async () => {
  const { sdk } = fakeSdk(async () => ({ exitCode: 0, stdout: 'x'.repeat(limits.maxOutputBytes + 1), stderr: '' }));
  const sandbox = e2bSandbox(SECRET, sdk);
  const result = await sandbox.exec(await sandbox.create(), ['node'], limits);
  expect(result).toMatchObject({ overflowed: true, stdout: '' });
});

test('any other failure is a retryable outage carrying no vendor message', async () => {
  const { sdk } = fakeSdk(async () => {
    throw new Error(`upstream said ${SECRET}`);
  });
  const sandbox = e2bSandbox(SECRET, sdk);
  const handle = await sandbox.create();
  const error = await sandbox.exec(handle, ['node'], limits).catch((caught) => caught);
  expect(error).toBeInstanceOf(SandboxUnavailableError);
  expect(error.retryable).toBe(true);
  expect(error.message).not.toContain(SECRET);

  const refusing = { create: vi.fn(async () => { throw new Error('503'); }) };
  await expect(e2bSandbox(SECRET, refusing as never).create()).rejects.toMatchObject({
    name: 'SandboxUnavailableError',
    retryable: true,
  });
});

test('destroy kills the box', async () => {
  const { sdk, box } = fakeSdk();
  const sandbox = e2bSandbox(SECRET, sdk);
  await sandbox.destroy(await sandbox.create());
  expect(box.kill).toHaveBeenCalledTimes(1);
});
