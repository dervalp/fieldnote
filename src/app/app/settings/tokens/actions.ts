'use server';
import { revalidatePath } from 'next/cache';
import { currentUser } from '../../../../auth/session';
import { revokeToken } from '../../../../db/queries/cli-tokens';

// The user id comes from the session, never from the form. A revoke that
// trusted its input would let anyone revoke anyone's token.
export async function revokeTokenAction(id: string): Promise<void> {
  const user = await currentUser();
  await revokeToken(id, user.id);
  revalidatePath('/settings/tokens');
}
