'use client';
import Link from 'next/link';
import { accountSettingsPath, workspaceSettingsPath } from '../lib/app-routes';
import { Menu } from './menu';
export function AccountMenu({
  name,
  workspace,
  role,
  demo = false,
}: {
  name: string;
  workspace: string;
  role: 'owner' | 'member';
  demo?: boolean;
}) {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <Menu
      className="account-menu"
      label="Open account menu"
      trigger={<span className="account-avatar">{initials}</span>}
    >
      <strong>{name}</strong>
      <p>
        {workspace} ·{' '}
        <span className={role === 'owner' ? 'owner-badge' : 'member-badge'}>
          {role === 'owner' ? 'Owner' : 'Member'}
        </span>
      </p>
      {!demo && (
        <Link role="menuitem" href={accountSettingsPath()}>
          Account settings
        </Link>
      )}
      <Link role="menuitem" href={workspaceSettingsPath()}>
        Workspace settings
      </Link>
      <hr />
      <form action="/api/auth/logout" method="post">
        <button role="menuitem">Sign out</button>
      </form>
    </Menu>
  );
}
