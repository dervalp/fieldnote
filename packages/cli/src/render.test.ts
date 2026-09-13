import { describe, expect, it } from 'vitest';
import { capabilities, createOutput, shouldShowBanner } from './render.ts';

const fake = (isTTY: boolean) => {
  const chunks: string[] = [];
  return { chunks, stream: { isTTY, columns: 100, write: (c: string) => chunks.push(c) } };
};

const tty = { isTTY: true, columns: 80, write: () => true };
const pipe = { isTTY: false, columns: undefined, write: () => true };

function capture(stream: Partial<typeof tty>) {
  const written: string[] = [];
  return { sink: { ...tty, ...stream, write: (c: string) => written.push(c) }, written };
}

describe('shouldShowBanner', () => {
  it('shows on an interactive terminal', () => {
    expect(shouldShowBanner(tty, {}, { json: false })).toBe(true);
  });

  it('never shows to a pipe — a banner glued to JSON is unparseable', () => {
    expect(shouldShowBanner(pipe, {}, { json: false })).toBe(false);
  });

  it('never shows alongside --json, even on a terminal', () => {
    expect(shouldShowBanner(tty, {}, { json: true })).toBe(false);
  });

  it('never shows in CI', () => {
    expect(shouldShowBanner(tty, { CI: 'true' }, { json: false })).toBe(false);
  });

  it('obeys FIELDNOTE_NO_BANNER', () => {
    expect(shouldShowBanner(tty, { FIELDNOTE_NO_BANNER: '1' }, { json: false })).toBe(false);
  });
});

describe('capabilities', () => {
  it('measures the terminal rather than assuming eighty', () => {
    expect(capabilities({ ...tty, columns: 38 }, {}).columns).toBe(38);
  });

  it('falls back to eighty when the width is unknown', () => {
    expect(capabilities(pipe, {}).columns).toBe(80);
  });

  it('drops colour for NO_COLOR but keeps the shape', () => {
    const caps = capabilities(tty, { NO_COLOR: '1' });
    expect(caps.color).toBe(false);
    expect(caps.unicode).toBe(true);
  });

  it('drops box drawing for a dumb terminal', () => {
    expect(capabilities(tty, { TERM: 'dumb' }).unicode).toBe(false);
  });
});

describe('createOutput', () => {
  it('emits no escape sequence when colour is off', () => {
    const { sink, written } = capture({});
    createOutput(sink, { NO_COLOR: '1' }).banner();
    expect(written.join('')).not.toMatch(/\x1b\[/);
  });

  it('colours the seal with the brand ember', () => {
    const { sink, written } = capture({});
    createOutput(sink, {}).banner();
    const text = written.join('');
    expect(text).toMatch(/\x1b\[38;2;190;66;31m/);
    // The disclaimer is wrapped to the measure and painted per line, so it is
    // compared as plain flowed text: escapes stripped, whitespace collapsed.
    const plain = text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+/g, ' ');
    expect(plain).toContain('Nothing on this machine is uploaded');
  });

  it('writes one physical line per lockup line, so the disclaimer keeps its wrapping', () => {
    const { sink, written } = capture({});
    createOutput(sink, { NO_COLOR: '1' }).banner();
    const lines = written.join('').split('\n');
    // Trailing newline yields one empty final element.
    expect(lines.pop()).toBe('');
    expect(lines.length).toBeGreaterThan(6);
    for (const line of lines) {
      expect([...line].length).toBeLessThanOrEqual(80);
    }
  });
});

describe('out.lines', () => {
  it('writes one line per Line, in order, with no colour when colour is off', () => {
    const { chunks, stream } = fake(false);
    createOutput(stream, {}).lines([
      { kind: 'head', text: 'dervalp/fieldnote' },
      { kind: 'blank', text: '' },
      { kind: 'pass', text: 'An agent brief exists' },
    ]);
    expect(chunks.join('')).toBe('dervalp/fieldnote\n\nAn agent brief exists\n');
  });

  it('colours a pass and a fail differently when colour is on', () => {
    const { chunks, stream } = fake(true);
    const out = createOutput(stream, {});
    out.lines([
      { kind: 'pass', text: 'a' },
      { kind: 'fail', text: 'b' },
    ]);
    expect(chunks[0]).not.toBe(chunks[1].replace('b', 'a'));
    expect(chunks[0]).toContain('\x1b[');
  });
});

describe('out.progress', () => {
  it('appends one line per state transition when not a TTY', () => {
    const { chunks, stream } = fake(false);
    const progress = createOutput(stream, {}).progress();
    progress.state('queued');
    progress.state('queued');
    progress.state('running');
    progress.done();
    expect(chunks.join('')).toBe('  queued\n  running\n');
  });

  it('rewrites one line in place in a TTY, and ends it', () => {
    const { chunks, stream } = fake(true);
    const progress = createOutput(stream, {}).progress();
    progress.state('queued');
    progress.state('running');
    progress.done();
    expect(chunks[0]).toContain('\r');
    expect(chunks.join('').endsWith('\n')).toBe(true);
    // One transition, one write, plus the terminating newline.
    expect(chunks).toHaveLength(3);
  });

  it('writes nothing at all if no state ever arrives', () => {
    const { chunks, stream } = fake(true);
    createOutput(stream, {}).progress().done();
    expect(chunks).toEqual([]);
  });

  it('still rewrites in place under NO_COLOR — that turns off colour, not the cursor', () => {
    const { chunks, stream } = fake(true);
    const progress = createOutput(stream, { NO_COLOR: '1' }).progress();
    progress.state('queued');
    progress.state('running');
    progress.done();
    expect(chunks[0]).toContain('\r');
    expect(chunks).toHaveLength(3);
  });

  it('clears to the end of the line on each rewrite, so a shorter state leaves no residue', () => {
    const { chunks, stream } = fake(true);
    const progress = createOutput(stream, {}).progress();
    progress.state('running');
    progress.state('failed');
    progress.done();
    expect(chunks[1]).toBe('\r  failed\x1b[K');
  });
});
