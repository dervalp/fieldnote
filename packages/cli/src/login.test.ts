import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { awaitCallback, openBrowser } from './login.ts';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

describe('openBrowser', () => {
  it('spawns the platform opener with the url, and never a shell', async () => {
    const { spawn } = await import('node:child_process');
    const fake = Object.assign(new EventEmitter(), { unref: vi.fn() });
    vi.mocked(spawn).mockReturnValue(fake as never);

    openBrowser('http://127.0.0.1:1234/?x=1');

    expect(spawn).toHaveBeenCalledTimes(1);
    const [, , options] = vi.mocked(spawn).mock.calls[0];
    expect(options).not.toHaveProperty('shell', true);
    expect(fake.unref).toHaveBeenCalled();
  });

  it('is silent when the opener throws', async () => {
    const { spawn } = await import('node:child_process');
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('no opener on this box');
    });
    expect(() => openBrowser('http://127.0.0.1:1234/')).not.toThrow();
  });
});

describe('awaitCallback', () => {
  it('binds loopback only — never a listener a network can reach', async () => {
    const pending = awaitCallback(0, 'STATE', 2000);
    const address = await pending.address;
    expect(address.address).toBe('127.0.0.1');
    await fetch(`http://127.0.0.1:${address.port}/?code=X&state=STATE`);
    expect(await pending).toEqual({ code: 'X' });
  });

  it('rejects a mismatched state', async () => {
    const pending = awaitCallback(0, 'STATE', 2000);
    const address = await pending.address;
    await fetch(`http://127.0.0.1:${address.port}/?code=X&state=WRONG`);
    expect(await pending).toEqual({ error: 'state_mismatch' });
  });

  it('closes on timeout rather than leaving a port open on a laptop', async () => {
    const pending = awaitCallback(0, 'STATE', 50);
    const address = await pending.address;
    expect(await pending).toEqual({ error: 'timeout' });
    await expect(fetch(`http://127.0.0.1:${address.port}/`)).rejects.toThrow();
  });
});
