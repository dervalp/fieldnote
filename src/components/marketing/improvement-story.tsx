import { GradeCard } from '@fieldnote/design-system';
import { demoFacts, demoPolicy } from '../../demo/fixtures';
import { analyzePullRequest } from '../../domain/pull-request/analyzer';
import { sampleCard } from './sample-grades';
import { StoryCarousel } from './story-carousel';

export function AgentWalkthrough() {
  return (
    <div className="mk-story-wash" id="how">
      <section className="mk-story-section mk-agent-section" aria-labelledby="agent-title">
        <p className="eyebrow">01 / The next run starts here</p>
        <h2 id="agent-title">Less guessing. More getting it done.</h2>
        <StoryCarousel
          label="An agent's next run"
          labels={['Stuck', 'Missing context', 'Ready to run']}
          slides={[
            <div className="mk-terminal" key="stuck">
              <div className="mk-terminal-bar">
                <span>● ● ● &nbsp; acme / checkout</span>
                <span>Illustrative</span>
              </div>
              <div className="mk-terminal-body">
                <p className="mk-terminal-label">01 / Agent run</p>
                <h3>Another attempt. Same missing context.</h3>
                <div className="mk-terminal-log">
                  <p>$ npm test</p>
                  <p className="mk-terminal-error">npm error Missing script: &quot;test&quot;</p>
                  <p className="mk-terminal-muted">agent › Looking for another way to verify…</p>
                  <p>$ rg &apos;test|vitest|jest&apos; package.json docs/</p>
                  <p className="mk-terminal-muted">
                    agent › Searching files. Rebuilding context.{' '}
                    <i className="mk-terminal-cursor" aria-hidden="true" />
                  </p>
                </div>
                <p className="mk-terminal-result">Retry 02 · 3.2k tokens in this example</p>
                <div className="mk-terminal-footer">
                  <span>Same task. More discovery.</span>
                  <span>Simulated terminal</span>
                </div>
              </div>
            </div>,
            <div className="mk-terminal" key="context">
              <div className="mk-terminal-bar">
                <span>● ● ● &nbsp; acme / checkout</span>
                <span>Illustrative</span>
              </div>
              <div className="mk-terminal-body">
                <p className="mk-terminal-label">02 / Readiness evidence</p>
                <h3>The next step shouldn’t be a guess.</h3>
                <div className="mk-terminal-log">
                  <p className="mk-terminal-muted">fieldnote › Inspecting repository guidance</p>
                  <p className="mk-terminal-success">✓ Root agent instructions found</p>
                  <p className="mk-terminal-error">× No documented test commands found</p>
                  <p className="mk-terminal-muted">Searched: README.md, AGENTS.md, docs/</p>
                </div>
                <p className="mk-terminal-result">Next change → document the test command</p>
                <div className="mk-terminal-footer">
                  <span>A concrete readiness gap</span>
                  <span>Illustrative evidence</span>
                </div>
              </div>
            </div>,
            <div className="mk-terminal" key="ready">
              <div className="mk-terminal-bar">
                <span>● ● ● &nbsp; acme / checkout</span>
                <span>Illustrative</span>
              </div>
              <div className="mk-terminal-body">
                <p className="mk-terminal-label">03 / Guidance in place</p>
                <h3>Start with the command, not the search.</h3>
                <div className="mk-terminal-log">
                  <p className="mk-terminal-muted">README.md / Testing</p>
                  <p className="mk-terminal-success">+ Run: pnpm exec vitest run</p>
                  <p className="mk-terminal-muted">agent › Read project testing instructions</p>
                  <p>$ pnpm exec vitest run</p>
                  <p className="mk-terminal-success">RUN &nbsp; Starting test suite…</p>
                </div>
                <p className="mk-terminal-result">Readiness ✓ documented commands found</p>
                <div className="mk-terminal-footer">
                  <span>Guidance found, not a guaranteed pass</span>
                  <span>Simulated next run</span>
                </div>
              </div>
            </div>,
          ]}
        />
      </section>
    </div>
  );
}

