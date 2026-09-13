import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The package is presentational. It fetches nothing, reads no session, knows
// nothing about a pull request, and — the part this file exists to hold — it
// imports nothing from the app. That is what makes "shared with the website"
// survive the website moving: a package that reaches back into src/ is a
// directory with extra steps.
//
// These guards run against the files on disk rather than against the module
// graph on purpose. A type-only import from src/ disappears at runtime and
// would pass any import-time check while still coupling the two.

const here = import.meta.dirname;

function filesUnder(dir: string, extensions: string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path, extensions));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(path);
  }
  return found;
}

const IMPORT_SPECIFIER = /(?:from|import)\s*['"]([^'"]+)['"]/g;

function specifiersIn(source: string): string[] {
  return [...source.matchAll(IMPORT_SPECIFIER)].map((match) => match[1]);
}

describe('@fieldnote/design-system', () => {
  const sources = filesUnder(join(here, 'src'), ['.ts', '.tsx']);

  it('has source files to check, so a passing run means something', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each(sources)('%s imports nothing from the app', (path) => {
    const offending = specifiersIn(readFileSync(path, 'utf8')).filter(
      (specifier) => specifier.startsWith('../../') || /(^|\/)src\//.test(specifier),
    );
    expect(offending).toEqual([]);
  });

  it.each(sources)('%s imports no framework the package has no business knowing', (path) => {
    const banned = ['next/', 'next', 'next/link', 'next/navigation'];
    const offending = specifiersIn(readFileSync(path, 'utf8')).filter((specifier) =>
      banned.includes(specifier),
    );
    expect(offending).toEqual([]);
  });

  // Colour lives in exactly one place. The documented exception is
  // grade-card.css, whose six foils are eight-to-nine stop gradients that only
  // mean anything whole — naming twenty-odd stops as tokens would be
  // bookkeeping, not a system. Every other stylesheet references a token.
  const FOIL_EXCEPTION = 'grade-card.css';

  const stylesheets = [
    ...filesUnder(join(here, 'styles'), ['.css']),
    ...filesUnder(join(here, 'src'), ['.css']),
  ].filter((path) => !path.endsWith(FOIL_EXCEPTION));

  it.each(stylesheets)('%s holds no colour literal outside the token tier', (path) => {
    const css = readFileSync(path, 'utf8');
    const literals = path.endsWith('tokens.css') ? [] : (css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []);
    expect(literals).toEqual([]);
  });

  // The same rule stated again over `styles/` alone, and stated by reading the
  // directory rather than by naming files. The list above is assembled once at
  // module load from two trees; this one re-enumerates the style tier itself,
  // so a stylesheet added to `styles/` is covered the day it lands and cannot
  // be missed by a filter written for `src/`. tokens.css is the only tier
  // allowed a literal, and it is excluded by name.
  it('holds no colour literal in styles/ outside tokens.css', () => {
    const dir = join(here, 'styles');
    const sheets = readdirSync(dir).filter(
      (entry) => entry.endsWith('.css') && entry !== 'tokens.css',
    );
    expect(sheets.length).toBeGreaterThan(0);
    const offenders = sheets.flatMap((entry) => {
      const css = readFileSync(join(dir, entry), 'utf8');
      return (css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((hex) => `${entry}: ${hex}`);
    });
    expect(offenders).toEqual([]);
  });

  it('declares its cascade layers in exactly one file', () => {
    const declaring = [...filesUnder(join(here, 'styles'), ['.css'])].filter((path) =>
      /@layer\s+[^;{]+;/.test(readFileSync(path, 'utf8')),
    );
    expect(declaring.map((path) => path.split('/').at(-1))).toEqual(['index.css']);
  });
});
