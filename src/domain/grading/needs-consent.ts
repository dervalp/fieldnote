import { manifestHash } from './manifest-hash';
import type { GraderManifest } from './manifest';

// GraderManifest['needs'] itself, but with readonly arrays: neither function
// here mutates a pattern list, and a caller — including a `needs` literal
// frozen with `as const` — should not have to widen it first just to hash or
// describe it. Mapped from GraderManifest['needs'] rather than hand-listed,
// so a family added to the schema arrives here automatically — it is
// consentSentences() below that must then fail to compile until it handles
// the new family, not this type falling silently out of date with it.
type Needs = {
  [K in keyof GraderManifest['needs']]: NonNullable<GraderManifest['needs'][K]> extends readonly string[]
    ? readonly string[]
    : GraderManifest['needs'][K];
};

/**
 * What a workspace agreed a grader may read. The canonical manifest hash, so
 * key order cannot make the same permission look like a different one — and so
 * widening a pattern, adding a family or lengthening a window always does.
 */
export function needsHash(needs: Needs): string {
  return manifestHash(needs);
}

/**
 * The consent screen's sentences, generated from the declaration rather than
 * written per grader: an author cannot describe their own permissions, and a
 * family added to the schema without a sentence here is a compile error.
 */
export function consentSentences(needs: Needs): string[] {
  const sentences: string[] = [];
  const files = needs['repo.files'];
  if (files) sentences.push(`The contents of files matching ${files.join(', ')}`);
  if (needs['repo.tree']) sentences.push('The list of file names in your repositories');
  const metrics = needs['fieldnote.metrics'];
  if (metrics)
    sentences.push(
      `Your merged pull request and CI record over ${metrics.windowDays} days`,
    );
  return sentences;
}
