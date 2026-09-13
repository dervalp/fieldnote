import { agentReadinessManifest } from '../../domain/grading/graders/agent-readiness';

/**
 * The five readiness checks, at twenty points each.
 *
 * The titles and the points are read from the grader's manifest, never a
 * hand-typed copy: a rubric that grows a sixth check should grow a sixth card
 * here without anyone remembering to come back and add one.
 *
 * A grader check is one criterion in a grader's rubric. A readiness check is a
 * grader check belonging to fieldnote/agent-readiness. Neither is a CI check.
 */
const WHAT_IT_LOOKS_FOR: Record<string, string> = {
  'root-agent-instructions': 'A file at the root that tells an agent how this repository works.',
  'root-readme': 'A README that says what the project is before it says how to run it.',
  'docs-markdown': 'Documentation under docs/, so there is somewhere to look that is not the code.',
  'documented-setup': 'The commands that get a working checkout, written down.',
  'documented-tests': 'The commands that verify a change — the ones an agent needs to check itself.',
};

export function RubricGrid() {
  const checks = agentReadinessManifest.checks;
  return (
    <section className="mk-section" id="rubric">
      <p className="eyebrow">The rubric</p>
      <h2>Five checks, twenty points each.</h2>
      <p className="mk-lede">
        No model decides the score. Each check is a deterministic read of the repository, and every
        failing one records the paths and line ranges that prove it — so the grade is an argument
        you can inspect, not an opinion you have to take on trust.
      </p>
      <ul className="mk-rubric">
        {checks.map((check) => (
          <li key={check.id} className="fn-stat-card">
            <span className="t">{check.points} points</span>
            <span className="v">{check.title}</span>
            <span className="s">{WHAT_IT_LOOKS_FOR[check.id]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
