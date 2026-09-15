vi.mock('server-only', () => ({}));

import { beforeEach, expect, test, vi } from 'vitest';
vi.mock('../../../workspaces/access', () => ({
  requireWorkspace: vi.fn(),
  setActiveWorkspace: vi.fn(),
  unlinkRepository: vi.fn(),
}));
vi.mock('../../../workspaces/members', () => ({
  mutationUser: vi.fn(),
  lockWorkspace: vi.fn(),
  authorizeOwner: vi.fn(),
  changeMemberRole: vi.fn(),
  removeMember: vi.fn(),
}));
vi.mock('../../../workspaces/invitations', () => ({
  createInvitation: vi.fn(),
  resendInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
}));
vi.mock('../../../db/queries/grader-publishing', () => ({
  claimHandle: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { requireWorkspace } from '../../../workspaces/access';
import { mutationUser, changeMemberRole } from '../../../workspaces/members';
import { createInvitation } from '../../../workspaces/invitations';
import { claimHandle } from '../../../db/queries/grader-publishing';
import { EmailDeliveryError } from '../../../email/resend';
import {
  saveWorkspaceName,
  saveAccountName,
  updateMember,
  switchWorkspace,
  inviteMember,
  saveWorkspaceHandle,
} from './actions';
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mutationUser).mockResolvedValue({
    id: 'u',
    login: 'owner',
    displayName: null,
    avatarUrl: null,
  });
});
test('workspace rename checks the caller, not a submitted role', async () => {
  vi.mocked(requireWorkspace).mockRejectedValue(new Error('Forbidden'));
  const form = new FormData();
  form.set('name', 'Renamed');
  form.set('role', 'owner');
  await expect(saveWorkspaceName(form)).rejects.toThrow('Forbidden');
});
test('account names reject blank and overlong input', async () => {
  for (const name of ['   ', 'x'.repeat(81)]) {
    const form = new FormData();
    form.set('name', name);
    expect(await saveAccountName(form)).toEqual({
      error: 'Enter a name between 1 and 80 characters.',
    });
  }
});
test('last owner policy is returned as a safe inline error', async () => {
  vi.mocked(requireWorkspace).mockResolvedValue({
    id: 'w',
    name: 'Workspace',
    handle: null,
    role: 'owner',
  });
  vi.mocked(changeMemberRole).mockRejectedValue(new Error('Workspace must retain an owner'));
  const form = new FormData();
  form.set('userId', 'u');
  form.set('role', 'member');
  expect(await updateMember(form)).toEqual({ error: 'Keep at least one owner in this workspace.' });
});
test('unknown failures never reveal provider or database details', async () => {
  vi.mocked(requireWorkspace).mockResolvedValue({
    id: 'w',
    name: 'Workspace',
    handle: null,
    role: 'owner',
  });
  vi.mocked(changeMemberRole).mockRejectedValue(new Error('secret postgres credential'));
  const form = new FormData();
  form.set('userId', 'u');
  form.set('role', 'member');
  expect(await updateMember(form)).toEqual({
    error: 'We could not save this change. Please try again.',
  });
});

test('switching cannot select a workspace without membership', async () => {
  vi.mocked(requireWorkspace).mockRejectedValue(new Error('Forbidden'));
  const form = new FormData();
  form.set('workspaceId', 'outsider');
  await expect(switchWorkspace(form)).rejects.toThrow('Forbidden');
});
test('demo guard rejects account mutation before storage', async () => {
  vi.mocked(mutationUser).mockRejectedValue(new Error('Workspace unavailable'));
  const form = new FormData();
  form.set('name', 'Name');
  await expect(saveAccountName(form)).rejects.toThrow('Workspace unavailable');
});
test('missing delivery setup is actionable and never reported as sent', async () => {
  vi.mocked(requireWorkspace).mockResolvedValue({
    id: 'w',
    name: 'Workspace',
    handle: null,
    role: 'owner',
  });
  vi.mocked(createInvitation).mockRejectedValue(new EmailDeliveryError('email_unavailable'));
  const form = new FormData();
  form.set('email', 'teammate@example.com');
  expect((await inviteMember(form)).error).toMatch('RESEND_API_KEY and RESEND_FROM_EMAIL');
});
test('claiming a handle passes the submitted value and reports a taken one in words', async () => {
  const form = new FormData();
  form.set('handle', 'acme');
  vi.mocked(claimHandle).mockResolvedValue(undefined);
  expect(await saveWorkspaceHandle(form)).toEqual({});
  expect(claimHandle).toHaveBeenCalledWith('acme');

  vi.mocked(claimHandle).mockRejectedValue(new Error('Handle unavailable'));
  expect(await saveWorkspaceHandle(form)).toEqual({
    error: 'That handle is taken or reserved. Try another.',
  });
});
test('Next navigation errors remain framework control flow', async () => {
  vi.mocked(requireWorkspace).mockResolvedValue({
    id: 'w',
    name: 'Workspace',
    handle: null,
    role: 'owner',
  });
  const navigation = Object.assign(new Error('redirect'), {
    digest: 'NEXT_REDIRECT;replace;/signed-out;307;',
  });
  vi.mocked(changeMemberRole).mockRejectedValue(navigation);
  const form = new FormData();
  form.set('userId', 'u');
  form.set('role', 'member');
  await expect(updateMember(form)).rejects.toBe(navigation);
});
