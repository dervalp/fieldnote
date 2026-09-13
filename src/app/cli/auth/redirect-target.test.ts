import { describe, expect, it } from 'vitest';
import { isLoopbackRedirect } from './redirect-target';

describe('isLoopbackRedirect', () => {
  it('accepts the loopback listener the CLI actually opens', () => {
    expect(isLoopbackRedirect('http://127.0.0.1:51789')).toBe(true);
    expect(isLoopbackRedirect('http://localhost:51789/')).toBe(true);
  });

  it('rejects any other host, which is the whole point', () => {
    expect(isLoopbackRedirect('https://attacker.example/collect')).toBe(false);
    expect(isLoopbackRedirect('http://attacker.example/collect')).toBe(false);
  });

  it('rejects hosts that merely look like loopback', () => {
    expect(isLoopbackRedirect('http://127.0.0.1.evil.com/')).toBe(false);
    expect(isLoopbackRedirect('http://127.0.0.1@evil.com/')).toBe(false);
    expect(isLoopbackRedirect('http://notlocalhost/')).toBe(false);
  });

  it('rejects a non-http scheme even on loopback', () => {
    expect(isLoopbackRedirect('javascript:alert(1)')).toBe(false);
    expect(isLoopbackRedirect('file:///etc/passwd')).toBe(false);
    expect(isLoopbackRedirect('https://127.0.0.1:51789')).toBe(false);
  });

  it('rejects anything that is not a URL at all', () => {
    expect(isLoopbackRedirect('')).toBe(false);
    expect(isLoopbackRedirect('/cli/auth')).toBe(false);
    expect(isLoopbackRedirect('//evil.com')).toBe(false);
  });
});
