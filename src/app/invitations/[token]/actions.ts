'use server';
import { redirect, unstable_rethrow } from 'next/navigation';
import { currentUser, userClient } from '../../../auth/session';
import { readInvitation } from '../../../auth/invitation-continuation';
import { acceptInvitation } from '../../../workspaces/invitations';
import { setActiveWorkspace } from '../../../workspaces/access';
import { dashboardPath } from '../../../lib/app-routes';
export async function acceptInvitationAction(sealed: string): Promise<void> {
  await currentUser();
  const token = readInvitation(sealed);
  if (!token) redirect('/signed-out?invitation=expired');
  let emails: string[];
  try {
    const client = await userClient();
    const all = await client.paginate(client.rest.users.listEmailsForAuthenticatedUser, {
      per_page: 100,
    });
    emails = all.filter((email) => email.verified === true).map((email) => email.email);
  } catch (error) {
    unstable_rethrow(error);
    redirect(`/invitations/${token}?error=reauthorize`);
  }
  let workspaceId: string;
  try {
    ({ workspaceId } = await acceptInvitation(token, emails));
  } catch (error) {
    unstable_rethrow(error);
    redirect(`/invitations/${token}?error=unavailable`);
  }
  await setActiveWorkspace(workspaceId);
  redirect(dashboardPath());
}
