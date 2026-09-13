'use server';
import { currentUser } from '../../../auth/session';
import { requireWorkspace } from '../../../workspaces/access';
import { createAuthCode } from '../../../db/queries/cli-tokens';

export async function approveCliAuth(input: {
  challenge: string;
  workspaceId: string;
}): Promise<{ code: string }> {
  const user = await currentUser();
  // Re-resolved here rather than trusted from the render: if the workspace
  // cookie changed between render and click, this must pin to the workspace
  // the caller actually has access to, not the one the page rendered. The
  // explicit id makes requireWorkspace() notFound() on a non-membership
  // rather than silently falling back to some other workspace.
  const workspace = await requireWorkspace(input.workspaceId);
  const code = await createAuthCode({
    userId: user.id,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    login: user.login,
    challenge: input.challenge,
  });
  return { code };
}
