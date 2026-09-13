import { cliVersion } from './version';

export type Capabilities = { columns: number; unicode: boolean };
export type LockupLine = { seal: string; mark: string };

// field-lines.svg on a character grid. Three concentric corners sharing one
// centre: verticals two columns apart, horizontals one row apart, all flush
// right and flush bottom — the vector's own geometry at 8 units to 2 columns
// or 1 row. Every row is eleven columns and a test says so, because a lockup
// that wraps is worse than no lockup.
export const SEAL = [
  '╭──────────',
  '│  ╭───────',
  '│  │  ╭────',
  '│  │  │    ',
  '│  │  │    ',
] as const;

// Drawn in the seal's own stroke so the two read as one object.
export const WORDMARK = [
  '┌─┐┬┌─┐┬  ┌┬┐┌┐┌┌─┐┌┬┐┌─┐',
  '├─ │├─ │   ││││││ │ │ ├─ ',
  '└  ┴└─┘┴─┘─┴┘┘└┘└─┘ ┴ └─┘',
] as const;

const INDENT = '   ';
const GAP = '   ';
const FULL = 46;
const SEAL_ONLY = 30;

export function lockup(caps: Capabilities): LockupLine[] {
  const licence = `${cliVersion()} · AGPL-3.0-only`;

  if (!caps.unicode || caps.columns < SEAL_ONLY) {
    return [
      { seal: '', mark: `  fieldnote ${cliVersion()}` },
      { seal: '', mark: '  AGPL-3.0-only' },
    ];
  }

  const seal = SEAL.map((row) => INDENT + row + GAP);

  if (caps.columns < FULL) {
    const narrow = SEAL.map((row) => '  ' + row + GAP);
    const beside = ['', 'fieldnote', cliVersion(), 'AGPL-3.0-only', ''];
    return narrow.map((row, i) => ({ seal: row, mark: beside[i] }));
  }

  const marks = ['', WORDMARK[0], WORDMARK[1], WORDMARK[2], licence];
  return seal.map((row, i) => ({ seal: row, mark: marks[i] }));
}

// Three claims, and the constraint is that each one is checkable. The first is
// true because fieldnote fetches the commit from GitHub rather than reading
// this machine. The second is true for a deterministic grader. The third is
// enforced by the manifest's `mode`, not by an author's manners — and it does
// not exempt our own graders, which is the only reason it is worth printing.
export const DISCLAIMER = [
  'fieldnote grades the repository you are standing in. Nothing on this machine is uploaded — fieldnote fetches the commit from GitHub, through the App you already installed.',
  'Every score is recomputed from that commit and replays the same way twice. Where a grader calls a model it has to declare it, and this terminal prints the declaration above the score — including for the graders we wrote ourselves.',
] as const;

const MARGIN = '  ';
const MEASURE = 64;

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line === '') line = word;
    else if ([...line].length + 1 + [...word].length <= width) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

export function disclaimer(columns: number): string[] {
  const width = Math.max(1, Math.min(MEASURE, columns - MARGIN.length));
  const out: string[] = [];
  DISCLAIMER.forEach((paragraph, index) => {
    if (index > 0) out.push('');
    // A word longer than the measure still gets its own line rather than a
    // cut: the claim survives a narrow terminal even when the layout does not.
    for (const line of wrap(paragraph, width)) out.push(MARGIN + line);
  });
  return out;
}

export function banner(caps: Capabilities): LockupLine[] {
  return [
    ...lockup(caps),
    { seal: '', mark: '' },
    ...disclaimer(caps.columns).map((mark) => ({ seal: '', mark })),
  ];
}
