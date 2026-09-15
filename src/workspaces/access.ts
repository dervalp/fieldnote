import { and, asc, eq, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { currentUser } from '../auth/session';
import { db } from '../db';
import {
  installations,
  repositories,
  workspaceMemberships,
  workspaceRepositories,
  workspaces,
} from '../db/schema';
import { env } from '../lib/env';
import { cookieOptions } from '../auth/session';
import { DEMO_WORKSPACE_ID } from '../demo/workspace';
import { ensureDefaultWorkspace, type Role, type Workspace } from './store';

const workspaceCookie = 'fieldnote-workspace';
const demoWorkspace = {
  id: DEMO_WORKSPACE_ID,
  name: 'Demo workspace',
  handle: null,
  role: 'member' as const,
};

export async function requireWorkspace(
  workspaceId?: string,
  role?: Role,
): Promise<Workspace & { role: Role }> {
  if (env().DEMO_MODE === 'true') {
    if ((workspaceId !== undefined && workspaceId !== demoWorkspace.id) || role === 'owner')
      notFound();
    return demoWorkspace;
  }
  const user = await currentUser();
  await ensureDefaultWorkspace(user.id);
  const explicit = workspaceId !== undefined;
  const preferred = explicit ? workspaceId : (await cookies()).get(workspaceCookie)?.value;
  const memberships = await db()
    .select({
      id: workspaces.id,
      name: workspaces.name,
      handle: workspaces.handle,
      role: workspaceMemberships.role,
      defaultForUserId: workspaces.defaultForUserId,
    })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
    .where(eq(workspaceMemberships.userId, user.id))
    .orderBy(asc(workspaces.createdAt), asc(workspaces.id));
  const fallback =
    memberships.find(({ defaultForUserId }) => defaultForUserId === user.id) ?? memberships[0];
  const membership = explicit
    ? memberships.find(({ id }) => id === workspaceId)
    : preferred
      ? memberships.find(({ id }) => id === preferred)
      : fallback;
  if (!membership && explicit) notFound();
  const selected = membership ?? fallback;
  if (!selected || (role === 'owner' && selected.role !== 'owner')) notFound();
  return { id: selected.id, name: selected.name, handle: selected.handle, role: selected.role };
}

export async function setActiveWorkspace(workspaceId: string): Promise<void> {
  if (env().DEMO_MODE === 'true') notFound();
  await requireWorkspace(workspaceId);
  (await cookies()).set(workspaceCookie, workspaceId, cookieOptions);
}

export async function accessibleRepositories(workspaceId?: string) {
  const workspace = await requireWorkspace(workspaceId);
  if (workspace.id === demoWorkspace.id)
    return (
      await db()
        .select()
        .from(repositories)
        .where(and(eq(repositories.isDemo, true), eq(repositories.active, true)))
    ).map((repository) => ({ ...repository, canAdmin: false }));
  return (
    await db()
      .select({ repository: repositories })
      .from(workspaceRepositories)
      .innerJoin(repositories, eq(repositories.id, workspaceRepositories.repositoryId))
      .innerJoin(installations, eq(installations.id, repositories.installationId))
      .where(
        and(
          eq(workspaceRepositories.workspaceId, workspace.id),
          eq(repositories.active, true),
          eq(installations.active, true),
        ),
      )
  ).map(({ repository }) => ({ ...repository, canAdmin: workspace.role === 'owner' }));
}

export async function linkRepository(workspaceId: string, repositoryId: string): Promise<void> {
  const [workspace, user] = await Promise.all([
    requireWorkspace(workspaceId, 'owner'),
    currentUser(),
  ]);
  const { githubAccessibleRepositories } = await import('../auth/access');
  const repository = (await githubAccessibleRepositories(true)).find(
    (candidate) => candidate.id === repositoryId && candidate.canAdmin,
  );
  if (!repository) notFound();
  await db().transaction(async (tx) => {
    await tx.execute(sql`select id from workspaces where id = ${workspace.id} for update`);
    const [membership] = await tx
      .select({ role: workspaceMemberships.role })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspace.id),
          eq(workspaceMemberships.userId, user.id),
        ),
      );
    if (membership?.role !== 'owner') notFound();
    await tx
      .insert(workspaceRepositories)
      .values({ workspaceId: workspace.id, repositoryId, connectedBy: user.id })
      .onConflictDoNothing();
  });
}

export async function unlinkRepository(workspaceId: string, repositoryId: string): Promise<void> {
  const [workspace, user] = await Promise.all([
    requireWorkspace(workspaceId, 'owner'),
    currentUser(),
  ]);
  await db().transaction(async (tx) => {
    await tx.execute(sql`select id from workspaces where id = ${workspace.id} for update`);
    const [membership] = await tx
      .select({ role: workspaceMemberships.role })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspace.id),
          eq(workspaceMemberships.userId, user.id),
        ),
      );
    if (membership?.role !== 'owner') notFound();
    await tx
      .delete(workspaceRepositories)
      .where(
        and(
          eq(workspaceRepositories.workspaceId, workspace.id),
          eq(workspaceRepositories.repositoryId, repositoryId),
        ),
      );
  });
}

export async function requireRepository(id: string, admin = false) {
  const repo = (await accessibleRepositories()).find((candidate) => candidate.id === id);
  if (!repo) notFound();
  if (admin) {
    await requireWorkspace(undefined, 'owner');
    const { githubAccessibleRepositories } = await import('../auth/access');
    const grant = (await githubAccessibleRepositories(true)).find(
      (candidate) => candidate.id === id && candidate.canAdmin,
    );
    if (!grant) notFound();
    return { ...repo, canAdmin: true };
  }
  return repo;
}

export async function requireTrackedRepository(id: string, admin = false) {
  const repo = await requireRepository(id, admin);
  if (!repo.trackingStartedAt && !(process.env.NODE_ENV === 'development' && repo.isDemo && !admin))
    notFound();
  return repo;
}
