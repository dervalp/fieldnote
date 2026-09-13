import { expect, test } from 'vitest';
import { sectionsWithFencedBlock } from './markdown-sections';
import type { SourceDocument } from './types';

const doc = (text: string): SourceDocument => ({ path: 'README.md', blobSha: 'sha', text });
const setup = new Set(['setup', 'install', 'installation', 'getting started']);

test('a heading followed by a nonempty fence yields a range from heading to closing fence', () => {
  const ranges = sectionsWithFencedBlock(
    doc(['# Project', '## Installation', '```sh', 'pnpm install', '```'].join('\n')),
    setup,
  );
  expect(ranges).toEqual([{ path: 'README.md', blobSha: 'sha', start: 2, end: 5 }]);
});

test('tilde fences close only on tildes of at least the opening length', () => {
  const ranges = sectionsWithFencedBlock(
    doc(['## Setup', '~~~~sh', '```', 'pnpm install', '~~~', '~~~~'].join('\n')),
    setup,
  );
  expect(ranges).toEqual([{ path: 'README.md', blobSha: 'sha', start: 1, end: 6 }]);
});

test('a heading inside a fence does not start a section', () => {
  expect(
    sectionsWithFencedBlock(
      doc(['```md', '## Setup', '```sh', 'pnpm install', '```', '```'].join('\n')),
      setup,
    ),
  ).toEqual([]);
});

test('an empty fence body does not satisfy a heading, and a later section cannot rescue it', () => {
  expect(
    sectionsWithFencedBlock(
      doc(
        ['## Setup', '```sh', '   ', '```', '## Notes', '```sh', 'pnpm install', '```'].join('\n'),
      ),
      setup,
    ),
  ).toEqual([]);
});

test('a deeper heading stays inside the candidate section; a same-or-shallower one closes it', () => {
  expect(
    sectionsWithFencedBlock(
      doc(['## Getting Started', '### Shell', '```', 'pnpm dev', '```'].join('\n')),
      setup,
    ),
  ).toHaveLength(1);
  expect(
    sectionsWithFencedBlock(
      doc(['## Setup', '## Notes', '```', 'pnpm dev', '```'].join('\n')),
      setup,
    ),
  ).toEqual([]);
});

test('headings are matched case-insensitively with trailing hashes stripped', () => {
  expect(
    sectionsWithFencedBlock(doc(['## SETUP ##', '```', 'x', '```'].join('\n')), setup),
  ).toHaveLength(1);
});
