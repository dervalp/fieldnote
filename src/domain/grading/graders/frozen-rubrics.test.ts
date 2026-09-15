import { expect, test } from 'vitest';
import { manifestHash } from '../manifest-hash';
import { builtInManifests } from '../registry';

// What must never change for an already-shipped (id, version): the whole
// manifest except `card`, which is copy. Computed here directly rather than
// by exporting a private helper — nothing in production hashes a manifest
// this way any more, since (grader_id, version) rows are immutable and
// publishing over an existing one fails on its own, with 'Version already
// published'.
function frozenHash(manifest: object) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- discarded on purpose
  const { card: _card, ...rest } = manifest as Record<string, unknown>;
  return manifestHash(rest);
}

// Changing a frozen field or a program without bumping `version` is not
// caught at publish time — seedBuiltInGraders() re-seeds a built-in with
// onConflictDoNothing, so a changed manifest under an unbumped version just
// silently loses to whatever is already stored. This pinned hash is the
// guard: it fails here, in CI, rather than as a database quietly out of sync
// with the code that thinks it published it. Bump the version, then update
// the pin. A card-only change keeps the hash.
const PINNED: Record<string, string> = {
  'fieldnote/agent-readiness@0.1.0':
    '5d9fa1bb2bd768c1a6dd0b61d049ab2faab80d43ba5a78554a67e745ee413f01',
  'fieldnote/delivery-health@0.2.0':
    'ebf61bdebe419fbc52c1148d9ecacef1627e64b65dcaa6bf06b5cf9db9fb2e43',
  'fieldnote/test-discipline@0.1.0':
    'ba381242b2cb1ea939bd9335d07777cd871f6b080076fa061ab2642c4cc631d1',
};

test('every built-in version still freezes exactly what it froze when it shipped', () => {
  const actual = Object.fromEntries(
    builtInManifests().map((manifest) => [`${manifest.id}@${manifest.version}`, frozenHash(manifest)]),
  );
  expect(actual).toEqual(PINNED);
});
