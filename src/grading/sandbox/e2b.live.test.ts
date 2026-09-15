import { describe, expect, test } from 'vitest';
import { e2bSandbox } from './e2b';
import { graderCommand, RUNNER_SOURCE } from './runner';
import { hostileGrader } from './hostile.fixture';
import { runCodeGrader } from '../run-code';
import { testDisciplineManifest } from '../../domain/grading/graders/test-discipline';
import type { CodeManifest } from '../../domain/grading/manifest';
import type { SandboxHandle } from './port';

const key = process.env.E2B_API_KEY;
const limits = { timeoutMs: 20_000, maxOutputBytes: 256 * 1024 };

// Runs only with a real key: `E2B_API_KEY=… pnpm vitest run src/grading/sandbox/e2b.live.test.ts`.
// This is the one lock `pnpm check` cannot prove offline — see the slice 4
// design, "What is knowingly wrong".
describe.skipIf(!key)('E2B, live', () => {
  test('the base template runs Node with the permission model', async () => {
    const sandbox = e2bSandbox(key!);
    let handle: SandboxHandle | undefined;
    try {
      handle = await sandbox.create();
      const result = await sandbox.exec(
        handle,
        ['node', '--permission', '-e', 'process.stdout.write(process.version)'],
        limits,
      );
      console.info(`E2B base template Node: ${result.stdout || '(none)'} exit ${result.exitCode}`);
      expect(result.exitCode).toBe(0);
      const [major, minor] = result.stdout.replace(/^v/, '').split('.').map(Number);
      expect(major > 22 || (major === 22 && minor >= 13)).toBe(true);
    } finally {
      if (handle) await sandbox.destroy(handle);
    }
  }, 60_000);

  test('the hostile program is refused the network, the environment, the filesystem and processes', async () => {
    const sandbox = e2bSandbox(key!);
    let handle: SandboxHandle | undefined;
    try {
      process.env.FIELDNOTE_SENTINEL = 'secret';
      handle = await sandbox.create();
      await sandbox.write(handle, 'grader.mjs', hostileGrader({ hostPath: '/etc/hostname', network: true }));
      await sandbox.write(handle, 'run.mjs', RUNNER_SOURCE);
      await sandbox.write(handle, 'input.json', JSON.stringify({ evidence: {} }));
      const result = await sandbox.exec(handle, graderCommand(handle.root), limits);
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report).toMatchObject({
        network: 'refused',
        passwd: 'refused',
        host: 'refused',
        write: 'refused',
        spawn: 'refused',
      });
      expect(report.env).not.toContain('FIELDNOTE_SENTINEL');
      expect(report.env).not.toContain('E2B_API_KEY');
    } finally {
      delete process.env.FIELDNOTE_SENTINEL;
      if (handle) await sandbox.destroy(handle);
    }
  }, 60_000);

  test('a real grade runs end to end in a real box', async () => {
    const started = Date.now();
    const { result } = await runCodeGrader(
      testDisciplineManifest as CodeManifest,
      {
        sha: 'a'.repeat(40),
        complete: true,
        documents: [],
        tree: ['src/a.ts', 'src/a.test.ts', 'src/b.ts', 'src/b.test.ts', 'src/c.ts', 'src/c.test.ts',
          'src/d.ts', 'src/d.test.ts', 'src/e.ts', 'src/e.test.ts'].map((path) => ({ path, size: 1 })),
      },
      e2bSandbox(key!),
    );
    console.info(`E2B end-to-end grade took ${Date.now() - started} ms`);
    expect(result.score).toBe(100);
  }, 60_000);
});
