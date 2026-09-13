import { unstable_rethrow } from 'next/navigation';
import { hasCurrentSession } from '../../../../../../auth/session';
import { requireRepository } from '../../../../../../workspaces/access';
import { loadGradeRun } from '../../../../../../db/queries/grade-runs';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(
  _request: Request,
  context: { params: Promise<{ repoId: string; runId: string }> },
) {
  try {
    if (!(await hasCurrentSession()))
      return Response.json({ error: 'Sign in again.' }, { status: 401, headers });
    const { repoId, runId } = await context.params;
    await requireRepository(repoId);
    const run = await loadGradeRun(runId);
    if (!run || run.repositoryId !== repoId)
      return Response.json({ error: 'Grade unavailable.' }, { status: 404, headers });
    return Response.json(
      { id: run.id, state: run.state, errorCode: run.errorCode },
      { headers },
    );
  } catch (error) {
    unstable_rethrow(error);
    return Response.json(
      { error: 'Grade status is temporarily unavailable. Try again.' },
      { status: 503, headers },
    );
  }
}
