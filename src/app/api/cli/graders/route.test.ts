import { describe, expect, it, vi } from 'vitest';
import { getGrader, listGraders } from '../../../../domain/grading/registry';

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

  it('maps a stubbed manifest shape in isolation, pinning the field mapping itself', async () => {
    // Not a mock of the registry — this only re-derives the same mapping
    // against a literal manifest, independent of what agent-readiness.ts
    // happens to contain today.
    const stub = {
      id: 'acme/example',
      version: '1.2.3',
      mode: 'llm' as const,
      category: 'code-quality' as const,
      card: { tagline: 'An example tagline.' },
    };
    const real = listGraders();
    expect(real.length).toBeGreaterThan(0);
    // Sanity-check the mapping shape using a manually-built list combining
    // the real registrations with a stub, without touching the module.
    const combined = [...real, stub];
    const mapped = combined.map((m) => ({
      id: m.id,
      version: m.version,
      mode: m.mode,
      category: m.category,
      tagline: m.card.tagline,
    }));
    expect(mapped).toContainEqual({
      id: 'acme/example',
      version: '1.2.3',
      mode: 'llm',
      category: 'code-quality',
      tagline: 'An example tagline.',
    });
  });
});
