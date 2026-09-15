'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { ManifestError } from '../../../../domain/grading/manifest';
import { publishGrader, withdrawVersion } from '../../../../db/queries/grader-publishing';

type Result = { error?: string };
const value = (form: FormData, key: string) => String(form.get(key) ?? '');

async function save(operation: () => Promise<unknown>, fallback: string): Promise<Result> {
  try {
    await operation();
    revalidatePath('/', 'layout');
    return {};
  } catch (error) {
    unstable_rethrow(error);
    // A manifest error is the author's own words about their own file: show it.
    if (error instanceof ManifestError) return { error: `${error.code}: ${error.message}` };
    const messages: Record<string, string> = {
      'Claim a handle first': 'Claim a publishing handle for this workspace first.',
      'Wrong namespace': 'A grader id must start with this workspace’s handle.',
      'Grader name taken': 'Another workspace owns that grader name.',
      'Version already published': 'That version already exists. Publish a new version instead.',
      'Code graders cannot be published yet': 'Code graders cannot be published yet.',
      'Grader unavailable': 'That grader is not yours to change.',
      'Version unavailable': 'That version is no longer available.',
    };
    return {
      error: (error instanceof Error && messages[error.message]) || fallback,
    };
  }
}

export async function publishGraderVersion(form: FormData): Promise<Result> {
  return save(
    () => publishGrader(value(form, 'manifest')),
    'We could not publish this grader. Please try again.',
  );
}

export async function withdrawGraderVersion(form: FormData): Promise<Result> {
  return save(
    () => withdrawVersion(value(form, 'graderId'), value(form, 'version'), value(form, 'note')),
    'We could not withdraw this version. Please try again.',
  );
}
