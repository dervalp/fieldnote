'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireRepository } from '../../../../auth/access';
import { setGatePolicy } from '../../../../db/queries/persist-pr';
import { setActEnabled } from '../../../../db/queries/act-settings';
import { dashboardPath, repoPath, repoSectionPath } from '../../../../lib/app-routes';
const gateSchema = z.object({ appId: z.string().min(1), name: z.string().min(1).max(500) });
export async function saveGates(repositoryId: string, form: FormData) {
  await requireRepository(repositoryId, true);
  const gates = z
    .array(gateSchema)
    .max(100)
    .parse(form.getAll('gate').map((value) => JSON.parse(String(value))));
  const unique = [...new Map(gates.map((g) => [JSON.stringify([g.appId, g.name]), g])).values()];
  await setGatePolicy(repositoryId, unique);
  revalidatePath(dashboardPath());
  revalidatePath(repoPath(repositoryId));
}

export async function refreshImport(repositoryId: string) {
  const { refreshAnalysis } = await import('../../onboarding/actions');
  const result = await refreshAnalysis(repositoryId);
  if (result.error) throw new Error(result.error);
}

export async function retryImport(repositoryId: string, runId: string) {
  const { retryAnalysis } = await import('../../onboarding/actions');
  const result = await retryAnalysis(repositoryId, runId);
  if (result.error) throw new Error(result.error);
}

export async function saveActEnabled(repositoryId: string, form: FormData) {
  await requireRepository(repositoryId, true);
  await setActEnabled(repositoryId, form.get('actEnabled') === 'on');
  revalidatePath(repoSectionPath(repositoryId, 'settings'));
  revalidatePath(repoSectionPath(repositoryId, 'grading'));
}
