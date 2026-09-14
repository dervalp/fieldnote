import { describe, expect, it, vi, beforeEach } from 'vitest';

// The sibling route.test.ts mocks the grader registry wholesale, which is
// exactly why a missing registration was invisible there: a mocked getGrader
// answers for a grader nothing ever registered. This file mocks everything
// *except* the registry, so it fails the moment route.ts stops importing the
// module that registers the built-in.
//
// Deliberately a literal rather than the AGENT_READINESS constant: importing
// that constant pulls in agent-readiness.ts, which registers the grader as a
// module-scope side effect — the test would then pass whether or not the
// route imports it.
const AGENT_READINESS = 'fieldnote/agent-readiness';

const { withCliPrincipal, loadGradeRun, accessibleRepositories } = vi.hoisted(() => ({
  withCliPrincipal: vi.fn(async (_r: Request, _s: string, h: () => Promise<Response>) => await h()),
  loadGradeRun: vi.fn(),
  accessibleRepositories: vi.fn(),
}));
vi.mock('../../principal', () => ({ withCliPrincipal }));
vi.mock('../../../../../db/queries/grade-runs', () => ({ loadGradeRun }));
vi.mock('../../../../../workspaces/access', () => ({ accessibleRepositories }));

import { GET } from './route';

const get = (runId: string) =>
  GET(new Request(`http://localhost/api/cli/grades/${runId}`), {
    params: Promise.resolve({ runId }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  withCliPrincipal.mockImplementation(async (_r, _s, h) => await h());
  accessibleRepositories.mockResolvedValue([{ id: 'r_1' }]);
  loadGradeRun.mockResolvedValue({
    id: 'gr_1',
    repositoryId: 'r_1',
    graderId: AGENT_READINESS,
    state: 'complete',
    sha: 'a'.repeat(40),
    result: {
      score: 20,
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
});

describe('GET /api/cli/grades/[runId] against the real registry', () => {
  it('renders a grade produced by the built-in grader, proving the route registers it via import', async () => {
    const response = await get('gr_1');
    // Without the side-effect import, getGrader() throws unknown_grader and
    // the route's own catch turns that into a 404 saying the grader is "no
    // longer registered" — a sentence that is false about a grader that is
    // registered, and one the CLI classifies as transient and retries.
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.graderId).toBe(AGENT_READINESS);
    expect(body.mode).toBe('deterministic');
    expect(body.titles['root-readme']).toBe('Project documentation');
  });
});
