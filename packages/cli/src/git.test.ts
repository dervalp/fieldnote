import { describe, expect, it } from 'vitest';
import { gradeBlocker, parseSlug } from './git.ts';

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
    expect(slug).not.toContain('ghs_secrettoken1234567890');
    expect(slug).not.toContain('x-access-token');
  });
});

const clean = {
  slug: 'dervalp/fieldnote',
  sha: 'a'.repeat(40),
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

  it('refuses unpushed commits, and offers the last pushed sha', () => {
    const blocker = gradeBlocker({ ...clean, unpushedCount: 1 });
    expect(blocker?.reason).toBe('unpushed');
    expect(blocker?.lines.join(' ')).toContain('--sha');
  });

  it('refuses a branch with no upstream, even when clean and unpushed-count is zero', () => {
    // A brand-new local branch with a clean tree has hasUpstream: false,
    // unpushedCount: 0, dirtyCount: 0 — the server would grade the
    // repository's default branch instead, silently.
    const blocker = gradeBlocker({ ...clean, hasUpstream: false });
    expect(blocker?.reason).toBe('unpushed');
    expect(blocker?.lines.join(' ')).toContain('--sha');
  });

  it('names the condition by count, not by adjective', () => {
    // "3 files changed" is checkable; "working tree dirty" is a state the
    // developer has to go and confirm.
    expect(gradeBlocker({ ...clean, dirtyCount: 3 })?.lines.join(' ')).not.toContain('dirty');
  });
});
