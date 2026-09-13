import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cliVersion } from './version';

describe('cliVersion', () => {
  it('is the package version, so the banner can never drift from what was installed', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(cliVersion()).toBe(pkg.version);
  });

  it('is a semver triple', () => {
    expect(cliVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
