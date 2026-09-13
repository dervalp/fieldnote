'use server';
import { currentUser } from '../../../auth/session';
import { requireWorkspace } from '../../../workspaces/access';
import { createAuthCode } from '../../../db/queries/cli-tokens';

export async function approveCliAuth(input: { challenge: string }): Promise<{ code: string }> {
  const user = await currentUser();
  const workspace = await requireWorkspace();
  const code = await createAuthCode({
    userId: user.id,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    login: user.login,
    challenge: input.challenge,
  });
  return { code };
}
