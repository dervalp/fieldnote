import { CommandExitError, Sandbox as E2BSandbox, TimeoutError, type SandboxOpts } from 'e2b';
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
      try {
        const result = await box(handle.id).commands.run(command.map(quote).join(' '), {
          envs: {},
          timeoutMs,
        });
        return shaped(result.exitCode, result.stdout, maxOutputBytes);
      } catch (error) {
        if (error instanceof CommandExitError)
          return shaped(error.exitCode, error.stdout, maxOutputBytes);
        if (error instanceof TimeoutError)
          return { exitCode: null, stdout: '', timedOut: true, overflowed: false };
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
