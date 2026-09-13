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
