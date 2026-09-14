import type { GradeCardProps } from '@fieldnote/design-system';
import type { CheckResult } from '../../domain/grading/types';
import { gradeCardProps } from '../grading/grade-presentation';
import { AGENT_READINESS } from '../../domain/grading/graders/agent-readiness';
import { ladderLine } from './ladder-copy';

/**
 * The scores the landing page illustrates the six finishes with.
 *
 * Defined once, ascending, and mapped through the rubric rather than typed out
 * as a table of names and colours. A marketing page that hand-writes "Gold,
 * #a77a13, three stars" is a second copy of the rubric that nobody tests, and
 * it goes stale the first time a threshold moves.
 */
export const LADDER_SCORES = [32, 61, 74, 84, 95, 100] as const;

/** The hero card: Gold, one move short of Prismatic. */
export const HERO_SCORE = 95;

/** Where the hero's climb rests before it starts: Mediocre, a Shimmer card. */
export const CLIMB_FROM = 61;

/**
 * The score each hero beat ends on. One beat, one finish — Self-monitor takes
 * Bronze, Self-act takes Silver, Self-train takes Gold, and the tagline
 * collects Prismatic. These are LADDER_SCORES from Shimmer up, so the hero and
 * the tier ladder below it tell the same story with the same numbers, and the
 * Self-train stop is HERO_SCORE itself.
 */
export const CLIMB_STOPS = [74, 84, 95, 100] as const;

const SAMPLE_REPOSITORY = 'your-org / your-repo';
const SAMPLE_SHA = '6b1f0a4c9d2e73815a0c4f6d8b3e12907c5a4d6e';
const RUBRIC_VERSION = '0.1.0';

/**
 * The five checks, in the order a repository tends to earn them. The ids are
 * the rubric's own; checkTitles turns them into the words the card shows.
 */
const CHECK_IDS = [
  'root-agent-instructions',
  'root-readme',
  'docs-markdown',
  'documented-setup',
  'documented-tests',
] as const;

const failing = (id: string, maxPoints: number): CheckResult => ({
  id,
  points: 0,
  maxPoints,
  status: 'fail',
  paths: [],
  lineRanges: [],
  explanation: '',
});

/**
 * The checks a repository `remaining` points short of perfect still has open.
 *
 * Whole checks are worth twenty and the remainder becomes one partial check,
 * because a single failing check worth 39 would describe a rubric this product
 * does not have. The tail of CHECK_IDS fails first: agent instructions are
 * what a repository earns soonest, validation commands what it earns last.
 */
function failingFor(remaining: number): CheckResult[] {
  if (remaining <= 0) return [];
  const whole = Math.min(CHECK_IDS.length, Math.floor(remaining / 20));
  const rest = remaining % 20;
  const open = CHECK_IDS.slice(CHECK_IDS.length - whole).map((id) => failing(id, 20));
  if (rest > 0 && open.length < CHECK_IDS.length) {
    open.unshift(failing(CHECK_IDS[CHECK_IDS.length - open.length - 1], rest));
  }
  return open;
}

/**
 * A sample card at a given score. `remaining` is how many points are still on
 * the table, which is what gives the card its "next tier" block — the hero
 * needs one so the page has something to sell.
 */
export function sampleCard(score: number, remaining = 0): GradeCardProps {
  const card = gradeCardProps({
    score,
    repositoryName: SAMPLE_REPOSITORY,
    sha: SAMPLE_SHA,
    rubricVersion: RUBRIC_VERSION,
    checks: failingFor(remaining),
    graderId: AGENT_READINESS,
  });
  // The product card shows the grader's one tagline. The ladder is selling
  // the six finishes, so it swaps in a line per band — marketing's own copy,
  // deliberately not the grader's and deliberately not in the domain.
  return { ...card, flavour: ladderLine(card.finish) };
}

/** The hero's Gold card, with Prismatic at 100 still unclaimed above it. */
export const heroCard = (): GradeCardProps => sampleCard(HERO_SCORE, 100 - HERO_SCORE);

/** The ladder, ascending, one rung per finish. */
export const ladderCards = (): GradeCardProps[] => LADDER_SCORES.map((score) => sampleCard(score));

/**
 * Every card the hero's climb passes through, CLIMB_FROM to 100, indexed by
 * `score - CLIMB_FROM`.
 *
 * Resolved here, on the server, rather than in the client component that plays
 * them. The beats cross their thresholds mid-climb — 70 falls inside the run
 * from 61 to 74 — so the card has to know its finish at every intermediate
 * score, not only at the four stops. Precomputing the whole run is what lets
 * the browser receive a list of forty prop bags and no rubric at all: no
 * thresholds, no gradePresentation, no nextTier. grade-presentation.ts is
 * still the one seam between the grading domain and the design system, and it
 * stays on this side of the network.
 */
export function climbCards(): GradeCardProps[] {
  const cards: GradeCardProps[] = [];
  for (let score = CLIMB_FROM; score <= 100; score += 1) {
    cards.push(sampleCard(score, 100 - score));
  }
  return cards;
}
