import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Surface } from '@fieldnote/design-system';
import { currentUser, currentUserId } from '../../../auth/session';
import { requireWorkspace } from '../../../workspaces/access';
import { env } from '../../../lib/env';
import { approveCliAuth } from './actions';
import { isLoopbackRedirect } from './redirect-target';

// The approval screen names the workspace and the scope before anything is
// granted. A token that can act on a team's engineering record should never be
// issued silently.
export default async function CliAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ challenge?: string; redirect?: string; state?: string; code?: string }>;
}) {
  const params = await searchParams;

  // The demo workspace is not a row in `workspaces`: minting a token pinned to
  // it would fail on the foreign key rather than being refused on purpose.
  // Checked only once a dynamic API (searchParams) has already been read, so a
  // static prerender pass bails out to request time before this ever runs —
  // env() needs configuration (DATABASE_URL and friends) that a build has no
  // reason to have.
  if (env().DEMO_MODE === 'true') notFound();

  // currentUser() redirects a signed-out visitor to /signed-out with no way
  // back to this link — the challenge, redirect and state would be lost, and
  // the CLI would wait out its full timeout. currentUserId() tolerates a
  // signed-out visitor instead, so that case can be handled here, in place.
  const userId = await currentUserId();
  if (userId === null) {
    return (
      <Surface>
        <h1>Sign in fieldnote CLI</h1>
        <p>You need to sign in to your fieldnote account before approving this device.</p>
        <p>
          <Link href="/signed-out">Sign in</Link>, then reopen this link from your terminal — run{' '}
          <code>fieldnote login</code> again if it has already timed out.
        </p>
      </Surface>
    );
  }

  const user = await currentUser();
  const workspace = await requireWorkspace();

  if (
    !params.challenge ||
    !params.redirect ||
    !params.state ||
    !isLoopbackRedirect(params.redirect)
  )
    return <Surface>This sign-in link is not valid. Run `fieldnote login` again.</Surface>;

  async function approve() {
    'use server';
    // Checked again here, not only at render: the mint must never depend on a
    // guard that ran in a different request.
    if (!isLoopbackRedirect(params.redirect!)) return;
    const { code } = await approveCliAuth({
      challenge: params.challenge!,
      workspaceId: workspace.id,
    });
    const target = new URL(params.redirect!);
    target.searchParams.set('code', code);
    target.searchParams.set('state', params.state!);
    redirect(target.toString());
  }

  return (
    <Surface>
      <h1>Sign in fieldnote CLI</h1>
      <p>
        Signed in as <strong>{user.login}</strong>.
      </p>
      <dl>
        <dt>Workspace</dt>
        <dd>{workspace.name}</dd>
        <dt>This machine will be able to</dt>
        <dd>Grade repositories in this workspace, and read their grades.</dd>
        <dt>It will never be able to</dt>
        <dd>Change your account, your billing, or any other workspace.</dd>
        <dt>Device code</dt>
        <dd>{params.code ?? '—'}</dd>
      </dl>
      <p>Confirm the device code matches the one in your terminal.</p>
      <form action={approve}>
        <button className="fn-button" type="submit">
          Approve this machine
        </button>
      </form>
    </Surface>
  );
}
