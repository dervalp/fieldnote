import { CommandExitError, Sandbox as E2BSandbox, type CommandHandle, type SandboxOpts } from 'e2b';
import { SandboxUnavailableError } from './errors';
import type { ExecResult, Sandbox } from './port';

type E2BBox = Pick<E2BSandbox, 'sandboxId' | 'kill'> & {
  files: Pick<E2BSandbox['files'], 'write'>;
  commands: Pick<E2BSandbox['commands'], 'run'>;
};
// `Sandbox.create` is overloaded (`(opts?)` and `(template, opts?)`), and
// `Parameters<typeof E2BSandbox.create>[0]` resolves to the last overload's
// first parameter — `string`, the template — not `SandboxOpts`. Name the
// options type directly instead.
type E2BSdk = { create(opts: SandboxOpts): Promise<E2BBox> };

// Inside the box, the default user's home. Fixed, so it can appear in the
// command without escaping surprises.
const ROOT = '/home/user/grader';

const quote = (argument: string) => `'${argument.replace(/'/g, `'\\''`)}'`;

function shaped(exitCode: number, stdout: string, maxOutputBytes: number): ExecResult {
  const overflowed = Buffer.byteLength(stdout, 'utf8') > maxOutputBytes;
  return { exitCode, stdout: overflowed ? '' : stdout, timedOut: false, overflowed };
}

// What ends a running command, from the adapter's own point of view rather
// than the SDK's. Deliberately not a `TimeoutError` branch: see the comment
// in `exec` below for why that error is never trusted to mean "the program
// timed out".
type Outcome =
  | { readonly kind: 'ok'; readonly exitCode: number; readonly stdout: string }
  | { readonly kind: 'exit'; readonly exitCode: number; readonly stdout: string }
  | { readonly kind: 'overflow' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'outage' };

/**
 * Production. A fresh E2B box per run with internet access off, no
 * environment, and a sixty-second life so a box whose destroy fails dies on its
 * own. The API key reaches the SDK and nothing that enters the box. Every
 * vendor failure becomes a retryable SandboxUnavailableError with no vendor
 * message.
 */
export function e2bSandbox(apiKey: string, sdk: E2BSdk = E2BSandbox as unknown as E2BSdk): Sandbox {
  const boxes = new Map<string, E2BBox>();
  const box = (id: string) => {
    const found = boxes.get(id);
    if (!found) throw new SandboxUnavailableError(true);
    return found;
  };
  return {
    async create() {
      try {
        const created = await sdk.create({
          apiKey,
          allowInternetAccess: false,
          envs: {},
          timeoutMs: 60_000,
        });
        boxes.set(created.sandboxId, created);
        return { id: created.sandboxId, root: ROOT };
      } catch {
        throw new SandboxUnavailableError(true);
      }
    },
    async write(handle, name, contents) {
      try {
        await box(handle.id).files.write(`${handle.root}/${name}`, contents);
      } catch {
        throw new SandboxUnavailableError(true);
      }
    },
    async exec(handle, command, { timeoutMs, maxOutputBytes }) {
      // The command runs in background mode, watched by hand, for two reasons:
      //
      // 1. `TimeoutError` from `wait()` (node_modules/e2b/dist/index.js
      //    ~1506-1541) is not only the command's own deadline: the same class
      //    also covers an exceeded `requestTimeoutMs` (gRPC `Canceled`), a
      //    gRPC `Unavailable` (sandbox/box timeout), and a box the SDK's
      //    health probe found dead mid-request. Those three are outages, not
      //    the program running long — so this adapter never infers a program
      //    timeout from the *type* of error the SDK throws. Instead it runs
      //    the command in the background, times the command's own deadline
      //    itself, and kills the handle when that fires. Whatever `wait()`
      //    then does is irrelevant: the outcome is already decided.
      // 2. A foreground `run()` only returns once the SDK has buffered the
      //    command's entire stdout, so a program that streams for the whole
      //    20s deadline sits fully in memory before the 256 KiB cap can be
      //    checked. Background mode's `onStdout` callback counts bytes as
      //    they arrive and kills the command the moment the cap is crossed,
      //    so the cap is enforced while streaming, not after.
      let bytes = 0;
      let outcome: Outcome | undefined;
      let settle!: (outcome: Outcome) => void;
      const settled = new Promise<Outcome>((resolve) => {
        settle = resolve;
      });
      const finish = (result: Outcome) => {
        if (outcome) return;
        outcome = result;
        settle(result);
      };
      let running: CommandHandle | undefined;
      // Fire-and-forget: the outcome is already decided by `finish`, so a
      // kill that itself fails (the box already gone, say) must not surface
      // as an unhandled rejection.
      const stop = () => void running?.kill().catch(() => {});
      const onStdout = (chunk: string) => {
        bytes += Buffer.byteLength(chunk, 'utf8');
        if (bytes > maxOutputBytes) {
          finish({ kind: 'overflow' });
          stop();
        }
      };
      const timer = setTimeout(() => {
        finish({ kind: 'timeout' });
        stop();
      }, timeoutMs);
      try {
        running = await box(handle.id).commands.run(command.map(quote).join(' '), {
          envs: {},
          background: true,
          timeoutMs: 0, // The SDK's own deadline is disabled; ours is authoritative.
          onStdout,
        });
      } catch {
        clearTimeout(timer);
        throw new SandboxUnavailableError(true);
      }
      running.wait().then(
        (result) => finish({ kind: 'ok', exitCode: result.exitCode, stdout: result.stdout }),
        (error) =>
          finish(
            error instanceof CommandExitError
              ? { kind: 'exit', exitCode: error.exitCode, stdout: error.stdout }
              : { kind: 'outage' },
          ),
      );
      const settledOutcome = await settled;
      clearTimeout(timer);
      switch (settledOutcome.kind) {
        case 'overflow':
          return { exitCode: null, stdout: '', timedOut: false, overflowed: true };
        case 'timeout':
          return { exitCode: null, stdout: '', timedOut: true, overflowed: false };
        case 'ok':
        case 'exit':
          return shaped(settledOutcome.exitCode, settledOutcome.stdout, maxOutputBytes);
        case 'outage':
          throw new SandboxUnavailableError(true);
      }
    },
    async destroy(handle) {
      const found = boxes.get(handle.id);
      boxes.delete(handle.id);
      await found?.kill();
    },
  };
}
