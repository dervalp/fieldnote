import type { EvidenceLineRange, SourceDocument } from './types';

function fenceOpening(line: string): { marker: '`' | '~'; length: number } | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return undefined;
  const marker = match[1][0] as '`' | '~';
  if (marker === '`' && match[2].includes('`')) return undefined;
  return { marker, length: match[1].length };
}

function closesFence(line: string, fence: { marker: '`' | '~'; length: number }) {
  const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
  return Boolean(match && match[1][0] === fence.marker && match[1].length >= fence.length);
}

function heading(line: string): { depth: number; text: string } | undefined {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/.exec(line);
  if (!match) return undefined;
  return {
    depth: match[1].length,
    text: match[2]
      .replace(/[ \t]+#+[ \t]*$/, '')
      .trim()
      .toLowerCase(),
  };
}

/**
 * Every heading in `headings` whose section contains a fenced block with a
 * nonblank body, as a range from the heading line to the closing fence.
 *
 * Extracted unchanged from readiness-v01's documentedCommand(). It is the one
 * piece of the readiness grader that was never about readiness: nested fences,
 * tilde fences, closing-fence length and heading-depth reset are Markdown
 * facts, not rubric opinions. Named here so any declarative grader can use it.
 */
export function sectionsWithFencedBlock(
  document: SourceDocument,
  headings: ReadonlySet<string>,
): EvidenceLineRange[] {
  const lines = document.text.split(/\r?\n/);
  const ranges: EvidenceLineRange[] = [];
  let activeHeading: { depth: number; line: number } | undefined;
  let fence: { marker: '`' | '~'; length: number; hasBody: boolean } | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      if (closesFence(line, fence)) {
        if (activeHeading && fence.hasBody) {
          ranges.push({
            path: document.path,
            blobSha: document.blobSha,
            start: activeHeading.line,
            end: index + 1,
          });
          activeHeading = undefined;
        }
        fence = undefined;
      } else if (line.trim()) {
        fence.hasBody = true;
      }
      continue;
    }

    const nextHeading = heading(line);
    if (nextHeading) {
      if (activeHeading && nextHeading.depth <= activeHeading.depth) activeHeading = undefined;
      if (headings.has(nextHeading.text)) {
        activeHeading = { depth: nextHeading.depth, line: index + 1 };
      }
      continue;
    }

    const opening = fenceOpening(line);
    if (opening) fence = { ...opening, hasBody: false };
  }

  return ranges;
}
