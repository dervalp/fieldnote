import { describe, expect, it } from 'vitest';
import { tokensSettingsPath } from './app-routes';
import { TOKENS_PATH } from '../../packages/cli/src/urls.ts';

// The CLI prints a link to the tokens page, and it cannot import app-routes:
// packages/cli is a publishable package with no build step, so a specifier
// reaching outside it would break the tarball. That leaves two copies of one
// path, and two copies of anything drift.
//
// This is where they are held together. It runs under vitest, which resolves
// both through a bundler — the app half could never be imported by the CLI at
// runtime, but a test can see both at once, and that is all this needs.
//
// Both sides are compared against the literal rather than against each other:
// app-routes.ts says a test that builds its expected href from its own
// functions asserts nothing, and it is right.
describe('the tokens path the CLI prints', () => {
  it('is the same path the app serves it at', () => {
    expect(tokensSettingsPath()).toBe('/app/settings/tokens');
    expect(TOKENS_PATH).toBe('/app/settings/tokens');
  });
});
