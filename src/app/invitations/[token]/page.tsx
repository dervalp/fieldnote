import type { Metadata } from 'next';
import { Button } from '@fieldnote/design-system';
import { hasCurrentSession } from '../../../auth/session';
import { sealInvitation } from '../../../auth/invitation-continuation';
import { acceptInvitationAction } from './actions';
export const metadata: Metadata = {
  title: 'Workspace invitation',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};
export default async function InvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  if (!/^[\w-]{43}$/.test(token))
    return (
      <>
        <h1>Invitation unavailable</h1>
        <p>Ask the workspace owner for a new invitation.</p>
      </>
    );
  const signedIn = await hasCurrentSession();
  const { error } = await searchParams;
  return (
    <>
      <h1>Workspace invitation</h1>
      <p>
        Joining gives you access to analytics and grading evidence for every connected repository,
        including private repositories.
      </p>
      {error === 'reauthorize' && (
        <p role="alert">
          GitHub email verification is unavailable. Reauthorize Fieldnote with Email addresses read
          permission, then try again.
        </p>
      )}
      {error === 'unavailable' && (
        <p role="alert">
          This invitation is unavailable or does not match a verified email on your GitHub account.
          Ask the owner for a new invitation.
        </p>
      )}
      {signedIn && (
        <form action={acceptInvitationAction.bind(null, sealInvitation(token))}>
          <Button type="submit">Accept invitation</Button>
        </form>
      )}
      <a
        href={`/api/auth/login?invitation=${encodeURIComponent(sealInvitation(token))}`}
        rel="noreferrer"
      >
        {signedIn ? 'Reauthorize with GitHub' : 'Sign in with GitHub to continue'}
      </a>
    </>
  );
}
