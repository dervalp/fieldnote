import { ManifestError, parseManifest, type GraderManifest } from './manifest';

// Built-ins are registered at boot, the way registerRubric() already works.
// There is no install flow, no publishing and no marketplace in this slice —
// but a built-in grader is an ordinary grader, so it comes through this door
// and gets no private interface behind it.
const graders = new Map<string, GraderManifest>();

export function registerGrader(input: unknown): GraderManifest {
  const manifest = parseManifest(input);
  if (manifest.kind === 'code')
    throw new ManifestError(
      'kind_unsupported',
      `Grader '${manifest.id}' ships code, which is not yet supported.`,
    );
  graders.set(manifest.id, manifest);
  return manifest;
}

export function getGrader(graderId: string): GraderManifest {
  const manifest = graders.get(graderId);
  if (!manifest)
    throw new ManifestError('unknown_grader', `No grader '${graderId}' is registered.`);
  return manifest;
}

export function graderCheckTitles(graderId: string): Record<string, string> {
  return Object.fromEntries(getGrader(graderId).checks.map((check) => [check.id, check.title]));
}
