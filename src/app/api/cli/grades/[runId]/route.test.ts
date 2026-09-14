import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ManifestError } from '../../../../../domain/grading/manifest';
import type { CheckResult } from '../../../../../domain/grading/types';

const {
  withCliPrincipal,
  loadGradeRun,
  accessibleRepositories,
  graderCheckTitles,
  getGrader,
  registerGrader,
} = vi.hoisted(() => ({
  withCliPrincipal: vi.fn(async (_r: Request, _s: string, h: () => Promise<Response>) => await h()),
  loadGradeRun: vi.fn(),
  accessibleRepositories: vi.fn(),
  graderCheckTitles: vi.fn(),
  getGrader: vi.fn(),
  // The route imports agent-readiness.ts for its registration side effect,
  // and that module calls registerGrader() at module scope — so a registry
  // mock that omits it fails at import time. Stubbed rather than real: this
  // file's subject is the response shape, and registry.test.ts alongside it
  // is the one that exercises the real registration.
  registerGrader: vi.fn(),
}));
vi.mock('../../principal', () => ({ withCliPrincipal }));
vi.mock('../../../../../db/queries/grade-runs', () => ({ loadGradeRun }));
vi.mock('../../../../../workspaces/access', () => ({ accessibleRepositories }));
vi.mock('../../../../../domain/grading/registry', () => ({
  graderCheckTitles,
  getGrader,
  registerGrader,
}));

import { GET } from './route';

const get = (runId: string) =>
  GET(new Request(`http://localhost/api/cli/grades/${runId}`), {
    params: Promise.resolve({ runId }),
  });

const manifest = {
  id: 'fieldnote/agent-readiness',
  version: '1.2.0',
  evaluatorVersion: 'x',
  mode: 'deterministic' as const,
  category: 'agent-readiness' as const,
  disclaimer: 'Deterministic checks only; no model was involved.',
  card: { tagline: 'Can an agent work here?', groups: [] },
};

const titles = { 'root-readme': 'Project documentation', 'ci-config': 'CI configuration' };

beforeEach(() => {
  vi.clearAllMocks();
  withCliPrincipal.mockImplementation(async (_r, _s, h) => await h());
  accessibleRepositories.mockResolvedValue([{ id: 'r_1' }]);
  graderCheckTitles.mockReturnValue(titles);
  getGrader.mockReturnValue(manifest);
});

