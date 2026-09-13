'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Brand } from '@fieldnote/design-system';
import { WorkspaceSwitcher } from './workspace-switcher';

type Workspace = { id: string; name: string; role: 'owner' | 'member' };

export function Sidebar(props: { active: Workspace; workspaces: Workspace[]; demo: boolean }) {
  return (
    <Suspense fallback={null}>
      <SidebarNavigation {...props} />
    </Suspense>
  );
}
function SidebarNavigation({
  active,
  workspaces,
  demo,
}: {
  active: Workspace;
  workspaces: Workspace[];
  demo: boolean;
}) {
  const search = useSearchParams();
  const retained = new URLSearchParams();
  // Keep the selected range while moving between overview and repositories.
  for (const key of ['days', 'from', 'to']) {
    const value = search.get(key);
    if (value !== null) retained.set(key, value);
  }
  const query = retained.size ? `?${retained}` : '';
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      {/* `as={Link}` keeps the logo a client-side navigation. The package
          cannot import next/link itself, so the app injects it. */}
      <Brand as={Link} href="/dashboard" size="compact" />
      <WorkspaceSwitcher active={active} workspaces={workspaces} demo={demo} />
      <nav aria-label="Main navigation">
        <Link
          href={`/dashboard${query}`}
          aria-current={pathname === '/dashboard' ? 'page' : undefined}
        >
          <span className="nav-number">01</span> Overview
        </Link>
        <Link
          href={`/repos${query}`}
          aria-current={
            pathname === '/repos' || pathname.startsWith('/repos/') ? 'page' : undefined
          }
        >
          <span className="nav-number">02</span> Repositories
        </Link>
      </nav>
      <div className="sidebar-footer">
        <span className="connection-label">GitHub · PR & CI evidence</span>
        <p>Good work compounds.</p>
      </div>
    </aside>
  );
}
