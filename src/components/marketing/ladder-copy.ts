import type { GradeFinish } from '@fieldnote/design-system';

/**
 * One sentence per finish, for the landing page's ladder and the hero's climb.
 *
 * These were `src/domain/grading/flavour.ts` until graders became a contract.
 * They are not a grader's voice and never were: a grader supplies one
 * `card.tagline`, and fieldnote does not get a private slot to supply six.
 * They are an essay about what each band of agent readiness feels like, which
 * is marketing's job, so they live in marketing.
 *
 * The product card shows the manifest's tagline. This file is never read from
 * `src/domain` or from a real repository's card. If the card itself ever wants
 * a per-finish voice back, the fix is an optional `card.flavour` author slot
 * every grader can use — not a re-import of this file.
 */
const ladderCopy: Record<GradeFinish, string> = {
  common:
    'An agent will guess. There is no reliable way to build this, test it, or find the thing it needs to change.',
  shimmer: 'An agent can start, but will stop to ask questions a document should already answer.',
  bronze: 'Enough context to work from. Verifying the change still takes trial and error.',
  silver:
    'Readable, testable, navigable. An agent can find its way around and verify its own work without asking a human first.',
  gold: 'An agent can land a change unaided. Documentation and verification both hold under pressure.',
  prismatic: 'Nothing the rubric asks for is missing.',
};

export function ladderLine(finish: GradeFinish): string {
  return ladderCopy[finish];
}
