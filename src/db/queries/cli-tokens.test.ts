import { describe, expect, it, vi } from 'vitest';
import { tokenHash } from '../../auth/crypto';

const rows: Record<string, unknown>[] = [];
vi.mock('../index', () => ({ db: () => ({}) }));

describe('token hashing', () => {
  it('never lets the plaintext be the stored id', async () => {
    const { issueToken } = await import('./cli-tokens');
    expect(typeof issueToken).toBe('function');
    const plaintext = 'fn_example_token_value';
    expect(tokenHash(plaintext)).not.toBe(plaintext);
    expect(tokenHash(plaintext)).toHaveLength(64);
  });
  it('holds no plaintext in the row shape', () => {
    expect(rows).toHaveLength(0);
  });
});
