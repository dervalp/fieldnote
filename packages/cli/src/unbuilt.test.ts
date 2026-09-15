import { describe, expect, it } from 'vitest';
import { REPOSITORY, UNBUILT, notBuiltYet, unbuiltCommand } from './unbuilt.ts';
import { helpText } from './help.ts';

describe('the unbuilt commands', () => {
  it('are listed in help, so the terminal is the roadmap', () => {
    for (const { command, summary } of UNBUILT) {
      expect(helpText()).toContain(command);
      expect(helpText()).toContain(summary);
    }
  });

  it('are marked in help as not built yet, every one of them', () => {
    for (const { command } of UNBUILT) {
      const row = helpText()
        .split('\n')
        .find((line) => line.includes(`  ${command} `) || line.trimEnd().endsWith(` ${command}`));
      expect(row, `no help row for ${command}`).toBeDefined();
      expect(row).toContain('not built yet');
    }
  });

  it('say not built yet, and say where to come and build it', () => {
    for (const { command } of UNBUILT) {
      const text = notBuiltYet(command);
      expect(text).toContain('not built yet');
      expect(text).toContain(REPOSITORY);
      expect(text).toMatch(/contribut/i);
    }
  });

  it('say what the command will do, so the invitation is something to act on', () => {
    for (const { command, summary } of UNBUILT) {
      expect(notBuiltYet(command)).toContain(summary);
    }
  });

  it('resolves a command name to its entry, and nothing else', () => {
    expect(unbuiltCommand('publish')?.command).toBe('publish');
    expect(unbuiltCommand('run')).toBeUndefined();
    expect(unbuiltCommand('')).toBeUndefined();
  });

  it('tells the reader this is early, on the first line of help', () => {
    const [first, second] = helpText().split('\n');
    expect(`${first}\n${second}`).toMatch(/work in progress/i);
    expect(`${first}\n${second}`).toContain(REPOSITORY);
  });
});
