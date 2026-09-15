import { manifestHash } from './manifest-hash';
import type { GraderManifest } from './manifest';

// GraderManifest['needs'] itself, but with readonly arrays: neither function
// here mutates a pattern list, and a caller — including a `needs` literal
// frozen with `as const` — should not have to widen it first just to hash or
// describe it.
type Needs = {
  'repo.files'?: readonly string[];
  'repo.tree'?: readonly string[];
  'fieldnote.metrics'?: GraderManifest['needs']['fieldnote.metrics'];
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
