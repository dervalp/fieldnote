import { readFileSync } from 'node:fs';

// Read at call time rather than imported as JSON: the package is consumed from
// source in this workspace, and a JSON import assertion would tie the module
// to one bundler's behaviour for no benefit.
export function cliVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return pkg.version;
}
