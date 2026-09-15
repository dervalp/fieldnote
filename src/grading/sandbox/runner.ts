// fieldnote's half of what runs in the box. It reads the evidence, calls the
// program's default export, and prints the answer. A thrown error exits
// non-zero with nothing on stdout.
export const RUNNER_SOURCE = `import { readFileSync } from 'node:fs';
const input = JSON.parse(readFileSync(new URL('./input.json', import.meta.url), 'utf8'));
const { default: grade } = await import('./grader.mjs');
const answer = await grade(input.evidence);
process.stdout.write(JSON.stringify(answer) ?? '');
`;

/**
 * The same command in every adapter, so the filesystem, write and process
 * locks are properties of the command rather than of a vendor: with
 * --permission set and nothing else allowed, Node refuses every read outside
 * the box directory, every write, child processes, workers, addons and the
 * inspector. Node 24's permission model has no network switch; that lock is
 * the substrate's.
 */
export function graderCommand(root: string): string[] {
  return ['node', '--permission', `--allow-fs-read=${root}`, `${root}/run.mjs`];
}
