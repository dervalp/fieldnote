'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { switchWorkspace } from '../app/app/settings/actions';
import { dashboardPath, workspaceSettingsPath } from '../lib/app-routes';
import { Menu } from './menu';
type Workspace = { id: string; name: string; role: 'owner' | 'member' };
export function WorkspaceSwitcher({
  active,
  workspaces,
  demo = false,
}: {
  active: Workspace;
  workspaces: Workspace[];
  demo?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="workspace-switcher">
      <span className="eyebrow">Workspace</span>
      <Menu
        label="Choose workspace"
        trigger={
          <>
            <span className="ws-icon">{active.name.slice(0, 1).toUpperCase()}</span>
            <span className="workspace-name">{active.name}</span>
          </>
        }
      >
        {workspaces.map((workspace) => (
          <button
            role="menuitemradio"
            aria-checked={workspace.id === active.id}
            disabled={pending || demo}
            type="button"
            key={workspace.id}
            onClick={() =>
              start(async () => {
                const form = new FormData();
                form.set('workspaceId', workspace.id);
                const result = await switchWorkspace(form);
                setError(result.error ?? '');
                if (!result.error) {
                  router.push(dashboardPath());
                  router.refresh();
                }
              })
            }
          >
            <span className="ws-icon">{workspace.name.slice(0, 1).toUpperCase()}</span>
            <span>{workspace.name}</span>
            {workspace.id === active.id && <span className="ws-check">✓</span>}
          </button>
        ))}
        {!demo && (
          <>
            <hr />
            <Link role="menuitem" href={workspaceSettingsPath('#new-workspace')}>
              ＋ New workspace
            </Link>
          </>
        )}
      </Menu>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
