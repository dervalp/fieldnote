import { withCliPrincipal } from '../principal';
import { requireWorkspace } from '../../../../workspaces/access';
import { installedGraders } from '../../../../db/queries/graders';

const headers = { 'Cache-Control': 'private, no-store' };

// What this workspace can actually run, not what fieldnote knows how to run.
// A grader is a row from slice 6 on, and a workspace runs the version it
// installed — so this reads grader_installs, the same query the Grading tab
// renders its cards from. `fieldnote graders` therefore lists exactly what
// `fieldnote run --grader` will accept, and a grader nobody installed is
// absent rather than offered and then refused.
export async function GET(request: Request) {
  return withCliPrincipal(request, 'grade', async () => {
    const workspace = await requireWorkspace();
    const installed = await installedGraders(workspace.id);
    return Response.json(
      {
        graders: installed.map(({ manifest }) => ({
          id: manifest.id,
          version: manifest.version,
          mode: manifest.mode,
          category: manifest.category,
          tagline: manifest.card.tagline,
        })),
      },
      { headers },
    );
  });
}
