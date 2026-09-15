import Link from 'next/link';
import { Surface } from '@fieldnote/design-system';
import { requireWorkspace } from '../../../../workspaces/access';
import { workspaceGraders, type PublishedVersion } from '../../../../db/queries/grader-publishing';
import { SettingsForm } from '../../../../components/settings-form';
import { publishGraderVersion, withdrawGraderVersion } from './actions';
import { accountSettingsPath, workspaceSettingsPath } from '../../../../lib/app-routes';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Graders' };

function stateLabel(entry: Pick<PublishedVersion, 'verifiedAt' | 'withdrawnAt'>): string {
  if (entry.withdrawnAt) return 'Withdrawn';
  return entry.verifiedAt ? 'Reviewed' : 'Not reviewed';
}

// Publishing is a workspace owner's job, and it happens under whatever handle
// that workspace claimed (workspace settings). Browsing and installing other
// workspaces' graders lands on this same page in task 9 — this slice only
// carries what a workspace published and the form that adds to it.
export default async function Graders() {
  const workspace = await requireWorkspace();
  const owner = workspace.role === 'owner';
  const published = await workspaceGraders();
  return (
    <>
      <div className="eyebrow">Grader registry</div>
      <h1>Graders</h1>
      <p className="page-intro">
        Publish graders other workspaces can install, and see what {workspace.name} has already
        shared.
      </p>
      <div className="settings-tabs">
        <Link href={accountSettingsPath()}>Account</Link>
        <Link href={workspaceSettingsPath()}>Workspace</Link>
        <Link aria-current="page" href="/app/settings/graders">
          Graders
        </Link>
        <span className={owner ? 'owner-badge' : 'member-badge'}>{owner ? 'Owner' : 'Member'}</span>
      </div>
      <Surface className="settings-panel">
        <h2>Published by this workspace</h2>
        {published.length === 0 && <p>Nothing published yet.</p>}
        {published.map((entry) => (
          <div className="settings-row" key={`${entry.graderId}@${entry.version}`}>
            <div>
              <strong>{entry.title}</strong>
              <p className="fine">
                {entry.graderId} · v{entry.version} · {stateLabel(entry)}
              </p>
            </div>
            {owner && !entry.withdrawnAt && (
              <SettingsForm action={withdrawGraderVersion} submitLabel="Withdraw">
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
            )}
          </div>
        ))}
      </Surface>
      {owner && (
        <Surface className="settings-panel">
          <h2>Publish a grader</h2>
          {workspace.handle ? (
            <>
              <SettingsForm action={publishGraderVersion} submitLabel="Publish">
                <label htmlFor="manifest">Grader manifest (JSON)</label>
                <textarea id="manifest" name="manifest" required rows={16} />
              </SettingsForm>
              <p className="fine">
                Publishes under <code>{workspace.handle}/…</code>. A published version is
                immutable — withdraw it and publish a new version instead of editing it in place.
              </p>
            </>
          ) : (
            <p>
              Claim a publishing handle in{' '}
              <Link href={workspaceSettingsPath()}>workspace settings</Link> before you can publish
              a grader.
            </p>
          )}
        </Surface>
      )}
    </>
  );
}
