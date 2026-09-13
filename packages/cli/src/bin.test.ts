import { describe, expect, it } from 'vitest';
import { run } from './bin.ts';

const tty = { isTTY: true, columns: 80, write: () => true };

function capture(env: Record<string, string | undefined> = {}) {
  const written: string[] = [];
  const sink = { ...tty, write: (c: string) => written.push(c) };
  return { sink, env, text: () => written.join('') };
}

describe('run', () => {
  it('prints the banner and a next step for a bare invocation', async () => {
    const c = capture();
    expect(await run([], c.sink, c.env)).toBe(0);
    // The disclaimer is wrapped to the measure and painted per line, so it is
    // compared as plain flowed text: escapes stripped, whitespace collapsed.
    const plain = c
      .text()
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/\s+/g, ' ');
    expect(plain).toContain('Nothing on this machine is uploaded');
    expect(c.text()).toContain('fieldnote run');
  });

  it('prints help with every group a developer might be looking for', async () => {
    const c = capture();
    expect(await run(['--help'], c.sink, c.env)).toBe(0);
    for (const group of ['GRADING', 'GRADERS', 'ACCOUNT', 'AGENTS']) {
      expect(c.text()).toContain(group);
    }
  });

  it('prints the version alone for --version, so a script can read it', async () => {
    const c = capture();
    expect(await run(['--version'], c.sink, c.env)).toBe(0);
    expect(c.text().trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('lists mcp as coming soon and exits zero rather than pretending', async () => {
    const c = capture();
    expect(await run(['mcp'], c.sink, c.env)).toBe(0);
    expect(c.text()).toContain('coming soon');
  });

  it('exits 2 on an unknown command and names the one that exists', async () => {
    const c = capture();
    expect(await run(['grade'], c.sink, c.env)).toBe(2);
    expect(c.text()).toContain('fieldnote run');
  });

  it('does not print a banner into a pipe', async () => {
    const written: string[] = [];
    const pipe = { isTTY: false, columns: undefined, write: (c: string) => written.push(c) };
    await run([], pipe, {});
    expect(written.join('')).not.toContain('╭');
  });
});
