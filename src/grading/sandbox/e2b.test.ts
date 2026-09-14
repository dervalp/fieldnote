import { CommandExitError, TimeoutError } from 'e2b';
import { afterEach, expect, test, vi } from 'vitest';
import { e2bSandbox } from './e2b';
import { SandboxUnavailableError } from './errors';

const SECRET = 'e2b_test_secret_value';
const limits = { timeoutMs: 20_000, maxOutputBytes: 256 * 1024 };

// A background command handle, as `commands.run(cmd, { background: true })`
// resolves to. `wait` defaults to an immediate, successful result; override it
// to simulate an exit code, a timeout, or a command that never finishes on
// its own (so the adapter's own kill() is what ends it).
function fakeHandle(wait: () => Promise<unknown> = async () => ({ exitCode: 0, stdout: '{}', stderr: '' })) {
  return { pid: 1, wait: vi.fn(wait), kill: vi.fn(async () => true) };
}

// `run`'s mock stands in for `commands.run(cmd, opts)`. It receives the exact
// opts the adapter passed — including `onStdout` — so a test can drive
// streamed output before handing back the handle.
function fakeSdk(run: (command: string, opts: { onStdout?: (chunk: string) => void }) => Promise<unknown> = async () => fakeHandle()) {
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

afterEach(() => {
  vi.useRealTimers();
});

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
  expect(box.commands.run).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ envs: {}, background: true }));
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
  const { sdk } = fakeSdk(async () =>
    fakeHandle(async () => {
      throw new CommandExitError({ exitCode: 1, stdout: '', stderr: 'boom', error: undefined });
    }),
  );
  const sandbox = e2bSandbox(SECRET, sdk);
  const result = await sandbox.exec(await sandbox.create(), ['node'], limits);
  expect(result).toEqual({ exitCode: 1, stdout: '', timedOut: false, overflowed: false });
});

test("the command's own deadline elapsing is the program timing out, and the box is killed", async () => {
  vi.useFakeTimers();
  const handle = fakeHandle(() => new Promise(() => {})); // never settles on its own
  const { sdk } = fakeSdk(async () => handle);
  const sandbox = e2bSandbox(SECRET, sdk);
  const created = await sandbox.create();
  const resultPromise = sandbox.exec(created, ['node'], limits);
  await vi.advanceTimersByTimeAsync(limits.timeoutMs);
  expect(await resultPromise).toEqual({ exitCode: null, stdout: '', timedOut: true, overflowed: false });
  expect(handle.kill).toHaveBeenCalledTimes(1);
});

test('a TimeoutError arriving before the deadline is a retryable outage, not the program timing out', async () => {
  const { sdk } = fakeSdk(async () =>
    fakeHandle(async () => {
      // Per node_modules/e2b/dist/index.js ~1506-1541, this same error class
      // also covers a request timeout, an unreachable box, and a box the
      // health probe found dead — none of which is the program running long.
      throw new TimeoutError('unavailable: sandbox timeout');
    }),
  );
  const sandbox = e2bSandbox(SECRET, sdk);
  const result = await sandbox.exec(await sandbox.create(), ['node'], limits).catch((caught) => caught);
  expect(result).toBeInstanceOf(SandboxUnavailableError);
  expect((result as SandboxUnavailableError).retryable).toBe(true);
});

test('output past the cap is flagged and discarded while it is still streaming, and the box is killed', async () => {
  const handle = fakeHandle(() => new Promise(() => {})); // never settles on its own
  const { sdk } = fakeSdk(async (_command, opts) => {
    // Fires on a later macrotask, once the adapter has the handle in hand —
    // as real streamed output would arrive well after the command starts —
    // not synchronously inside `run`, before there is anything to kill yet.
    setTimeout(() => opts.onStdout?.('x'.repeat(limits.maxOutputBytes + 1)), 0);
    return handle;
  });
  const sandbox = e2bSandbox(SECRET, sdk);
  const result = await sandbox.exec(await sandbox.create(), ['node'], limits);
  expect(result).toEqual({ exitCode: null, stdout: '', timedOut: false, overflowed: true });
  expect(handle.kill).toHaveBeenCalledTimes(1);
});

test('any other failure is a retryable outage carrying no vendor message', async () => {
  const { sdk } = fakeSdk(async () =>
    fakeHandle(async () => {
      throw new Error(`upstream said ${SECRET}`);
    }),
  );
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

test('a failure starting the command is also a retryable outage', async () => {
  const { sdk } = fakeSdk(async () => {
    throw new Error('503');
  });
  const sandbox = e2bSandbox(SECRET, sdk);
  const error = await sandbox.exec(await sandbox.create(), ['node'], limits).catch((caught) => caught);
  expect(error).toBeInstanceOf(SandboxUnavailableError);
  expect((error as SandboxUnavailableError).retryable).toBe(true);
});

test('destroy kills the box', async () => {
  const { sdk, box } = fakeSdk();
  const sandbox = e2bSandbox(SECRET, sdk);
  await sandbox.destroy(await sandbox.create());
  expect(box.kill).toHaveBeenCalledTimes(1);
});