export function PullRequestStory() {
  const { metrics } = analyzePullRequest(demoFacts(3), demoPolicy);
  const verdict = (value: boolean | null) => (value === null ? 'Unknown' : value ? 'Yes' : 'No');
  return (
    <div className="mk-story-dark" id="evidence">
      <section className="mk-story-section" aria-labelledby="evidence-title">
        <div className="mk-story-heading">
          <div>
            <p className="eyebrow">02 / Look past the green check</p>
            <h2 id="evidence-title">
              CI went green.
              <br />
              What changed?
            </h2>
          </div>
          <p>
            Follow the revisions behind the result. See when a test or other harness file changed
            after a failure.
          </p>
        </div>
        <StoryCarousel
          label="Pull request revision history"
          variant="timeline"
          labels={['CI fails', 'The test changes', 'CI passes']}
          slides={[
            <div className="mk-story-verdict" key="failed">
              <p className="eyebrow">Revision 01 / First evaluation</p>
              <h3>The first CI run failed.</h3>
              <p>Start with the sequence, not just the final status.</p>
            </div>,
            <div className="mk-story-verdict" key="changed">
              <p className="eyebrow">Revision 02 / Later revision</p>
              <h3>A test file changed after failure.</h3>
              <p>
                <code>tests/checkout.spec.ts</code> changed before the first green state.
              </p>
            </div>,
            <div className="mk-story-verdict" key="verdict">
              <p className="eyebrow">Verdict / Full sequence</p>
              <h3>Green. Still worth a closer look.</h3>
              <dl>
                <div>
                  <dt>Harness changed after failure</dt>
                  <dd>{verdict(metrics.harnessChangedAfterFailure)}</dd>
                </div>
                <div>
                  <dt>Clean Green</dt>
                  <dd>{verdict(metrics.cleanGreen)}</dd>
                </div>
              </dl>
            </div>,
          ]}
        />
        <p className="mk-story-note">Worked example · demo-pr-4 · “Update checkout harness”</p>
        <p className="mk-story-note">
          A harness change is a reason to inspect the evidence. It does not, by itself, prove the
          change was wrong.
        </p>
      </section>
    </div>
  );
}

export function GradeProgress() {
  return (
    <section
      className="mk-story-section mk-story-progress"
      id="progress"
      aria-labelledby="progress-title"
    >
      <p className="eyebrow">03 / Make the progress tangible</p>
      <h2 id="progress-title">
        A grade you can
        <br />
        trace to a commit.
      </h2>
      <p>
        Inspect the checks behind your card, make a change, and grade again. Each result has a
        reason.
      </p>
      <div className="mk-progress-cards">
        <div className="mk-progress-before">
          <span className="eyebrow">Before / Example</span>
          <h3>
            A gap
            <br />
            to close.
          </h3>
          <p>
            Test commands
            <br />
            not documented.
          </p>
          <span aria-hidden="true">○ ○ ○</span>
        </div>
        <div className="mk-progress-change">
          <code>README.md</code>
          <span aria-hidden="true">→</span>
          <small>+ documented tests</small>
        </div>
        <div className="mk-progress-after">
          <GradeCard {...sampleCard(100)} repositoryName="Illustrative / after" />
        </div>
      </div>
      <p className="mk-story-note">
        Illustrative progression. Readiness measures repository evidence, not guaranteed agent
        performance.
      </p>
    </section>
  );
}

export function EvidenceTrust() {
  return (
    <section className="mk-story-section mk-story-trust" id="rubric" aria-labelledby="trust-title">
      <div>
        <p className="eyebrow">04 / Trust you can inspect</p>
        <h2 id="trust-title">
          Evidence behind
          <br />
          every number.
        </h2>
        <p>
          You shouldn’t need to take a score on faith. See what was evaluated and how the result was
          produced.
        </p>
      </div>
      <div className="mk-trust-items">
        <div>
          <h3>See how you were graded.</h3>
          <p>Inspect the rubric, the evidence, and the reasoning behind each result.</p>
        </div>
        <div>
          <h3>A rubric you can read.</h3>
          <p>Understand what passes, what fails, and what each check is worth.</p>
        </div>
        <div>
          <h3>Unknown stays unknown.</h3>
          <p>Missing evidence is never quietly counted as success or failure.</p>
        </div>
      </div>
    </section>
  );
}
