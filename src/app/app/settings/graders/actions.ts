'use server';
import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { ManifestError } from '../../../../domain/grading/manifest';
import { publishGrader, withdrawVersion } from '../../../../db/queries/grader-publishing';
import { installGrader, updateInstall, uninstallGrader } from '../../../../db/queries/grader-installs';

type Result = { error?: string };
const value = (form: FormData, key: string) => String(form.get(key) ?? '');

// `overrides` lets one call give an error code its own wording — installing
// and withdrawing both throw 'Version unavailable' for unrelated reasons, and
// deserve different sentences for it — without duplicating the codes every
// action shares.
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
      'Grader not installed': 'That grader is not installed in this workspace.',
      ...overrides,
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

export async function installGraderVersion(form: FormData): Promise<Result> {
  return save(
    // redirect() throws its own control-flow error, caught by save()'s catch
    // below — whose first line, unstable_rethrow(error), recognizes it and
    // lets Next.js perform the navigation rather than treating it as a
    // failed install. Without this, the consent screen's own `?install=…`
    // URL survives a successful install exactly as it survives a failed
    // one, and the two are indistinguishable to the person looking at them.
    async () => {
      await installGrader(value(form, 'graderId'), value(form, 'version'));
      redirect('/app/settings/graders');
    },
    'We could not install this grader. Please try again.',
    { 'Version unavailable': 'That version is no longer available to install.' },
  );
}

export async function updateGraderInstall(form: FormData): Promise<Result> {
  return save(
    async () => {
      await updateInstall(value(form, 'graderId'), value(form, 'version'));
      redirect('/app/settings/graders');
    },
    'We could not update this grader. Please try again.',
    { 'Version unavailable': 'That version is no longer available to install.' },
  );
}

export async function uninstallGraderVersion(form: FormData): Promise<Result> {
  return save(
    () => uninstallGrader(value(form, 'graderId')),
    'We could not uninstall this grader. Please try again.',
  );
}
