import { describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { challengeFor } from './route';

describe('challengeFor', () => {
  it('is the S256 challenge of the verifier, so the code is useless without it', () => {
    const verifier = randomBytes(32).toString('base64url');
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(challengeFor(verifier)).toBe(expected);
  });

  it('does not match a different verifier', () => {
    expect(challengeFor('a')).not.toBe(challengeFor('b'));
  });
});
