import { type Capabilities, type LockupLine, banner as bannerLines } from './brand';

export type Env = Record<string, string | undefined>;
export type Stream = { isTTY?: boolean; columns?: number; write(chunk: string): unknown };

// Original Ember #BE421F, the seal's own colour in field-lines.svg.
const EMBER = '\x1b[38;2;190;66;31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export function capabilities(stream: Stream, env: Env): Capabilities & { color: boolean } {
  const dumb = env.TERM === 'dumb';
  return {
    columns: stream.columns ?? 80,
    unicode: !dumb,
    color: Boolean(stream.isTTY) && !dumb && env.NO_COLOR === undefined,
  };
}

// One check governs all of it. A tool that is delightful in a terminal and
// unusable in a pipeline has chosen the demo over the job.
export function shouldShowBanner(stream: Stream, env: Env, opts: { json: boolean }): boolean {
  if (opts.json) return false;
  if (!stream.isTTY) return false;
  if (env.CI !== undefined) return false;
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
  };
}
