import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SandboxUnavailableError } from './errors';
import type { Sandbox } from './port';

/**
 * Tests and `pnpm dev`. A temporary directory and a child process with an
 * empty environment, running the same command the E2B adapter runs. It
 * enforces the filesystem, write and process locks for real; it cannot block
 * the network, because Node 24's permission model has no network permission.
 * Never used in production — see selectSandbox().
 */
export const localSandbox: Sandbox = {
  async create() {
    try {
      // realpath: macOS's tmpdir is a symlink, and --allow-fs-read compares
      // resolved paths.
      const root = await realpath(await mkdtemp(join(tmpdir(), 'fieldnote-grader-')));
      return { id: root, root };
    } catch {
      throw new SandboxUnavailableError(false);
    }
  },
  async write(handle, name, contents) {
    try {
      await writeFile(join(handle.root, name), contents, { encoding: 'utf8', flag: 'wx' });
    } catch {
      throw new SandboxUnavailableError(false);
    }
  },
  exec(handle, command, { timeoutMs, maxOutputBytes }) {
    return new Promise((resolve, reject) => {
      const [program, ...args] = command;
      const child = spawn(program === 'node' ? process.execPath : program, args, {
        cwd: handle.root,
        // Next.js augments NodeJS.ProcessEnv with a required NODE_ENV, which
        // {} does not structurally satisfy; the cast keeps the child's
        // environment genuinely empty at runtime — the process lock the
        // hostile-program tests prove.
        env: {} as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'ignore'] as const,
      });
      const chunks: Buffer[] = [];
      let bytes = 0;
      let timedOut = false;
      let overflowed = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxOutputBytes) {
          overflowed = true;
          child.kill('SIGKILL');
          return;
        }
        chunks.push(chunk);
      });
      child.on('error', () => {
        clearTimeout(timer);
        reject(new SandboxUnavailableError(false));
      });
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        resolve({
          exitCode,
          stdout: overflowed ? '' : Buffer.concat(chunks).toString('utf8'),
          timedOut,
          overflowed,
        });
      });
    });
  },
  async destroy(handle) {
    await rm(handle.root, { recursive: true, force: true });
  },
};
