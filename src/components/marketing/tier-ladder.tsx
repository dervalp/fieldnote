import { ladderCards } from './sample-grades';

/**
 * The six finishes, ascending.
 *
 * Every rung is derived by putting its score through the rubric, so the ladder
 * cannot advertise a tier the grader is incapable of issuing. The names are
 * the domain's own.
 *
 * The line under each rung is marketing's, not the grader's: a grader supplies
 * one tagline, and the ladder is selling six bands. See ladder-copy.ts.
 */
export function TierLadder() {
  const rungs = ladderCards();
  return (
    <section className="mk-section" id="ladder">
      <p className="eyebrow">Six finishes</p>
      <h2>A card your repository earns.</h2>
      <p className="mk-lede">
        The card is reissued on every graded commit. That is the honest difference between this and
        a badge you add once and never look at again — a repository that stops being workable stops
        holding its finish.
      </p>
      <ol className="mk-ladder">
        {rungs.map((rung) => (
          <li key={rung.finish} className="mk-rung" data-finish={rung.finish}>
            <span className="mk-rung-score" style={{ color: rung.color }}>
              {rung.score}
            </span>
            <span className="mk-rung-name">{rung.finishName.split(' · ')[0]}</span>
            <span className="mk-rung-rating">{rung.label}</span>
            <span className="mk-rung-symbols" aria-hidden="true" style={{ color: rung.color }}>
              {Array.from({ length: rung.count }, (_, i) => (
                <svg key={i} width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  {rung.symbol === 'circle' ? (
                    <circle cx="12" cy="12" r="7" />
                  ) : (
                    <path d="m12 1 3.4 7 7.6 1.1-5.5 5.4 1.3 7.6-6.8-3.6-6.8 3.6 1.3-7.6L1 9.1 8.6 8z" />
                  )}
                </svg>
              ))}
            </span>
            <span className="mk-rung-flavour">{rung.flavour}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
