import { withCliPrincipal } from '../../principal';
import { loadGradeRun } from '../../../../../db/queries/grade-runs';
import { accessibleRepositories } from '../../../../../workspaces/access';
import { graderCheckTitles, getGrader } from '../../../../../domain/grading/registry';
import { ManifestError } from '../../../../../domain/grading/manifest';
import { gradePresentation } from '../../../../../domain/grading/presentation';
import { finishNames } from '../../../../../domain/grading/finish-names';
import { nextTier } from '../../../../../domain/grading/next-tier';

const headers = { 'Cache-Control': 'private, no-store' };
const notFound = (error = 'Grade unavailable.') =>
  Response.json({ error }, { status: 404, headers });

// Sends the full display string ('Silver · Holographic'), not the finish key
// gradePresentation returns — the CLI has no access to finishNames itself.
function presentationOf(score: number): { label: string; finish: string } {
  const presentation = gradePresentation(score);
  return { label: presentation.label, finish: finishNames[presentation.finish] };
}

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  return withCliPrincipal(request, 'grade', async () => {
    const { runId } = await context.params;
    const run = await loadGradeRun(runId);
    if (!run) return notFound();

    // Re-checked on every poll, not only at request time: access can be
    // revoked while a run is in flight, and a poll loop is the easiest place
    // for that to go unnoticed.
    const repositories = await accessibleRepositories();
    if (!repositories.some((repository) => repository.id === run.repositoryId)) return notFound();

    if (run.state !== 'complete' || !run.result)
      return Response.json({ state: run.state }, { headers });

    // A stored grade whose grader is no longer registered cannot be rendered
    // honestly: no grader check titles, and no `mode`, which means no way to
    // honour the grader's own disclosure obligation for a non-deterministic
    // grade.
    let manifest;
    try {
      manifest = getGrader(run.graderId);
    } catch (error) {
      if (error instanceof ManifestError && error.code === 'unknown_grader')
        return notFound(
          `This grade was produced by '${run.graderId}', which is no longer registered.`,
        );
      throw error;
    }

    const titles = graderCheckTitles(run.graderId);
    const { score, checks, rubricVersion, evaluatorVersion, incompleteReason } = run.result;

    // A null score means evidence collection was incomplete, not that the
    // repository scored zero — gradePresentation throws on a non-integer or
    // out-of-range score, so a null score never reaches it.
    const presentation = score === null ? null : presentationOf(score);
    const tier = score === null ? null : nextTier(score, checks, titles);

    // Built from the request's own origin rather than env(), which parses the
    // whole GitHub integration block whenever DEMO_MODE isn't 'true' and
    // throws when GITHUB_* config is empty — true of this worktree and any
    // fresh checkout. The CLI authenticated against this origin, so that is
    // where its link should point.
    const url = new URL(`/repos/${run.repositoryId}/grading`, request.url).toString();

    return Response.json(
      {
        state: run.state,
        score,
        incompleteReason,
        checks,
        titles,
        graderId: run.graderId,
        graderVersion: manifest.version,
        rubricVersion,
        evaluatorVersion,
        mode: manifest.mode,
        tagline: manifest.card.tagline,
        disclaimer: manifest.disclaimer,
        gradedSha: run.sha,
        presentation,
        nextTier: tier,
        url,
      },
      { headers },
    );
  });
}
