import { beforeEach, describe, expect, it, vi } from 'vitest';
import { builtInManifests } from '../../../../domain/grading/registry';
import { agentReadinessManifest } from '../../../../domain/grading/graders/agent-readiness';

const { withCliPrincipal, requireWorkspace, installedGraders } = vi.hoisted(() => ({
  withCliPrincipal: vi.fn(async (_r: Request, _s: string, h: () => Promise<Response>) => await h()),
  requireWorkspace: vi.fn(),
  installedGraders: vi.fn(),
}));
vi.mock('../principal', () => ({ withCliPrincipal }));
vi.mock('../../../../workspaces/access', () => ({ requireWorkspace }));
vi.mock('../../../../db/queries/graders', () => ({ installedGraders }));

import { GET } from './route';

const get = () =>
  GET(
    new Request('http://localhost/api/cli/graders', { headers: { authorization: 'Bearer fn_x' } }),
  );

// The real manifests, not invented ones: this route's job is to map manifest
// fields onto the shape the CLI prints, and a hand-written fixture would let
// a renamed manifest field pass here and break `fieldnote graders`.
const installed = builtInManifests().map((manifest) => ({
  manifest,
  version: manifest.version,
  consentedNeeds: '',
  verifiedAt: new Date(),
  withdrawnAt: null,
  latestVersion: manifest.version,
}));

beforeEach(() => {
  vi.clearAllMocks();
  withCliPrincipal.mockImplementation(async (_r, _s, h) => await h());
  requireWorkspace.mockResolvedValue({ id: 'w_1', name: 'Acme', role: 'owner' });
  installedGraders.mockResolvedValue(installed);
});

describe('GET /api/cli/graders', () => {
  it("lists what the caller's own workspace installed, not every grader fieldnote knows", async () => {
    const body = await (await get()).json();
    expect(installedGraders).toHaveBeenCalledWith('w_1');
    expect(body.graders.map((g: { id: string }) => g.id)).toEqual(
      builtInManifests().map((manifest) => manifest.id),
    );
  });

  it('maps the manifest fields the CLI prints, tagline included', async () => {
    const body = await (await get()).json();
    const grader = body.graders.find((g: { id: string }) => g.id === agentReadinessManifest.id);
    expect(grader).toEqual({
      id: agentReadinessManifest.id,
      version: agentReadinessManifest.version,
      mode: agentReadinessManifest.mode,
      category: agentReadinessManifest.category,
      tagline: agentReadinessManifest.card.tagline,
    });
  });

  it('answers an empty list for a workspace with nothing installed', async () => {
    installedGraders.mockResolvedValue([]);
    expect(await (await get()).json()).toEqual({ graders: [] });
  });
});
