'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { verifyVersion, withdrawVersion } from '../../../../db/queries/grader-publishing';

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

export async function withdrawGraderVersionAsStaff(form: FormData): Promise<Result> {
  return save(
    () => withdrawVersion(value(form, 'graderId'), value(form, 'version'), value(form, 'note')),
    'We could not withdraw this version. Please try again.',
  );
}
