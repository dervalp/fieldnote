import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { workspaceMemberships, workspaces } from '../db/schema';
import { installBuiltIns } from '../db/queries/graders';

export type Role = 'owner' | 'member';
export type Workspace = { id: string; name: string };

export const workspaceName = z.string().trim().min(1).max(80);

export async function ensureDefaultWorkspace(userId: string): Promise<Workspace> {
  // installBuiltIns() runs its own query against db(), not tx: a pooled
  // connection separate from this transaction's. Calling it before the
  // transaction below commits would ask that second connection to verify a
  // foreign key against a workspace row the first connection has inserted but
  // not yet committed — a lock wait the first connection can never resolve,
  // because it is itself waiting on this call. So it runs after, once the
  // workspace is visible to any connection.
  //
  // It runs only when this call is the one that created the workspace, never
  // on the early-return path: this function is called on every authenticated
  // request, and re-running it there would resurrect an install a user (or
  // Task 10's uninstall) had deleted, on every single page load.
  const { workspace, created } = await db().transaction(async (tx) => {
    await tx.execute(sql`select id from users where id = ${userId} for update`);

    const [existing] = await tx
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.defaultForUserId, userId))
      .limit(1);
    if (existing) return { workspace: existing, created: false };

    const workspace = {
      id: randomUUID(),
      name: 'Personal workspace',
    };
    await tx.insert(workspaces).values({ ...workspace, defaultForUserId: userId });
    await tx.insert(workspaceMemberships).values({
      workspaceId: workspace.id,
      userId,
      role: 'owner',
    });
    return { workspace, created: true };
  });
  if (created) await installBuiltIns(workspace.id);
  return workspace;
}

export async function createWorkspace(userId: string, name: string): Promise<Workspace> {
  const workspace = { id: randomUUID(), name: workspaceName.parse(name) };
  await db().transaction(async (tx) => {
    await tx.execute(sql`select id from users where id = ${userId} for update`);
    await tx.insert(workspaces).values(workspace);
    await tx.insert(workspaceMemberships).values({
      workspaceId: workspace.id,
      userId,
      role: 'owner',
    });
  });
  // See ensureDefaultWorkspace: installBuiltIns() must run after this
  // transaction commits, not inside it.
  await installBuiltIns(workspace.id);
  return workspace;
}

export async function listWorkspaces(userId: string): Promise<Array<Workspace & { role: Role }>> {
  return db()
    .select({ id: workspaces.id, name: workspaces.name, role: workspaceMemberships.role })
    .from(workspaceMemberships)
    .innerJoin(workspaces, and(eq(workspaceMemberships.workspaceId, workspaces.id)))
    .where(eq(workspaceMemberships.userId, userId))
    .orderBy(asc(workspaces.createdAt), asc(workspaces.id));
}
