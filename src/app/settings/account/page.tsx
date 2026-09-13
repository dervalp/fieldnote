import Link from 'next/link';
import { Surface } from '@fieldnote/design-system';
import { currentUser } from '../../../auth/session';
import { SettingsForm } from '../../../components/settings-form';
import { saveAccountName } from '../actions';
export const metadata = { title: 'Account settings' };
export default async function AccountSettings() {
  const user = await currentUser();
  return (
    <>
      <div className="eyebrow">Your identity</div>
      <h1>Account settings</h1>
      <p className="page-intro">
        How your teammates see you. Your account and workspace have separate names.
      </p>
      <div className="settings-tabs">
        <Link aria-current="page" href="/settings/account">
          Account
        </Link>
        <Link href="/settings/workspace">Workspace</Link>
      </div>
      <Surface className="settings-panel">
        <h2>Your profile</h2>
        <SettingsForm action={saveAccountName}>
          <label htmlFor="account-name">Your name</label>
          <input
            id="account-name"
            name="name"
            required
            maxLength={80}
            defaultValue={user.displayName ?? user.login}
          />
        </SettingsForm>
        <p className="fine">Connected with GitHub as @{user.login}.</p>
      </Surface>
    </>
  );
}
