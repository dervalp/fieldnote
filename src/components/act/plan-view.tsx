import type { AuthoringRun, Remedy } from '../../db/queries/authoring-runs';

export function PlanView({
  run,
  remedies,
  checkTitles,
}: {
  run: AuthoringRun;
  remedies: Remedy[];
  checkTitles: Record<string, string>;
}) {
  if (run.state !== 'complete')
    return (
      <section>
        <h2>No plan yet.</h2>
        <p>
          This run is {run.state}
          {run.errorCode ? ` (${run.errorCode})` : ''}.
        </p>
      </section>
    );
  return (
    <section>
      <ul className="plan-remedies">
        {remedies.map((remedy) => (
          <li key={remedy.id}>
            <label>
              {/* Disabled on purpose: selecting and approving remedies is not
                  built yet, and a checkbox that silently does nothing when
                  clicked is worse than one that shows it cannot be used. */}
              <input type="checkbox" disabled />
              <code>{remedy.path}</code> — {checkTitles[remedy.checkId] ?? remedy.checkId}
            </label>
            <p className="muted">{remedy.rationale}</p>
          </li>
        ))}
      </ul>
      <p className="muted">
        Planned at {run.sha?.slice(0, 7)} ·{' '}
        {run.model
          ? `Written by ${run.model}`
          : 'No model wrote this plan — it was derived from the grade.'}
      </p>
    </section>
  );
}
