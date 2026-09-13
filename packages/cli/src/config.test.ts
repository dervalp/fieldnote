import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearAuth, readAuth, writeAuth } from './config';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'fieldnote-'));
  process.env.FIELDNOTE_HOME = home;
});
afterEach(() => {
  delete process.env.FIELDNOTE_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe('auth file', () => {
  it('round-trips what was written', async () => {
    await writeAuth({ token: 'fn_abc', login: 'octocat', workspace: 'vertuoza' });
    expect(await readAuth({})).toEqual({
      token: 'fn_abc',
      login: 'octocat',
      workspace: 'vertuoza',
    });
  });

  it('is written 0600, because it is a credential on a laptop', async () => {
    await writeAuth({ token: 'fn_abc', login: 'octocat', workspace: 'vertuoza' });
    const mode = statSync(join(home, '.fieldnote', 'auth.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('is null when nothing has been written', async () => {
    expect(await readAuth({})).toBeNull();
  });

  it('lets FIELDNOTE_TOKEN win, so CI never touches disk', async () => {
    await writeAuth({ token: 'fn_from_disk', login: 'octocat', workspace: 'vertuoza' });
    expect((await readAuth({ FIELDNOTE_TOKEN: 'fn_from_env' }))?.token).toBe('fn_from_env');
  });

  it('honours FIELDNOTE_TOKEN with no file present at all', async () => {
    expect((await readAuth({ FIELDNOTE_TOKEN: 'fn_from_env' }))?.token).toBe('fn_from_env');
  });

  it('forgets the token on clear', async () => {
    await writeAuth({ token: 'fn_abc', login: 'octocat', workspace: 'vertuoza' });
    await clearAuth();
    expect(await readAuth({})).toBeNull();
  });

  it('tightens permissions on a file that already exists with looser ones', async () => {
    await writeAuth({ token: 'fn_abc', login: 'octocat', workspace: 'vertuoza' });
    const path = join(home, '.fieldnote', 'auth.json');
    await chmod(path, 0o644);
    await writeAuth({ token: 'fn_def', login: 'octocat', workspace: 'vertuoza' });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
