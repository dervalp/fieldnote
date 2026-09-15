import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DEMO_READ_ONLY, REPOSITORY_UNAVAILABLE } from '../../../../db/queries/grade-runs';

const {
  withCliPrincipal,
  accessibleRepositories,
  requireWorkspace,
  requestGrade,
  dispatchGrade,
  installedGrader,
} = vi.hoisted(() => ({
  withCliPrincipal: vi.fn(async (_r: Request, _s: string, h: () => Promise<Response>) => await h()),
  accessibleRepositories: vi.fn(),
  requireWorkspace: vi.fn(),
  requestGrade: vi.fn(),
  dispatchGrade: vi.fn(),
  installedGrader: vi.fn(),
}));
vi.mock('../principal', () => ({ withCliPrincipal }));
vi.mock('../../../../workspaces/access', () => ({ accessibleRepositories, requireWorkspace }));
// Re-exports the real DEMO_READ_ONLY / REPOSITORY_UNAVAILABLE constants
// alongside the mocked requestGrade, so these tests throw the actual strings
// grade-runs.ts exports rather than a copy — a reword there cannot leave
// this test file throwing a stale literal that no longer matches route.ts.
vi.mock('../../../../db/queries/grade-runs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../db/queries/grade-runs')>()),
  requestGrade,
}));
vi.mock('../../../../inngest/dispatch-grade', () => ({ dispatchGrade }));
// A grader is a row since slice 6, so "which graders exist here" is a query
// against this workspace's installs, not a module-scope registration.
vi.mock('../../../../db/queries/graders', () => ({ installedGrader }));

import { POST } from './route';

const post = (body: unknown) =>
  new Request('http://localhost/api/cli/grades', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer fn_x' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.resetAllMocks();
  withCliPrincipal.mockImplementation(async (_r, _s, h) => await h());
  accessibleRepositories.mockResolvedValue([{ id: 'r_1', owner: 'dervalp', name: 'fieldnote' }]);
  requireWorkspace.mockResolvedValue({ id: 'w_1', name: 'Acme', role: 'owner' });
  requestGrade.mockResolvedValue({ id: 'gr_1', state: 'queued' });
  installedGrader.mockResolvedValue({
    manifest: { id: 'fieldnote/agent-readiness', mode: 'deterministic' },
    version: '0.1.0',
  });
  dispatchGrade.mockResolvedValue(undefined);
});

describe('POST /api/cli/grades', () => {
  it('resolves a slug to a repository and requests a grade', async () => {
    const response = await POST(post({ repository: 'dervalp/fieldnote', sha: 'a'.repeat(40) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ runId: 'gr_1', mode: 'deterministic' });
    expect(requestGrade).toHaveBeenCalledWith('r_1', 'fieldnote/agent-readiness');
  });

  it('does not echo the caller sha as the graded sha, since requestGrade never pins one', async () => {
    const response = await POST(post({ repository: 'dervalp/fieldnote', sha: 'a'.repeat(40) }));
    const body = await response.json();
    expect(body.requestedSha).toBe('a'.repeat(40));
    expect(body.sha).toBeUndefined();
  });

  it('matches the repository slug case-insensitively', async () => {
    const response = await POST(post({ repository: 'DervalP/FieldNote', sha: 'a'.repeat(40) }));
    expect(response.status).toBe(200);
    expect(requestGrade).toHaveBeenCalledWith('r_1', 'fieldnote/agent-readiness');
  });

  it('dispatches the run', async () => {
    await POST(post({ repository: 'dervalp/fieldnote', sha: 'a'.repeat(40) }));
    expect(dispatchGrade).toHaveBeenCalledWith('gr_1');
  });

  it('still returns the run id when dispatch fails, because reconciliation recovers it', async () => {
    dispatchGrade.mockRejectedValueOnce(new Error('inngest down'));
    const response = await POST(post({ repository: 'dervalp/fieldnote', sha: 'a'.repeat(40) }));
    expect(response.status).toBe(200);
  });

  it('404s a repository this workspace cannot see, the same as one that does not exist', async () => {
    const response = await POST(post({ repository: 'someone/else', sha: 'a'.repeat(40) }));
    expect(response.status).toBe(404);
  });

  it('400s a malformed body', async () => {
    const response = await POST(post({ repository: 'no-slash', sha: 'short' }));
    expect(response.status).toBe(400);
  });

  it('404s a grader this workspace has not installed, instead of falling through to a 503', async () => {
    installedGrader.mockResolvedValue(null);
    const response = await POST(
      post({ repository: 'dervalp/fieldnote', sha: 'a'.repeat(40), grader: 'bogus/grader' }),
    );
    expect(response.status).toBe(404);
    const { error } = await response.json();
    expect(error).toMatch(/bogus\/grader/);
    // A refusal with no next step is homework: the sentence names where to
    // install it, built from the request's own origin.
    expect(error).toContain('http://localhost/app/settings/graders');
    expect(requestGrade).not.toHaveBeenCalled();
  });

  it('asks about the grader in the workspace the token is pinned to', async () => {
    await POST(
      post({ repository: 'dervalp/fieldnote', sha: 'a'.repeat(40), grader: 'fieldnote/other' }),
    );
    expect(installedGrader).toHaveBeenCalledWith('w_1', 'fieldnote/other');
  });

  it('409s a demo workspace — a refusal no re-login can lift, so never a 403', async () => {
    requestGrade.mockRejectedValueOnce(new Error(DEMO_READ_ONLY));
    const response = await POST(post({ repository: 'dervalp/fieldnote', sha: 'a'.repeat(40) }));
    expect(response.status).toBe(409);
  });

  it('names where to connect the repository, rather than stopping at the refusal', async () => {
    // A refusal with no next step is homework. The link is built from the
    // request's own origin — the CLI authenticated against it, so that is
    // where its reader should be sent.
    accessibleRepositories.mockResolvedValue([]);
    const response = await POST(post({ repository: 'dervalp/fieldnote', sha: 'a'.repeat(40) }));
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe(
      'fieldnote is not connected to dervalp/fieldnote. Connect it at http://localhost/app/settings/workspace.',
    );
  });

  it('404s a repository made unavailable by post-lock re-authorization, instead of 503ing', async () => {
    requestGrade.mockRejectedValueOnce(new Error(REPOSITORY_UNAVAILABLE));
    const response = await POST(post({ repository: 'dervalp/fieldnote', sha: 'a'.repeat(40) }));
    expect(response.status).toBe(404);
  });

  it('passes a caller-supplied grader id through to requestGrade', async () => {
    await POST(
      post({ repository: 'dervalp/fieldnote', sha: 'a'.repeat(40), grader: 'fieldnote/other' }),
    );
    expect(requestGrade).toHaveBeenCalledWith('r_1', 'fieldnote/other');
  });

  it('lets an unrelated failure fall through to withCliPrincipal (503)', async () => {
    requestGrade.mockRejectedValueOnce(new Error('boom, unrelated'));
    await expect(
      POST(post({ repository: 'dervalp/fieldnote', sha: 'a'.repeat(40) })),
    ).rejects.toThrow('boom, unrelated');
  });
});
