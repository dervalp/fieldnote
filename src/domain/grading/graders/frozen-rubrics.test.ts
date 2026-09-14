// The barrel comes first: importing it is what registers every built-in.
import './index';
import { expect, test } from 'vitest';
import { manifestHash } from '../manifest-hash';
import { listGraders } from '../registry';

// What registerRubric freezes for an (id, version): the whole manifest except
// `card`, which is copy. Computed here the way registerRubric computes it
// rather than by exporting its private helper.
function frozenHash(manifest: object) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- discarded on purpose
  const { card: _card, ...rest } = manifest as Record<string, unknown>;
  return manifestHash(rest);
}

// Changing a frozen field or a program without bumping `version` breaks every
// database that registered this version: registerRubric rejects the manifest
// with "Rubric version definition mismatch" on every grade request. Bump the
// version, then update the pin. A card-only change keeps the hash.
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
    listGraders().map((manifest) => [`${manifest.id}@${manifest.version}`, frozenHash(manifest)]),
  );
  expect(actual).toEqual(PINNED);
});
