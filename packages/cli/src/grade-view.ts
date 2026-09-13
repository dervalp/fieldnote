import type { GradeCheck, GradeComplete } from './api.ts';

export type Line = {
  kind: 'card' | 'pass' | 'fail' | 'partial' | 'dim' | 'head' | 'blank' | 'url';
  text: string;
};

// Everything the server computed, plus the two things only the CLI knows:
// which repository the developer is standing in, and which commit they asked
// about. Derived from GradeComplete rather than restated, so the contract
// cannot drift from the client that fetches it.
export type GradeView = GradeComplete & { slug: string; requestedSha: string };

// A grader check's own `status` is binary, but its points are not: a rubric
// with partial credit returns `pass` for a check that earned 12 of 20. Reading
// the points rather than the status is what keeps "pass" meaning "all of it".
function kindOf(check: GradeCheck): 'pass' | 'fail' | 'partial' {
  if (check.points >= check.maxPoints) return 'pass';
  if (check.points <= 0) return 'fail';
  return 'partial';
}

const short = (sha: string) => sha.slice(0, 7);

export function gradeLines(input: GradeView): Line[] {
  const lines: Line[] = [];
  const title = (check: GradeCheck) => input.titles[check.id] ?? check.id;

  lines.push({
    kind: 'head',
    text: input.gradedSha
      ? `${input.slug} · ${short(input.gradedSha)}`
      : `${input.slug} · commit unknown`,
  });
  lines.push({ kind: 'dim', text: `${input.graderId}@${input.graderVersion} · ${input.tagline}` });

  // The server grades the repository's default branch head, not the working
  // tree. Saying so is the difference between a grade and a misleading one.
  if (input.gradedSha === null)
    lines.push({
      kind: 'dim',
      text: `  This grade does not record which commit it read.`,
    });
  else if (input.gradedSha !== input.requestedSha)
    lines.push({
      kind: 'dim',
      text: `  Graded ${short(input.gradedSha)}, not the commit you are on (${short(input.requestedSha)}).`,
    });

  // The caveat belongs to the grader, not to fieldnote, and it only exists
  // because the grader is not purely deterministic. Printing it above the card
  // means nobody reads the number before they read how it was reached.
  if (input.mode !== 'deterministic') lines.push({ kind: 'dim', text: input.disclaimer });
  lines.push({ kind: 'blank', text: '' });

  if (input.score === null || input.presentation === null) {
    lines.push({ kind: 'head', text: 'No score — the evidence was incomplete.' });
    if (input.incompleteReason) lines.push({ kind: 'dim', text: input.incompleteReason });
  } else {
    lines.push({
      kind: 'card',
      text: `${input.score}/100 · ${input.presentation.label} · ${input.presentation.finish}`,
    });
  }
  lines.push({ kind: 'blank', text: '' });

  for (const check of input.checks) {
    const points = `${check.points}/${check.maxPoints}`;
    const trailer = check.paths[0] ?? check.explanation;
    lines.push({ kind: kindOf(check), text: `${title(check)}  ${points}  ${trailer}` });
  }

  if (input.nextTier) {
    lines.push({ kind: 'blank', text: '' });
    lines.push({
      kind: 'head',
      text: `Next: ${input.nextTier.targetFinish} at ${input.nextTier.targetScore}`,
    });
    for (const move of input.nextTier.moves)
      lines.push({ kind: 'dim', text: `  ${move.title}  +${move.points}` });
  }

  lines.push({ kind: 'blank', text: '' });
  lines.push({ kind: 'url', text: input.url });
  return lines;
}
