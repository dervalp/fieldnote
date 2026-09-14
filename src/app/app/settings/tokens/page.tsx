import Link from 'next/link';
import { currentUser } from '../../../../auth/session';
import { listTokens } from '../../../../db/queries/cli-tokens';
import { revokeTokenAction } from './actions';
import {
  accountSettingsPath,
  tokensSettingsPath,
  workspaceSettingsPath,
} from '../../../../lib/app-routes';
export const metadata = { title: 'Command-line tokens' };

// A CLI token does not expire, which is only defensible if revocation is real
// and last use is visible. This page is the other half of that decision.
export default async function TokensPage() {
  const user = await currentUser();
  const tokens = await listTokens(user.id);
  return (
    <>
      <div className="eyebrow">The price of never expiring</div>
      <h1>Command-line tokens</h1>
      <p className="page-intro">
        These tokens do not expire, so revocation has to be real. Revoke any machine you no longer
        use — a revoked token stops working immediately.
      </p>
      <div className="settings-tabs">
        <Link href={accountSettingsPath()}>Account</Link>
        <Link href={workspaceSettingsPath()}>Workspace</Link>
        <Link aria-current="page" href={tokensSettingsPath()}>
          Tokens
        </Link>
      </div>
      <section className="settings-panel">
        <h2>Signed-in machines</h2>
        {tokens.length === 0 ? (
          <p>No machines are signed in. Run `fieldnote login` to add one.</p>
        ) : (
          tokens.map((token) => (
            <div className="settings-row" key={token.id}>
              <div>
                <strong>{token.label}</strong>
                <p className="fine">
                  Added {token.createdAt.toISOString().slice(0, 10)} · Last used{' '}
                  {token.lastUsedAt ? token.lastUsedAt.toISOString().slice(0, 10) : 'never'}
                </p>
              </div>
              {token.revokedAt ? (
                <span className="fine">Revoked</span>
              ) : (
                <form action={revokeTokenAction.bind(null, token.id)}>
                  <button className="fn-button" type="submit">
                    Revoke
                  </button>
                </form>
              )}
            </div>
          ))
        )}
      </section>
    </>
  );
}
