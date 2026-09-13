import { TopBar, Breadcrumb, type Crumb } from '@fieldnote/design-system';
import { currentUser } from '../auth/session';
import { requireWorkspace } from '../workspaces/access';
import { listWorkspaces } from '../workspaces/store';
import { env } from '../lib/env';
import { Sidebar } from './sidebar';
import { AccountMenu } from './account-menu';

export async function AppShell({
  children,
  crumbs = [],
}: {
  children: React.ReactNode;
  crumbs?: Crumb[];
}) {
  const active = await requireWorkspace();
  const demo = env().DEMO_MODE === 'true';
  const user = demo ? { displayName: 'Demo visitor', login: 'demo' } : await currentUser();
  const choices = demo ? [active] : await listWorkspaces((await currentUser()).id);
  // The workspace is always the root of the trail; the section layout supplies
  // the rest, because it is the only thing that knows the repository's name.
  const trail: Crumb[] = [{ label: active.name, href: '/dashboard' }, ...crumbs];
  return (
    <div className="app-shell">
      <Sidebar active={active} workspaces={choices} demo={demo} />
      <main id="main-content" tabIndex={-1}>
        <TopBar>
          <TopBar.Context>
            <Breadcrumb trail={trail} />
          </TopBar.Context>
          <TopBar.Utility />
          <TopBar.Identity>
            <AccountMenu
              name={user.displayName ?? user.login}
              workspace={active.name}
              role={active.role}
              demo={demo}
            />
          </TopBar.Identity>
        </TopBar>
        <div className="page-body">{children}</div>
      </main>
    </div>
  );
}
