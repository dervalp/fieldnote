import { withCliPrincipal } from '../principal';
import { listGraders } from '../../../../domain/grading/registry';
// Registers fieldnote's own built-in grader as a module-scope side effect.
// Nothing else boots this registration — there is no barrel file and no
// startup hook — so without this import listGraders() returns an empty
// list in production: a valid-looking 200 with no graders in it, and no
// error anywhere to say why.
import '../../../../domain/grading/graders/agent-readiness';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  return withCliPrincipal(request, 'grade', async () =>
    Response.json(
      {
        graders: listGraders().map((manifest) => ({
          id: manifest.id,
          version: manifest.version,
          mode: manifest.mode,
          category: manifest.category,
          tagline: manifest.card.tagline,
        })),
      },
      { headers },
    ),
  );
}
