import { describe, expect, it, vi } from 'vitest';
import { getGrader } from '../../../../domain/grading/registry';

// Deliberately not imported from agent-readiness.ts: that module registers
// the built-in as a side effect of being imported, and this test exists to
// prove the *route* does that importing, not this test file. Importing the
// AGENT_READINESS constant here would register the grader regardless of
// whether route.ts ever imports it, hiding the exact bug this test is for.
const AGENT_READINESS = 'fieldnote/agent-readiness';

const { withCliPrincipal } = vi.hoisted(() => ({
  withCliPrincipal: vi.fn(async (_r: Request, _s: string, h: () => Promise<Response>) => await h()),
}));
vi.mock('../principal', () => ({ withCliPrincipal }));

import { GET } from './route';

const get = () =>
  GET(
    new Request('http://localhost/api/cli/graders', { headers: { authorization: 'Bearer fn_x' } }),
  );

describe('GET /api/cli/graders', () => {
  it('lists the real built-in grader by id, proving the route registers it via import', async () => {
    const body = await (await get()).json();
    const ids = body.graders.map((g: { id: string }) => g.id);
    expect(ids).toContain(AGENT_READINESS);
  });

  it('maps the manifest fields the CLI prints, tagline included, from the real registry', async () => {
    const manifest = getGrader(AGENT_READINESS);
    const body = await (await get()).json();
    const grader = body.graders.find((g: { id: string }) => g.id === AGENT_READINESS);
    expect(grader).toEqual({
      id: manifest.id,
      version: manifest.version,
      mode: manifest.mode,
      category: manifest.category,
      tagline: manifest.card.tagline,
    });
  });
});
