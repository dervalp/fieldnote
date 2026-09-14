'use server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { db } from '../../../db';
import { users, workspaces } from '../../../db/schema';
import { requireWorkspace, setActiveWorkspace, unlinkRepository } from '../../../workspaces/access';
import { createWorkspace, workspaceName } from '../../../workspaces/store';
import {
  mutationUser,
  lockWorkspace,
  authorizeOwner,
  changeMemberRole,
  removeMember,
} from '../../../workspaces/members';
import { createInvitation, resendInvitation, revokeInvitation } from '../../../workspaces/invitations';
import { EmailDeliveryError } from '../../../email/resend';
type Result = { error?: string };
const value = (form: FormData, key: string) => String(form.get(key) ?? '');
async function save(operation: () => Promise<unknown>): Promise<Result> {
  try {
    await operation();
    revalidatePath('/', 'layout');
    return {};
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof EmailDeliveryError)
      return {
        error:
          'Invitations are unavailable. Configure RESEND_API_KEY and RESEND_FROM_EMAIL on the server, then try again.',
      };
    const messages: Record<string, string> = {
      'Workspace must retain an owner': 'Keep at least one owner in this workspace.',
      'Please wait before resending': 'Please wait a minute before resending this invitation.',
      'Invitation rate limit reached': 'Invitation limit reached. Please try again later.',
      'Invitation unavailable': 'This invitation is unavailable. Refresh and try again.',
      'Invalid email': 'Enter a valid email address.',
      'Workspace unavailable': 'This workspace is unavailable.',
      'Member unavailable': 'This member is no longer available.',
    };
    return {
      error:
        (error instanceof Error && messages[error.message]) ||
        'We could not save this change. Please try again.',
    };
  }
}
export async function saveAccountName(form: FormData): Promise<Result> {
  const user = await mutationUser();
  const name = workspaceName.safeParse(form.get('name'));
  if (!name.success) return { error: 'Enter a name between 1 and 80 characters.' };
  return save(async () => {
    await db()
      .update(users)
      .set({ displayName: name.data, updatedAt: new Date() })
      .where(eq(users.id, user.id));
  });
}
export async function saveWorkspaceName(form: FormData): Promise<Result> {
  const workspace = await requireWorkspace(undefined, 'owner');
  const user = await mutationUser();
  const name = workspaceName.safeParse(form.get('name'));
  if (!name.success) return { error: 'Enter a name between 1 and 80 characters.' };
  return save(() =>
    db().transaction(async (tx) => {
      await lockWorkspace(tx, workspace.id);
      await authorizeOwner(tx, workspace.id, user.id);
      await tx.update(workspaces).set({ name: name.data }).where(eq(workspaces.id, workspace.id));
    }),
  );
}
export async function createNamedWorkspace(form: FormData): Promise<Result> {
  const user = await mutationUser();
  const name = workspaceName.safeParse(form.get('name'));
  if (!name.success) return { error: 'Enter a name between 1 and 80 characters.' };
  return save(async () => {
    const workspace = await createWorkspace(user.id, name.data);
    await setActiveWorkspace(workspace.id);
  });
}
export async function switchWorkspace(form: FormData): Promise<Result> {
  await mutationUser();
  await requireWorkspace(value(form, 'workspaceId'));
  return save(() => setActiveWorkspace(value(form, 'workspaceId')));
}
export async function inviteMember(form: FormData): Promise<Result> {
  const workspace = await requireWorkspace(undefined, 'owner');
  const email = z.email().max(254).safeParse(value(form, 'email').trim());
  if (!email.success) return { error: 'Enter a valid email address.' };
  return save(() => createInvitation(workspace.id, email.data));
}
export async function resendInvite(form: FormData): Promise<Result> {
  await requireWorkspace(undefined, 'owner');
  return save(() => resendInvitation(value(form, 'invitationId')));
}
export async function revokeInvite(form: FormData): Promise<Result> {
  await requireWorkspace(undefined, 'owner');
  return save(() => revokeInvitation(value(form, 'invitationId')));
}
export async function updateMember(form: FormData): Promise<Result> {
  const workspace = await requireWorkspace(undefined, 'owner');
  const role = value(form, 'role');
  if (role !== 'owner' && role !== 'member') return { error: 'Choose Owner or Member.' };
  return save(() => changeMemberRole(workspace.id, value(form, 'userId'), role));
}
export async function deleteMember(form: FormData): Promise<Result> {
  const workspace = await requireWorkspace(undefined, 'owner');
  return save(() => removeMember(workspace.id, value(form, 'userId')));
}
export async function disconnectRepository(form: FormData): Promise<Result> {
  const workspace = await requireWorkspace(undefined, 'owner');
  return save(() => unlinkRepository(workspace.id, value(form, 'repositoryId')));
}
