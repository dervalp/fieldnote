export function Signup() {
  return (
    <section className="mk-section mk-signup" id="self-host">
      <p className="eyebrow">Start with your repository</p>
      <h2>Find your next improvement.</h2>
      <p className="mk-lede">
        Connect a repository to inspect its readiness checks and pull-request history.
      </p>
      <div className="mk-cta">
        <a className="fn-button fn-button-lg" href="/api/auth/login">
          Connect with GitHub
        </a>
      </div>
      <p className="mk-footnote">Sign in → Select a repository → Review after import</p>
      <p className="mk-footnote">
        Or run it yourself. fieldnote is AGPL-3.0: the whole thing is in the repository, including
        the grader, the rubric and the seeded demo — no GitHub App required to try it.
      </p>
    </section>
  );
}
