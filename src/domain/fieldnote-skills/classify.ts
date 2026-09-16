import type { InstallationObservation, InstallationState } from './types';

interface InstallationClassificationInput {
  observation: InstallationObservation | null;
  latest: string;
  openPr: { runId: string; pullRequestUrl: string | null } | null;
}

export function classifyInstallation({
  observation,
  latest,
  openPr,
}: InstallationClassificationInput): InstallationState {
  if (openPr) return { kind: 'proposed', ...openPr };
  if (!observation) return { kind: 'missing', latest };
  if (observation.state === 'partial' || observation.state === 'drifted') {
    return { kind: observation.state, release: observation.release, reasons: observation.reasons };
  }
  if (observation.state === 'outdated' || observation.release !== latest) {
    return { kind: 'outdated', installed: observation.release, latest };
  }
  return { kind: 'current', release: observation.release };
}
