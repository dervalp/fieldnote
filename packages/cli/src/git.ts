import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type GitState = {
  slug: string | null;
  sha: string | null;
  dirtyCount: number;
  unpushedCount: number;
  hasUpstream: boolean;
};

// Accepts every remote form GitHub hands out — scp-style, https, ssh://, and
// https carrying a user:password@ (the form git writes to origin when a
// token is used for auth) — and nothing else. A non-GitHub remote is not an
// error here; it is a repository fieldnote cannot grade, which the blocker
// reports in its own words.
//
// SECURITY: a remote URL can carry a live credential (a PAT, an
// x-access-token). This function returns only the bare owner/name slug —
// never the matched URL, never the userinfo segment — so a credential in
// origin can never reach a returned string, a blocker line, or a log.
export function parseSlug(remoteUrl: string): string | null {
  const match = remoteUrl
    .trim()
    .match(
      /^(?:git@github\.com:|(?:ssh:\/\/)?(?:git@)?(?:https?:\/\/)?(?:[^@/\s]+@)?github\.com\/)(.+?)(?:\.git)?$/,
    );
  if (!match) return null;
  const slug = match[1];
  return /^[^/\s]+\/[^/\s]+$/.test(slug) ? slug : null;
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', args, { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function readGitState(cwd: string): Promise<GitState> {
  const sha = await git(cwd, ['rev-parse', 'HEAD']);
  if (sha === null)
    return { slug: null, sha: null, dirtyCount: 0, unpushedCount: 0, hasUpstream: false };

  const remote = await git(cwd, ['remote', 'get-url', 'origin']);
  const status = await git(cwd, ['status', '--porcelain']);
  const upstream = await git(cwd, ['rev-parse', '--abbrev-ref', '@{u}']);
  const ahead = upstream === null ? null : await git(cwd, ['rev-list', '--count', '@{u}..HEAD']);

  return {
    slug: remote === null ? null : parseSlug(remote),
    sha,
    dirtyCount: status ? status.split('\n').filter(Boolean).length : 0,
    unpushedCount: ahead ? Number(ahead) : 0,
    hasUpstream: upstream !== null,
  };
}

// An error that ends in a command the reader can run is a fix. One that ends in
// a rule is homework.
export function gradeBlocker(
  state: GitState,
): { reason: 'not-a-repo' | 'no-remote' | 'dirty' | 'unpushed'; lines: string[] } | null {
  if (state.sha === null)
    return { reason: 'not-a-repo', lines: ['  This is not a git repository.'] };

  if (state.slug === null)
    return {
      reason: 'no-remote',
      lines: [
        '  This repository has no GitHub remote named origin.',
        '',
        '  fieldnote grades what it can fetch from GitHub.',
      ],
    };

  if (!state.hasUpstream) {
    return {
      reason: 'unpushed',
      lines: [
        '  There is nothing here fieldnote can read yet.',
        '',
        '     this branch has never been pushed',
        '',
        '     fieldnote grades a commit its server can fetch from GitHub.',
        '     Your working tree is not one.',
        '',
        '  WHAT YOU PROBABLY WANT',
        '',
        '    push this branch, then grade its head',
        '      git push && fieldnote run',
        '',
        '    grade a commit that is already pushed',
        `      fieldnote run --sha ${state.sha.slice(0, 7)}`,
        '',
        '    see what has not been graded',
        '      git status --short',
      ],
    };
  }

  if (state.dirtyCount > 0 || state.unpushedCount > 0) {
    const counts = [
      state.dirtyCount > 0
        ? `${state.dirtyCount} file${state.dirtyCount === 1 ? '' : 's'} changed`
        : null,
      state.unpushedCount > 0
        ? `${state.unpushedCount} commit${state.unpushedCount === 1 ? '' : 's'} not pushed`
        : null,
    ].filter(Boolean);

    return {
      reason: state.unpushedCount > 0 ? 'unpushed' : 'dirty',
      lines: [
        '  There is nothing here fieldnote can read yet.',
        '',
        `     ${counts.join(', ')}`,
        '',
        '     fieldnote grades a commit its server can fetch from GitHub.',
        '     Your working tree is not one.',
        '',
        '  WHAT YOU PROBABLY WANT',
        '',
        '    push this branch, then grade its head',
        '      git push && fieldnote run',
        '',
        '    grade a commit that is already pushed',
        `      fieldnote run --sha ${state.sha.slice(0, 7)}`,
        '',
        '    see what has not been graded',
        '      git status --short',
      ],
    };
  }

  return null;
}
