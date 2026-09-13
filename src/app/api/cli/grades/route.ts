import { z } from 'zod';
import { withCliPrincipal } from '../principal';
import { accessibleRepositories } from '../../../../workspaces/access';
import {
  requestGrade,
  DEMO_READ_ONLY,
  REPOSITORY_UNAVAILABLE,
} from '../../../../db/queries/grade-runs';
import { dispatchGrade } from '../../../../inngest/dispatch-grade';
import { getGrader } from '../../../../domain/grading/registry';
import { ManifestError } from '../../../../domain/grading/manifest';
import { AGENT_READINESS } from '../../../../domain/grading/graders/agent-readiness';

const headers = { 'Cache-Control': 'private, no-store' };

const bodySchema = z.object({
  repository: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  grader: z.string().optional(),
});

export async function POST(request: Request) {
  return withCliPrincipal(request, 'grade', async () => {
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success)
      return Response.json(
        { error: 'Send a repository as owner/name, and a full 40-character sha.' },
        { status: 400, headers },
      );

    // GitHub slugs are case-insensitive, and a git remote may spell a slug
    // differently than the database's stored owner/name.
    const [owner, name] = body.data.repository.split('/').map((part) => part.toLowerCase());
    // Resolved against what this workspace can see, so an unknown repository
    // and an unauthorised one are the same answer.
    const repositories = await accessibleRepositories();
    const repository = repositories.find(
      (r) => r.owner.toLowerCase() === owner && r.name.toLowerCase() === name,
    );
    if (!repository)
      return Response.json(
        { error: `fieldnote is not connected to ${body.data.repository}.` },
        { status: 404, headers },
      );

    const graderId = body.data.grader ?? AGENT_READINESS;
    let manifest;
    try {
      manifest = getGrader(graderId);
    } catch (error) {
      if (error instanceof ManifestError && error.code === 'unknown_grader')
        return Response.json(
          { error: `fieldnote has no grader named '${graderId}'. Check the --grader flag.` },
          { status: 404, headers },
        );
      throw error;
    }

    // requestGrade checks workspace membership, repository connection and demo
    // mode, and holds the one-live-run-per-repository-and-grader constraint.
    // It throws plain Errors for two conditions a developer can act on; the
    // two messages are imported constants from grade-runs.ts (not literals),
    // so a reword there fails typecheck here instead of silently falling
    // through to a 503.
    let run;
    try {
      run = await requestGrade(repository.id, graderId);
    } catch (error) {
      if (error instanceof Error && error.message === DEMO_READ_ONLY)
        return Response.json(
          { error: 'The demo workspace is read-only. Sign in to a connected workspace to grade.' },
          { status: 403, headers },
        );
      if (error instanceof Error && error.message === REPOSITORY_UNAVAILABLE)
        return Response.json(
          { error: `fieldnote is not connected to ${body.data.repository}.` },
          { status: 404, headers },
        );
      throw error;
    }

    try {
      await dispatchGrade(run.id);
    } catch (error) {
      // A queued run is recovered by reconciliation, so this is not fatal —
      // but an operator debugging a dark Inngest needs evidence it happened.
      // run.id is not sensitive; never a token.
      console.error('POST /api/cli/grades: dispatch failed', run.id, error);
    }

    // requestGrade never accepts or stores a sha — grade_runs.sha is pinned
    // later by the collection worker, from the repository's default branch
    // head. Echoing the caller's sha back as `sha` would let a developer
    // standing on a feature branch believe their own commit was graded when
    // the server actually graded the default branch. `requestedSha` names it
    // for what it is: the CLI's own claim about where it stands, not what got
    // graded. The poll endpoint returns the sha actually graded.
    return Response.json(
      { runId: run.id, graderId, mode: manifest.mode, requestedSha: body.data.sha },
      { headers },
    );
  });
}
