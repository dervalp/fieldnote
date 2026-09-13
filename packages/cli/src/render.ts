import { type Capabilities, type LockupLine, banner as bannerLines } from './brand.ts';
import type { Line } from './grade-view.ts';

export type Env = Record<string, string | undefined>;
export type Stream = { isTTY?: boolean; columns?: number; write(chunk: string): unknown };

// Original Ember #BE421F, the seal's own colour in field-lines.svg.
const EMBER = '\x1b[38;2;190;66;31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';

const COLOURS: Record<Line['kind'], string> = {
  card: BOLD,
  pass: GREEN,
  fail: RED,
  partial: YELLOW,
  dim: DIM,
  head: BOLD,
  blank: '',
  url: DIM,
};

// One predicate, two readers. `CI` is set by every runner worth naming and
// they disagree only on the value, so '', 'false' and unset all mean "not
// CI". The banner and the progress writer both consult this rather than
// each spelling it out: two spellings of "in CI" is two behaviours waiting
// to drift apart.
function isCI(env: Env): boolean {
  return env.CI !== undefined && env.CI !== '' && env.CI !== 'false';
}

export function capabilities(
  stream: Stream,
  env: Env,
): Capabilities & { color: boolean; live: boolean } {
  const dumb = env.TERM === 'dumb';
  const tty = Boolean(stream.isTTY);
  return {
    columns: stream.columns ?? 80,
    unicode: !dumb,
    color: tty && !dumb && env.NO_COLOR === undefined,
    // NO_COLOR asks for no colour, not no cursor: in-place rewriting is a
    // question of whether the terminal can do it at all (a TTY that isn't
    // "dumb"), independent of whether colour itself is switched off.
    //
    // CI overrides all of that. A runner that allocates a pty passes the TTY
    // test and would get `\r  running\x1b[K` written into a log file someone
    // reads six weeks later — so the spec's output-discipline table makes CI,
    // not isTTY, the deciding condition for the append-only path.
    live: tty && !dumb && !isCI(env),
  };
}

// One check governs all of it. A tool that is delightful in a terminal and
// unusable in a pipeline has chosen the demo over the job.
export function shouldShowBanner(stream: Stream, env: Env, opts: { json: boolean }): boolean {
  if (opts.json) return false;
  if (!stream.isTTY) return false;
  if (isCI(env)) return false;
  if (env.FIELDNOTE_NO_BANNER !== undefined) return false;
  return true;
}

export function createOutput(stream: Stream, env: Env) {
  const caps = capabilities(stream, env);

  const paint = (line: LockupLine) => {
    if (!caps.color) return line.seal + line.mark;
    const seal = line.seal === '' ? '' : EMBER + line.seal + RESET;
    const mark = line.mark === '' ? '' : BOLD + line.mark + RESET;
    return seal + mark;
  };

  return {
    caps,
    line(text: string) {
      stream.write(text + '\n');
    },
    banner() {
      for (const line of bannerLines(caps)) stream.write(paint(line) + '\n');
    },
    lines(items: Line[]) {
      for (const item of items) {
        const colour = caps.color ? COLOURS[item.kind] : '';
        stream.write((colour && item.text ? colour + item.text + RESET : item.text) + '\n');
      }
    },
    // No timer, so nothing to mock: the poll ticks once a second and the only
    // events worth reporting are the transitions. A TTY rewrites one line in
    // place; a pipeline gets one line per state instead of a thousand frames.
    progress() {
      const live = caps.live;
      let last: string | undefined;
      return {
        state(next: string) {
          if (next === last) return;
          last = next;
          // \x1b[K clears from the cursor to the end of the line: without it,
          // a shorter state (e.g. "failed") rewritten over a longer one
          // ("running") leaves that line's own trailing letters as residue.
          stream.write(live ? `\r  ${next}\x1b[K` : `  ${next}\n`);
        },
        done() {
          if (live && last !== undefined) stream.write('\n');
        },
      };
    },
  };
}
