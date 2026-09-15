'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { verifyVersion, withdrawVersion } from '../../../../db/queries/grader-publishing';
import { requireStaff } from '../../../../workspaces/staff';

type Result = { error?: string };
const value = (form: FormData, key: string) => String(form.get(key) ?? '');

// Same shape as the settings graders actions: a per-action fallback sentence,
// with an optional per-action override of a shared error's copy.
async function save(
  operation: () => Promise<unknown>,
  fallback: string,
  overrides: Record<string, string> = {},
): Promise<Result> {
  try {
    await operation();
    revalidatePath('/', 'layout');
    return {};
  } catch (error) {
    unstable_rethrow(error);
    const messages: Record<string, string> = {
      'Version unavailable': 'That version is no longer available.',
      ...overrides,
    };
    return {
      error: (error instanceof Error && messages[error.message]) || fallback,
    };
  }
}

export async function verifyGraderVersion(form: FormData): Promise<Result> {
  return save(
    () => verifyVersion(value(form, 'graderId'), value(form, 'version')),
    'We could not mark this version verified. Please try again.',
  );
}

// withdrawVersion() alone would let a non-staff workspace owner through too
// (it already permits that, for the settings page's own withdraw action) —
// no escalation, since an owner can already withdraw their own grader there,
// but this action's name promises staff-only, so it checks that itself
// rather than relying on withdrawVersion()'s unrelated ownership rule.
export async function withdrawGraderVersionAsStaff(form: FormData): Promise<Result> {
  return save(async () => {
    await requireStaff();
    await withdrawVersion(value(form, 'graderId'), value(form, 'version'), value(form, 'note'));
  }, 'We could not withdraw this version. Please try again.');
}
