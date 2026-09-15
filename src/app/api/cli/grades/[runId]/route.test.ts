import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CheckResult } from '../../../../../domain/grading/types';

const { withCliPrincipal, loadGradeRun, accessibleRepositories, graderVersion } = vi.hoisted(
  () => ({
    withCliPrincipal: vi.fn(
      async (_r: Request, _s: string, h: () => Promise<Response>) => await h(),
    ),
    loadGradeRun: vi.fn(),
    accessibleRepositories: vi.fn(),
    graderVersion: vi.fn(),
  }),
);
vi.mock('../../principal', () => ({ withCliPrincipal }));
vi.mock('../../../../../db/queries/grade-runs', () => ({ loadGradeRun }));
vi.mock('../../../../../workspaces/access', () => ({ accessibleRepositories }));
vi.mock('../../../../../db/queries/graders', () => ({ graderVersion }));

import { GET } from './route';

const get = (runId: string) =>
  GET(new Request(`http://localhost/api/cli/grades/${runId}`), {
    params: Promise.resolve({ runId }),
  });

// Carries its own checks: the route derives the check titles it sends from
// the manifest of the version the run was pinned to, not from a separate
// lookup that could answer for a different version.
const manifest = {
  id: 'fieldnote/agent-readiness',
  version: '1.2.0',
  evaluatorVersion: 'x',
  mode: 'deterministic' as const,
  category: 'agent-readiness' as const,
  disclaimer: 'Deterministic checks only; no model was involved.',
  card: { tagline: 'Can an agent work here?', groups: [] },
  checks: [
    { id: 'root-readme', title: 'Project documentation' },
    { id: 'ci-config', title: 'CI configuration' },
  ],
};

const titles = { 'root-readme': 'Project documentation', 'ci-config': 'CI configuration' };

beforeEach(() => {
  vi.clearAllMocks();
  withCliPrincipal.mockImplementation(async (_r, _s, h) => await h());
  accessibleRepositories.mockResolvedValue([{ id: 'r_1' }]);
  graderVersion.mockResolvedValue(manifest);
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

  it('404s with a naming message when the version the run was pinned to is gone', async () => {
    graderVersion.mockResolvedValue(null);
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
    expect(body.error).toMatch(/no longer published/);
  });

  // A finished grade is rendered with the version it was computed with, not
  // whatever this workspace runs today: a grader that has since published
  // 2.0.0 must still send 0.1.0's titles, mode and disclaimer for an old run.
  it('resolves the grader version the run was pinned to, not the newest one', async () => {
    loadGradeRun.mockResolvedValue({
      id: 'gr_1',
      repositoryId: 'r_1',
      graderId: 'fieldnote/agent-readiness',
      state: 'complete',
      sha: 'a'.repeat(40),
      // The run's own column, not result.rubricVersion: the column is what
      // insertGradeRun pinned at request time, and it is what must be asked for.
      rubricVersion: '0.1.0',
      result: { score: 100, checks: [], rubricVersion: '0.1.0', evaluatorVersion: 'eval-1' },
    });

    await get('gr_1');

    expect(graderVersion).toHaveBeenCalledWith('fieldnote/agent-readiness', '0.1.0');
  });
});
