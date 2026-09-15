import { Surface } from '@fieldnote/design-system';
import { reviewQueue } from '../../../../db/queries/grader-publishing';
import { consentSentences } from '../../../../domain/grading/needs-consent';
import { SettingsForm } from '../../../../components/settings-form';
import { verifyGraderVersion, withdrawGraderVersionAsStaff } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Grader review queue' };

// Staff only: reviewQueue() itself calls requireStaff() and throws
// Next.js's notFound() sentinel for anyone else, which this page does not
// catch — the queue does not advertise that it exists.
export default async function AdminGraders() {
  const queue = await reviewQueue();

  return (
    <>
      <div className="eyebrow">Staff review</div>
      <h1>Grader review queue</h1>
      <p className="page-intro">
        Every published version nobody at fieldnote has read yet. Marking one verified records
        that a person read it — not that it is correct.
      </p>
      {queue.length === 0 && <p>Nothing waiting for review.</p>}
      {queue.map((entry) => (
        <Surface className="settings-panel" key={`${entry.graderId}@${entry.version}`}>
          <h2>{entry.manifest.card.title}</h2>
          <p className="fine">
            {entry.graderId} · v{entry.version} · published by {entry.author} on{' '}
            {entry.publishedAt.toISOString().slice(0, 10)}
          </p>
          <p>{entry.manifest.card.tagline}</p>
          <h3>Checks</h3>
          <ul>
            {entry.manifest.checks.map((check) => (
              <li key={check.id}>
                <strong>{check.title}</strong> · {check.points} pts
                <p className="fine">{check.explain.pass}</p>
                <p className="fine">{check.explain.fail}</p>
              </li>
            ))}
          </ul>
          <h3>This grader will be allowed to read</h3>
          <ul>
            {consentSentences(entry.manifest.needs).map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
          <SettingsForm action={verifyGraderVersion} submitLabel="Mark verified">
            <input type="hidden" name="graderId" value={entry.graderId} />
            <input type="hidden" name="version" value={entry.version} />
          </SettingsForm>
          <SettingsForm action={withdrawGraderVersionAsStaff} submitLabel="Withdraw">
            <input type="hidden" name="graderId" value={entry.graderId} />
            <input type="hidden" name="version" value={entry.version} />
            <label htmlFor={`withdraw-note-${entry.graderId}-${entry.version}`}>
              Reason for {entry.graderId}@{entry.version}
            </label>
            <input
              id={`withdraw-note-${entry.graderId}-${entry.version}`}
              name="note"
              required
            />
          </SettingsForm>
        </Surface>
      ))}
    </>
  );
}