describe('GET /api/cli/grades/[runId]', () => {
  it('reports a running state without a result', async () => {
    loadGradeRun.mockResolvedValue({
      id: 'gr_1',
      repositoryId: 'r_1',
      state: 'running',
      graderId: 'g',
      sha: null,
      result: null,
    });
    expect(await (await get('gr_1')).json()).toEqual({ state: 'running' });
  });

  it('404s a run belonging to a repository this workspace cannot see', async () => {
    accessibleRepositories.mockResolvedValue([{ id: 'r_other' }]);
    loadGradeRun.mockResolvedValue({ id: 'gr_1', repositoryId: 'r_1', state: 'complete' });
    expect((await get('gr_1')).status).toBe(404);
  });

  it('404s an unknown run', async () => {
    loadGradeRun.mockResolvedValue(null);
    expect((await get('gr_1')).status).toBe(404);
  });

  it('returns the full shape once complete, presenting the grade and naming the next tier moves', async () => {
    const checks: CheckResult[] = [
      {
        id: 'root-readme',
        points: 20,
        maxPoints: 20,
        status: 'pass',
        paths: ['README.md'],
        lineRanges: [],
        explanation: 'README exists.',
      },
      {
        id: 'ci-config',
        points: 0,
        maxPoints: 20,
        status: 'fail',
        paths: [],
        lineRanges: [],
        explanation: 'No CI configuration found.',
      },
    ];
    loadGradeRun.mockResolvedValue({
      id: 'gr_1',
      repositoryId: 'r_1',
      graderId: 'fieldnote/agent-readiness',
      state: 'complete',
      sha: 'a'.repeat(40),
      result: {
        score: 80,
        checks,
        rubricVersion: '0.1.0',
        evaluatorVersion: 'eval-1',
      },
    });

    const response = await get('gr_1');
    const body = await response.json();

    expect(body).toEqual({
      state: 'complete',
      score: 80,
      checks,
      titles,
      graderId: 'fieldnote/agent-readiness',
      graderVersion: '1.2.0',
      rubricVersion: '0.1.0',
      evaluatorVersion: 'eval-1',
      mode: 'deterministic',
      tagline: 'Can an agent work here?',
      disclaimer: 'Deterministic checks only; no model was involved.',
      gradedSha: 'a'.repeat(40),
      presentation: { label: 'Very good', finish: 'Silver · Holographic' },
      nextTier: {
        targetScore: 100,
        targetFinish: 'Prismatic',
        moves: [{ id: 'ci-config', title: 'CI configuration', points: 20 }],
      },
      url: 'http://localhost/app/repos/r_1/grading',
    });
  });

  it('sends presentation and nextTier as null, never a 0 score, when evidence collection was incomplete', async () => {
    loadGradeRun.mockResolvedValue({
      id: 'gr_1',
      repositoryId: 'r_1',
      graderId: 'fieldnote/agent-readiness',
      state: 'complete',
      sha: null,
      result: {
        score: null,
        checks: [],
        rubricVersion: '0.1.0',
        evaluatorVersion: 'eval-1',
        incompleteReason: 'The repository snapshot could not be collected in full.',
      },
    });

    const body = await (await get('gr_1')).json();

    expect(body.score).toBeNull();
    expect(body.presentation).toBeNull();
    expect(body.nextTier).toBeNull();
    expect(body.gradedSha).toBeNull();
    expect(body.incompleteReason).toBe('The repository snapshot could not be collected in full.');
    expect(JSON.stringify(body)).not.toContain('"score":0');
  });

  it('surfaces the error code on a failed run', async () => {
    loadGradeRun.mockResolvedValue({
      id: 'gr_1',
      repositoryId: 'r_1',
      state: 'failed',
      graderId: 'g',
      sha: null,
      result: null,
      errorCode: 'collection_failed',
    });
    expect(await (await get('gr_1')).json()).toEqual({
      state: 'failed',
      errorCode: 'collection_failed',
    });
  });

  it('sends nextTier as null for a valid, non-null score with nothing left to improve', async () => {
    loadGradeRun.mockResolvedValue({
      id: 'gr_1',
      repositoryId: 'r_1',
      graderId: 'fieldnote/agent-readiness',
      state: 'complete',
      sha: 'a'.repeat(40),
      result: {
        score: 100,
        checks: [
          {
            id: 'root-readme',
            points: 20,
            maxPoints: 20,
            status: 'pass',
            paths: ['README.md'],
            lineRanges: [],
            explanation: 'README exists.',
          },
        ],
        rubricVersion: '0.1.0',
        evaluatorVersion: 'eval-1',
      },
    });

    const body = await (await get('gr_1')).json();

    expect(body.score).toBe(100);
    expect(body.presentation).toEqual({ label: 'Excellent', finish: 'Prismatic · Perfect score' });
    expect(body.nextTier).toBeNull();
  });

  it('reports a bare complete state when a complete run somehow carries no result', async () => {
    loadGradeRun.mockResolvedValue({
      id: 'gr_1',
      repositoryId: 'r_1',
      graderId: 'fieldnote/agent-readiness',
      state: 'complete',
      sha: null,
      result: null,
    });
    expect(await (await get('gr_1')).json()).toEqual({ state: 'complete' });
  });

  it('sets a private, no-store Cache-Control header on a success and on a 404', async () => {
    loadGradeRun.mockResolvedValue({
      id: 'gr_1',
      repositoryId: 'r_1',
      state: 'running',
      graderId: 'g',
      sha: null,
      result: null,
    });
    expect((await get('gr_1')).headers.get('Cache-Control')).toBe('private, no-store');

    loadGradeRun.mockResolvedValue(null);
    expect((await get('gr_2')).headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('404s with a naming message when the run belongs to a grader that is no longer registered', async () => {
    getGrader.mockImplementation(() => {
      throw new ManifestError('unknown_grader', "No grader 'ghost/grader' is registered.");
    });
    loadGradeRun.mockResolvedValue({
      id: 'gr_1',
      repositoryId: 'r_1',
      graderId: 'ghost/grader',
      state: 'complete',
      sha: 'b'.repeat(40),
      result: { score: 50, checks: [], rubricVersion: '0.1.0', evaluatorVersion: 'eval-1' },
    });

    const response = await get('gr_1');
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toMatch(/ghost\/grader/);
    expect(body.error).toMatch(/no longer registered/);
  });
});
