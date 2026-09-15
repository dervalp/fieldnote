import { eq } from 'drizzle-orm';
import { db } from '../index';
import { workspaces } from '../schema';
import { requireWorkspace } from '../../workspaces/access';

// A handle becomes the owner segment of every grader id this workspace
// publishes, so these are the names a URL, a route or fieldnote itself needs.
export const RESERVED_HANDLES = [
  'fieldnote',
  'admin',
  'api',
  'app',
  'r',
  'www',
  'support',
] as const;
const HANDLE = /^[a-z0-9][a-z0-9-]{1,38}$/;

/**
 * Claim the name this workspace publishes under. Owners only, once and never
 * again: published grader ids contain the handle, and other workspaces' installs
 * point at those ids, so a rename would orphan them.
 *
 * Checked before the format: a reserved name is refused for what it is, not
 * for how it is shaped, and 'r' — one character, reserved — must not fall
 * through to "Invalid handle" just because the format regex would also reject
 * it.
 */
export async function claimHandle(handle: string): Promise<void> {
  const workspace = await requireWorkspace(undefined, 'owner');
  if ((RESERVED_HANDLES as readonly string[]).includes(handle))
    throw new Error('Handle unavailable');
  if (!HANDLE.test(handle)) throw new Error('Invalid handle');
  const [existing] = await db()
    .select({ handle: workspaces.handle })
    .from(workspaces)
    .where(eq(workspaces.id, workspace.id));
  if (existing?.handle) throw new Error('Handle already claimed');
  try {
    await db().update(workspaces).set({ handle }).where(eq(workspaces.id, workspace.id));
  } catch (error) {
    // The unique index is the race winner, not this read-then-write. Drizzle
    // wraps the driver's error in a DrizzleQueryError whose own message is
    // just the failed SQL; postgres's error code travels one level down, on
    // `.cause`, not on the wrapper itself.
    if (isUniqueViolation(error)) throw new Error('Handle unavailable');
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code = (candidate: unknown) =>
    typeof candidate === 'object' && candidate !== null && 'code' in candidate
      ? (candidate as { code: unknown }).code
      : undefined;
  const cause = (error as { cause?: unknown } | null)?.cause;
  return code(error) === '23505' || code(cause) === '23505';
}
