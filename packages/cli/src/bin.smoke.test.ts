import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const bin = fileURLToPath(new URL('./bin.ts', import.meta.url));

// Spawns the real binary under the real Node resolver. Every other test in this
// package runs through Vitest's bundler resolver, which resolves extensionless
// relative specifiers that Node does not — so nothing else here can catch a
// binary that cannot start.
describe('the binary actually starts', () => {
  it('prints its version', async () => {
    const { stdout } = await run(process.execPath, [bin, '--version']);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('prints help without a credential', async () => {
    const { stdout } = await run(process.execPath, [bin, '--help']);
    expect(stdout).toContain('USAGE');
  });

  it('exits 3 from whoami when signed out', async () => {
    await expect(
      run(process.execPath, [bin, 'whoami'], {
        env: { ...process.env, FIELDNOTE_HOME: '/nonexistent-fieldnote-home' },
      }),
    ).rejects.toMatchObject({ code: 3 });
  });
});
