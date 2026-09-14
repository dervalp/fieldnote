'use client';

import { useEffect, useMemo, useState } from 'react';
import { GradeCard, type GradeCardProps, type GradeFinish } from '@fieldnote/design-system';

/**
 * The hero, and the only animated thing on the landing page.
 *
 * It knows nothing about grading. Every card it can show arrives precomputed
 * from climbCards() on the server, indexed by score, so the rubric — its
 * thresholds, its tier names, its next-tier arithmetic — never reaches the
 * browser. This component picks an index and plays it.
 *
 * It replaces the pointer tilt that used to live here. card-tilt.tsx said of
 * itself that if the hero's motion ever started to grow, the tilt should go
 * rather than grow with it; this is that growth, so the tilt went.
 */

/** The three beats, and the order they are earned in. */
const BEATS = ['Self-monitor.', 'Self-act.', 'Self-train.'] as const;

/**
 * The four figures are facts about the rubric, not rounded-up marketing
 * numbers: five checks at twenty points each, six finishes, one perfect score,
 * and no model anywhere in the scoring path.
 */
const PROOF = [
  { figure: '5', label: 'readiness checks' },
  { figure: '6', label: 'finishes to earn' },
  { figure: '100', label: 'a perfect score' },
  { figure: '0', label: 'LLM judges' },
] as const;

/** How long a beat spends climbing, and how long it rests before the next. */
const CLIMB_MS = 1600;
const HOLD_MS = 800;
const SETTLE_MS = 1600;

/** Ascending, so a finish's position in it is also how far the card has come. */
const FINISH_ORDER: GradeFinish[] = [
  'common',
  'shimmer',
  'bronze',
  'silver',
  'gold',
  'prismatic',
];

type Frame = { score: number; beat: number };
type Key = Frame & { at: number };

/**
 * The climb as keyframes. One entry per stop boundary, so a beat is a climb
 * followed by a rest, and the last stop holds long enough to be read.
 */
function timeline(from: number, stops: readonly number[]): Key[] {
  const keys: Key[] = [];
  let at = 0;
  let score = from;
  stops.forEach((stop, index) => {
    keys.push({ at, score, beat: index + 1 });
    at += CLIMB_MS;
    keys.push({ at, score: stop, beat: index + 1 });
    score = stop;
    if (index < stops.length - 1) at += HOLD_MS;
  });
  keys.push({ at: at + SETTLE_MS, score, beat: stops.length });
  return keys;
}

const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function frameAt(keys: Key[], ms: number): Frame {
  for (let index = 0; index < keys.length - 1; index += 1) {
    const from = keys[index];
    const to = keys[index + 1];
    if (ms <= to.at) {
      const span = to.at - from.at;
      const progress = span === 0 ? 1 : (ms - from.at) / span;
      return { score: from.score + (to.score - from.score) * easeInOut(progress), beat: from.beat };
    }
  }
  const last = keys[keys.length - 1];
  return { score: last.score, beat: last.beat };
}

export type HeroClimbProps = {
  /** Every card from `from` to 100, ascending. */
  cards: GradeCardProps[];
  /** The score the card rests on before the climb starts. */
  from: number;
  /** The score each beat ends on. One per beat, the last one being the tagline. */
  stops: readonly number[];
};

export function HeroClimb({ cards, from, stops }: HeroClimbProps) {
  // The resting frame is the first card and the first beat, and it is what
  // renders on the server. Nothing here is hidden waiting on the effect: with
  // no JavaScript the hero is a Shimmer card, all three beats and the tagline.
  const [frame, setFrame] = useState<Frame>({ score: from, beat: 1 });
  const [climbing, setClimbing] = useState(false);
  const keys = useMemo(() => timeline(from, stops), [from, stops]);

  useEffect(() => {
    const end = keys[keys.length - 1].at;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFrame({ score: stops[stops.length - 1], beat: stops.length });
      return;
    }
    setClimbing(true);
    let raf = 0;
    const started = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(end, now - started);
      const next = frameAt(keys, elapsed);
      const score = Math.round(next.score);
      // Bail out of the render when nothing the card shows has moved: the
      // score is what changes, and it changes forty times, not sixty a second.
      setFrame((previous) =>
        previous.score === score && previous.beat === next.beat
          ? previous
          : { score, beat: next.beat },
      );
      if (elapsed < end) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [keys, stops]);

  const card = cards[Math.min(cards.length - 1, Math.max(0, frame.score - from))];

  // Crossing a threshold has to restart a CSS animation on elements this
  // component does not own. Alternating the attribute alternates the
  // animation-name in marketing.css, which is what restarts it — the finish
  // only ever moves up, so its position in FINISH_ORDER alternates parity on
  // every crossing and nothing has to be tracked across renders.
  const tier = FINISH_ORDER.indexOf(card.finish) % 2;

  return (
    <section className="mk-hero">
      <div className="mk-hero-copy">
        <p className="eyebrow">Agent readiness, graded out of 100</p>
        <h1>Get your ultimate harness.</h1>
        <ol className="mk-beats">
          {BEATS.map((beat, index) => (
            <li
              key={beat}
              data-state={
                index + 1 < frame.beat ? 'done' : index + 1 === frame.beat ? 'active' : 'todo'
              }
            >
              {beat}
            </li>
          ))}
        </ol>
        <p className="mk-lede">
          Your coding agents are only as good as the repository you hand them. If nothing says how
          to build it, test it, or find the thing it needs to change, an agent will guess — and CI
          turning green will not tell you that it guessed wrong.
        </p>
        <p className="mk-lede">
          fieldnote grades the repository itself, out of 100, on the five things an agent needs
          before it can work unaided. Every failing check names the files and line ranges that prove
          it.
        </p>
        <div className="mk-cta">
          <a className="fn-button fn-button-lg" href="/api/auth/login">
            Try it now
          </a>
          <a className="fn-button fn-button-lg fn-button-secondary" href="/api/auth/login">
            Continue with GitHub
          </a>
        </div>
        <dl className="mk-proof">
          {PROOF.map((item) => (
            <div key={item.label}>
              <dt>{item.figure}</dt>
              <dd>{item.label}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="mk-hero-card" data-tier={tier} data-climbing={climbing ? 'true' : 'false'}>
        <GradeCard {...card} />
      </div>
    </section>
  );
}
