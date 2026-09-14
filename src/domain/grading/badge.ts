import { gradePresentation } from './presentation';
import type { PublicGradeView } from './public-grade';

// Not a finish colour: a neutral badge means "no number to show", which is a
// different statement from a low score.
const NEUTRAL = '#6b7280';

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );

// Verdana at 11px averages a little over six pixels a character. Close enough
// for a pill nobody measures, and it needs no font metrics at request time.
const width = (text: string) => Math.round(text.length * 6.5) + 20;

/**
 * What the two halves say. A private view echoes nothing from the address it
 * was asked about — not the repository, not the grader — so every unshared
 * address renders the same bytes.
 */
export function badgeParts(view: PublicGradeView): { left: string; right: string; color: string } {
  if (view.state === 'private') return { left: 'fieldnote', right: 'private', color: NEUTRAL };
  if (view.state === 'ungraded')
    return { left: view.grader.title, right: 'not graded', color: NEUTRAL };
  if (view.stale) return { left: view.grader.title, right: 'stale', color: NEUTRAL };
  const presentation = gradePresentation(view.grade.score);
  return {
    left: view.grader.title,
    right: `${view.grade.score} · ${presentation.label}`,
    color: presentation.color,
  };
}

/**
 * The README pill: a score and a finish, never a failing check. Evidence
 * requires the click, which is the rule slice 1 recorded and the reason this
 * function never reads `grade.checks`.
 */
export function renderBadge(view: PublicGradeView): string {
  const { left, right, color } = badgeParts(view);
  const leftWidth = width(left);
  const rightWidth = width(right);
  const label = `${left}: ${right}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${leftWidth + rightWidth}" height="20" role="img" aria-label="${escape(label)}">` +
    `<title>${escape(label)}</title>` +
    `<rect width="${leftWidth}" height="20" fill="#3c4450"/>` +
    `<rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${color}"/>` +
    `<g fill="#ffffff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">` +
    `<text x="${leftWidth / 2}" y="14">${escape(left)}</text>` +
    `<text x="${leftWidth + rightWidth / 2}" y="14">${escape(right)}</text>` +
    `</g></svg>`
  );
}
