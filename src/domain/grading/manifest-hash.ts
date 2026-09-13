import { createHash } from 'node:crypto';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}

/**
 * A stable fingerprint of a manifest, so a grade cannot complete against a
 * manifest that changed after the run was queued. Key order is not identity:
 * the same manifest through a JSONB round-trip must hash the same.
 */
export function manifestHash(manifest: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(manifest)))
    .digest('hex');
}
