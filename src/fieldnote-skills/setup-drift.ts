import 'server-only';
import { existingInstallationLock, managedDriftQuestion } from '../domain/fieldnote-skills/drift';
import type { SetupRepositorySnapshot, SkillsRelease } from '../domain/fieldnote-skills/types';
import { readSkillsRelease } from './github-release';

export async function inspectSetupDrift(
  snapshot: SetupRepositorySnapshot,
  target: Pick<SkillsRelease, 'release' | 'revision' | 'releaseLockHash'>,
) {
  const existing = existingInstallationLock(snapshot);
  if (!existing) return null;
  const installed = await readSkillsRelease(existing.lock.release);
  return managedDriftQuestion(snapshot, installed, target);
}
