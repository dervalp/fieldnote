import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

// The sibling route.test.ts mocks the grader lookup, which is exactly why a
// route that resolved the wrong grader would be invisible there: a mocked
// graderVersion answers for whatever the test hands it. This file mocks
// everything *except* the registry — which, since slice 6, is Postgres — so
// it fails the moment the route stops resolving a stored grade against the
// (grader_id, version) rows the built-ins are seeded into.
//
// Deliberately a literal rather than the AGENT_READINESS constant: this test
// is about what the route finds in the database, and spelling the id out
// keeps the assertion independent of the module the route happens to import.
const AGENT_READINESS = 'fieldnote/agent-readiness';

const { withCliPrincipal, loadGradeRun, accessibleRepositories } = vi.hoisted(() => ({
  withCliPrincipal: vi.fn(async (_r: Request, _s: string, h: () => Promise<Response>) => await h()),
  loadGradeRun: vi.fn(),
  accessibleRepositories: vi.fn(),
}));
vi.mock('../../principal', () => ({ withCliPrincipal }));
vi.mock('../../../../../db/queries/grade-runs', () => ({ loadGradeRun }));
vi.mock('../../../../../workspaces/access', () => ({ accessibleRepositories }));

import { closeDb, db } from '../../../../../db';
import { seedBuiltInGraders } from '../../../../../db/queries/graders';
import { agentReadinessManifest } from '../../../../../domain/grading/graders/agent-readiness';
import { GET } from './route';

const get = (runId: string) =>
  GET(new Request(`http://localhost/api/cli/grades/${runId}`), {
    params: Promise.resolve({ runId }),
  });

beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
  // Never torn down: the built-ins are owned by nobody and shared with every
  // other suite, exactly as seedBuiltInGraders() leaves them after a migration.
  await seedBuiltInGraders();
});

afterAll(async () => {
  await closeDb();
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
    rubricVersion: agentReadinessManifest.version,
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
      rubricVersion: agentReadinessManifest.version,
      evaluatorVersion: agentReadinessManifest.evaluatorVersion,
    },
  });
});

describe('GET /api/cli/grades/[runId] against the real registry', () => {
  it('renders a grade produced by the built-in grader, resolving its version from the registry', async () => {
    const response = await get('gr_1');
    // Resolved against nothing but the seeded rows. If the route ever stops
    // finding them, graderVersion() answers null and the route's own guard
    // turns that into a 404 saying the version is "no longer published" — a
    // sentence that is false about a seeded built-in, and one the CLI
    // classifies as transient and retries.
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.graderId).toBe(AGENT_READINESS);
    expect(body.mode).toBe('deterministic');
    expect(body.titles['root-readme']).toBe('Project documentation');
  });

  it('404s a grade pinned to a version nothing ever published', async () => {
    loadGradeRun.mockResolvedValue({
      id: 'gr_2',
      repositoryId: 'r_1',
      graderId: AGENT_READINESS,
      state: 'complete',
      sha: 'b'.repeat(40),
      rubricVersion: '99.0.0',
      result: {
        score: 20,
        checks: [],
        rubricVersion: '99.0.0',
        evaluatorVersion: 'eval-99',
      },
    });
    const response = await get('gr_2');
    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatch(/no longer published/);
  });
});
