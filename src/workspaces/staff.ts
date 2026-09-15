import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '../db';
import { users } from '../db/schema';
import { currentUser } from '../auth/session';

/**
 * fieldnote staff. The flag is set directly in the database — there is no
 * screen for granting it, which the design records as knowingly wrong.
 */
async function staffRow(): Promise<{ id: string; staff: boolean }> {
  const user = await currentUser();
  const [row] = await db().select({ staff: users.staff }).from(users).where(eq(users.id, user.id));
  return { id: user.id, staff: row?.staff ?? false };
}

/**
 * Non-throwing staff check, for a caller that wants to branch on it rather
 * than have the request end — withdrawVersion's ownership check, for one,
 * which staff must be able to skip without requireStaff()'s notFound() short
 * -circuiting the rest of the function.
 */
export async function isStaff(): Promise<boolean> {
  return (await staffRow()).staff;
}

/**
 * A non-staff caller gets notFound(), not a refusal: the review queue does
 * not advertise that it exists.
 */
export async function requireStaff(): Promise<{ id: string }> {
  const row = await staffRow();
  if (!row.staff) notFound();
  return { id: row.id };
}
