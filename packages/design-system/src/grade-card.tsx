import { useId, type CSSProperties } from 'react';
import './grade-card.css';

/**
 * The six foils a grade card can be issued in.
 *
 * The package declares this union itself rather than importing it — it cannot
 * reach into src/. `src/components/grading/grade-presentation.ts` pins the two
 * together at both type level and runtime, so they cannot drift apart in
 * silence.
 *
 * The identifier is `prismatic`, which is also the name a reader sees: it
 * arrives spelled out as `finishName`. The identifier used to be `rainbow`
 * while the card said Prismatic; the grader contract settled on one word.
 */
export type GradeFinish = 'common' | 'shimmer' | 'bronze' | 'silver' | 'gold' | 'prismatic';

export type GradeMove = { id: string; title: string; points: number };

export type GradeNextTier = {
  targetScore: number;
  targetFinish: string;
  moves: GradeMove[];
};

export type GradeCardProps = {
  score: number;
  finish: GradeFinish;
  label: string;
  color: string;
  symbol: 'circle' | 'star';
  count: number;
  finishName: string;
  flavour: string;
  next: GradeNextTier | null;
  repositoryName: string;
  rubricVersion: string;
  sha: string;
};

/**
 * Presentational only. It derives nothing: every threshold, tier name, flavour
 * line and next-tier move is decided in src/domain/grading and arrives here as
 * a prop. That is what lets the product and the marketing page render the same
 * card — and what makes a marketing card claiming an impossible tier a
 * typecheck failure rather than a thing someone notices later.
 */
export function GradeCard({
  score,
  finish,
  label,
  color,
  symbol,
  count,
  finishName,
  flavour,
  next,
  repositoryName,
  rubricVersion,
  sha,
}: GradeCardProps) {
  // Two cards on one page must not share a gradient id, and the landing page
  // renders two.
  const gradient = useId();
  return (
    <section
      className="grade-card"
      data-finish={finish}
      style={{ '--grade': color } as CSSProperties}
      aria-label={`Agent readiness: ${score} out of 100, ${label}`}
    >
      <div className="grade-card-inner">
        <div className="grade-card-heading">
          <span>{repositoryName}</span>
          <span className="grade-card-symbols" aria-hidden="true">
            {Array.from({ length: count }, (_, i) => (
              <svg
                key={i}
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill={finish === 'prismatic' ? `url(#${gradient})` : 'currentColor'}
              >
                <defs>
                  <linearGradient id={i === 0 ? gradient : `${gradient}-${i}`}>
                    <stop stopColor="#a45aa7" />
                    <stop offset=".5" stopColor="#489aaf" />
                    <stop offset="1" stopColor="#a77322" />
                  </linearGradient>
                </defs>
                {symbol === 'circle' ? (
                  <circle cx="12" cy="12" r="7" />
                ) : (
                  <path d="m12 1 3.4 7 7.6 1.1-5.5 5.4 1.3 7.6-6.8-3.6-6.8 3.6 1.3-7.6L1 9.1 8.6 8z" />
                )}
              </svg>
            ))}
          </span>
        </div>
        <h2>Agent Readiness</h2>
        <div className="grade-card-scoreline">
          <div className="grade-card-score">
            {score}
            <small> / 100</small>
          </div>
          <span className="grade-card-rating">{label}</span>
        </div>
        <div className="grade-card-scale" aria-label="Grade thresholds: 0, 50, 70, 80, 90, 100">
          <i />
          <i />
          <i />
          <i />
          <i />
          <svg
            className="grade-card-pointer"
            style={{ left: `${score}%` }}
            width="14"
            height="12"
            viewBox="0 0 14 12"
            aria-hidden="true"
          >
            <path fill="currentColor" d="M0 0h14L7 10z" />
          </svg>
        </div>
        <div className="grade-card-scale-labels" aria-hidden="true">
          {[0, 50, 70, 80, 90, 100].map((n) => (
            <span key={n} style={{ left: `${n}%` }}>
              {n}
            </span>
          ))}
        </div>
        <p className="grade-card-finish">{finishName}</p>
        <p className="grade-card-flavour">{flavour}</p>
        {next ? (
          <div className="grade-card-move">
            <div className="grade-card-move-top">
              <span>Next tier</span>
              <b>
                {next.targetFinish} at {next.targetScore}
              </b>
            </div>
            <ul>
              {next.moves.map((move) => (
                <li key={move.id}>
                  <em>{move.title}</em>
                  <span>+{move.points}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="grade-card-no-move">No higher tier.</p>
        )}
        <div className="grade-card-rubric">
          <span>Rubric</span>
          <strong>Readiness v{rubricVersion}</strong>
        </div>
        <p className="grade-card-commit">Commit {sha.slice(0, 7)}</p>
      </div>
    </section>
  );
}
