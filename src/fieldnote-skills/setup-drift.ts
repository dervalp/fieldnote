import 'server-only';
import { existingInstallationLock, managedDriftQuestion } from '../domain/fieldnote-skills/drift';
import type { SetupRepositorySnapshot, SkillsRelease } from '../domain/fieldnote-skills/types';
import { readSkillsRelease } from './github-release';

export async function inspectSetupDrift(
  snapshot: SetupRepositorySnapshot,
  target: Pick<SkillsRelease, 'release' | 'revision' | 'releaseLockHash'>,
) {
  const existing = existingInstallationLock(snapshot);
  // A broken/missing installation record is repairable, but never permission to overwrite.
  let installed: SkillsRelease | null = null;
  if (existing) {
    try {
      installed = await readSkillsRelease(existing.lock.release);
    } catch {
      /* Provider diagnostics are neither approval nor user-facing evidence. */
    }
  }
  return managedDriftQuestion(snapshot, installed, target);
}
