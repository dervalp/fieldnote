import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expandSha, gradeBlocker, parseSlug } from './git.ts';

describe('parseSlug', () => {
  it('reads every remote form GitHub hands out', () => {
    expect(parseSlug('git@github.com:dervalp/fieldnote.git')).toBe('dervalp/fieldnote');
    expect(parseSlug('https://github.com/dervalp/fieldnote.git')).toBe('dervalp/fieldnote');
    expect(parseSlug('https://github.com/dervalp/fieldnote')).toBe('dervalp/fieldnote');
    expect(parseSlug('ssh://git@github.com/dervalp/fieldnote.git')).toBe('dervalp/fieldnote');
  });

  it('returns null for a remote that is not GitHub', () => {
    expect(parseSlug('https://gitlab.com/a/b.git')).toBeNull();
    expect(parseSlug('')).toBeNull();
  });

  it('accepts a remote URL carrying credentials, and never leaks them', () => {
    // git writes this form to origin when a token is used for auth (CI, gh
    // auth, a PAT pasted into the remote). The credential must never surface
    // in the parsed result — parseSlug returns only the bare owner/name.
    const withCreds =
      'https://x-access-token:ghs_secrettoken1234567890@github.com/dervalp/fieldnote.git';
    const slug = parseSlug(withCreds);
    expect(slug).toBe('dervalp/fieldnote');
    // These two cannot fail on their own — toBe above already pins the exact
    // value — so they are not a guarantee. The real guarantee is structural:
    // GitState has no URL field, so a credential cannot reach gradeBlocker.
    // Kept as documentation of intent for a future reader of this test.
    expect(slug).not.toContain('ghs_secrettoken1234567890');
    expect(slug).not.toContain('x-access-token');
  });

  it('rejects a host that merely starts with github.com', () => {
    // [^@/\s]+ cannot span a '.', but this guards the literal anyway: a
    // future loosening of the userinfo segment must not let a suffixed host
    // slip past the github.com match.
    expect(parseSlug('https://github.com.evil.example/owner/repo')).toBeNull();
  });

  it('rejects a userinfo segment that displaces the host with another @', () => {
    // If [^@/\s]+ were ever loosened to something that can span '@' (e.g.
    // '.+'), this URL would parse as owner/repo against evil.example instead
    // of being rejected. [^@/\s]+ cannot span '@', so it is rejected today —
    // this test pins that it stays rejected.
    expect(parseSlug('https://github.com@evil.example/owner/repo')).toBeNull();
  });

  it('matches the host case-insensitively', () => {
    // DNS is case-insensitive; a remote written as GitHub.com is exactly as
    // real as github.com, and telling the developer they have no GitHub
    // remote when they do is a lie.
    expect(parseSlug('https://GitHub.com/dervalp/fieldnote.git')).toBe('dervalp/fieldnote');
  });
});

const clean = {
  slug: 'dervalp/fieldnote',
  sha: 'a'.repeat(40),
  upstreamSha: 'b'.repeat(40),
  dirtyCount: 0,
  unpushedCount: 0,
  hasUpstream: true,
};

describe('gradeBlocker', () => {
  it('permits a clean, pushed tree', () => {
    expect(gradeBlocker(clean)).toBeNull();
  });

  it('refuses outside a repository', () => {
    expect(gradeBlocker({ ...clean, slug: null, sha: null })?.reason).toBe('not-a-repo');
  });

  it('refuses with no GitHub remote', () => {
    expect(gradeBlocker({ ...clean, slug: null })?.reason).toBe('no-remote');
  });

  it('refuses modified files, and names the count', () => {
    const blocker = gradeBlocker({ ...clean, dirtyCount: 3 });
    expect(blocker?.reason).toBe('dirty');
    expect(blocker?.lines.join(' ')).toContain('3');
  });

  it('refuses unpushed commits, and offers the upstream sha rather than the unpushed one', () => {
    // This branch is entered *because* HEAD is not pushed, so offering
    // state.sha under "already on GitHub" would offer, by construction, the
    // one commit the server cannot fetch. The upstream head is the last sha
    // that is actually there.
    const blocker = gradeBlocker({ ...clean, unpushedCount: 1 });
    expect(blocker?.reason).toBe('unpushed');
    const lines = blocker?.lines.join(' ') ?? '';
    expect(lines).toContain(`--sha ${clean.upstreamSha.slice(0, 7)}`);
    expect(lines).not.toContain(clean.sha.slice(0, 7));
  });

  it('omits the --sha offer when the upstream head is unreadable', () => {
    // Nothing to offer is better than offering a sha that was never resolved.
    const blocker = gradeBlocker({ ...clean, unpushedCount: 1, upstreamSha: null });
    expect(blocker?.reason).toBe('unpushed');
    expect(blocker?.lines.join(' ')).not.toContain('--sha');
  });

  it('refuses a branch with no upstream, even when clean and unpushed-count is zero', () => {
    // A brand-new local branch with a clean tree has hasUpstream: false,
    // unpushedCount: 0, dirtyCount: 0 — the server would grade the
    // repository's default branch instead, silently.
    const blocker = gradeBlocker({ ...clean, hasUpstream: false });
    expect(blocker?.reason).toBe('unpushed');
    // Not --sha or git status --short: this branch has no pushed sha to
    // offer, and a bare `git push` fails here (no upstream configured), so
    // the fix is -u, not the dirty/unpushed tail's three commands.
    expect(blocker?.lines.join(' ')).toContain('-u origin HEAD');
    expect(blocker?.lines.join(' ')).not.toContain('--sha');
  });

  it('names the condition by count, not by adjective', () => {
    // "3 files changed" is checkable; "working tree dirty" is a state the
    // developer has to go and confirm.
    expect(gradeBlocker({ ...clean, dirtyCount: 3 })?.lines.join(' ')).not.toContain('dirty');
  });
});

describe('expandSha', () => {
  // A real repository, not a mock: the whole point of this function is that
  // git itself is the authority on whether an abbreviation names a commit.
  const run = promisify(execFile);
  let repo: string;
  let sha: string;

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), 'fieldnote-git-'));
    await run('git', ['init', '-q'], { cwd: repo });
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    await run('git', ['config', 'user.name', 'test'], { cwd: repo });
    writeFileSync(join(repo, 'README.md'), '# x\n');
    await run('git', ['add', 'README.md'], { cwd: repo });
    await run('git', ['commit', '-qm', 'first'], { cwd: repo });
    sha = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('expands the abbreviation its own blocker copy offers to the 40 characters the server requires', async () => {
    expect(await expandSha(repo, sha.slice(0, 7))).toBe(sha);
  });

  it('leaves a full sha unchanged', async () => {
    expect(await expandSha(repo, sha)).toBe(sha);
  });

  it('is null for a commit this repository does not have', async () => {
    expect(await expandSha(repo, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toBeNull();
  });

  it('is null outside a repository', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'fieldnote-nogit-'));
    try {
      expect(await expandSha(empty, sha)).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
