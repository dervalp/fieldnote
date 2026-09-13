'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { githubAccessibleRepositories } from '../../../auth/access';
import { linkRepository, requireRepository, requireWorkspace } from '../../../workspaces/access';
import { requestRepositoryImport } from '../../../db/queries/repository-imports';
import { dispatchImport } from '../../../inngest/dispatch-import';
import { ImportRequestError, type StartResult } from '../../../domain/import/types';
const idSchema = z.string().trim().min(1);
async function requestAnalysis(
  repositoryId: string,
  intent: 'start' | 'refresh' | 'retry',
  runId?: string,
): Promise<StartResult> {
  await requireRepository(repositoryId, true);
  let run;
  try {
    run = await requestRepositoryImport(repositoryId, intent, runId);
  } catch (error) {
    if (error instanceof ImportRequestError)
      return { error: 'This import cannot be requested. Refresh the page and try again.' };
    throw error;
  }
  try {
    await dispatchImport(run.id);
  } catch {
    console.error('Import queued for dispatch retry', { runId: run.id });
  }
  revalidatePath('/dashboard');
  revalidatePath(`/repos/${encodeURIComponent(repositoryId)}`);
  return { run };
}
export async function startFirstAnalysis(
  _previous: StartResult,
  form: FormData,
): Promise<StartResult> {
  const parsed = idSchema.safeParse(form.get('repositoryId'));
  if (!parsed.success) return { error: 'Choose a repository to continue.' };
  const workspace = await requireWorkspace(undefined, 'owner');
  await linkRepository(workspace.id, parsed.data);
  return requestAnalysis(parsed.data, 'start');
}
export async function retryAnalysis(repositoryId: string, runId: string): Promise<StartResult> {
  const repo = idSchema.safeParse(repositoryId),
    run = idSchema.safeParse(runId);
  if (!repo.success || !run.success) return { error: 'Choose an import to retry.' };
  return requestAnalysis(repo.data, 'retry', run.data);
}
export async function refreshAnalysis(repositoryId: string): Promise<StartResult> {
  const parsed = idSchema.safeParse(repositoryId);
  if (!parsed.success) return { error: 'Choose a repository to continue.' };
  return requestAnalysis(parsed.data, 'refresh');
}

export async function refreshRepositoryAccess(): Promise<void> {
  await requireWorkspace(undefined, 'owner');
  await githubAccessibleRepositories(true);
}
