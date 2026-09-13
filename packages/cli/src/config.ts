import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Env } from './render.ts';

export type Auth = { token: string; login: string; workspace: string };

// Where the credential this process is using actually came from. `logout`
// revokes what it finds, and a token synthesised from FIELDNOTE_TOKEN lives
// in someone's secret store rather than on this machine — revoking that
// server-side kills a credential this machine never owned and cannot
// replace.
export type AuthSource = 'env' | 'file';
export type ResolvedAuth = Auth & { source: AuthSource };

// FIELDNOTE_HOME exists for tests. Everything else reads the real home.
const root = () => join(process.env.FIELDNOTE_HOME ?? homedir(), '.fieldnote');
const authPath = () => join(root(), 'auth.json');

export async function readAuth(env: Env): Promise<ResolvedAuth | null> {
  // Precedence, highest first: the environment, then the file, then signed
  // out. A token in an environment variable is the CI path and never touches
  // disk.
  if (env.FIELDNOTE_TOKEN)
    return {
      token: env.FIELDNOTE_TOKEN,
      login: 'FIELDNOTE_TOKEN',
      workspace: 'FIELDNOTE_TOKEN',
      source: 'env',
    };
  try {
    return { ...(JSON.parse(await readFile(authPath(), 'utf8')) as Auth), source: 'file' };
  } catch {
    return null;
  }
}

export async function writeAuth(value: Auth): Promise<void> {
  await mkdir(root(), { recursive: true, mode: 0o700 });
  await writeFile(authPath(), JSON.stringify(value, null, 2), { mode: 0o600 });
  // `mode` above only applies when the file is created. Re-assert it so a file
  // that arrived with looser permissions is tightened rather than preserved.
  await chmod(authPath(), 0o600);
}

export async function clearAuth(): Promise<void> {
  await rm(authPath(), { force: true });
}
