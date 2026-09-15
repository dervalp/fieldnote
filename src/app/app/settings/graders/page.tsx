import Link from 'next/link';
import { Surface } from '@fieldnote/design-system';
import { requireWorkspace } from '../../../../workspaces/access';
import { workspaceGraders, type PublishedVersion } from '../../../../db/queries/grader-publishing';
import { browsableGraders, installedGraders, type BrowsableGrader } from '../../../../db/queries/graders';
import { SettingsForm } from '../../../../components/settings-form';
import { ConsentScreen } from '../../../../components/grading/consent';
import {
  publishGraderVersion,
  withdrawGraderVersion,
  installGraderVersion,
  updateGraderInstall,
  uninstallGraderVersion,
} from './actions';
import { accountSettingsPath, workspaceSettingsPath } from '../../../../lib/app-routes';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Graders' };

function stateLabel(entry: Pick<PublishedVersion, 'verifiedAt' | 'withdrawnAt'>): string {
  if (entry.withdrawnAt) return 'Withdrawn';
  return entry.verifiedAt ? 'Reviewed' : 'Not reviewed';
}

// Shared by the browse list's installed entries and the "installed, no
// longer offered" section below — the same permission grant, the same way
// out, wherever it's found.
function UninstallForm({ graderId }: { graderId: string }) {
  return (
    <SettingsForm action={uninstallGraderVersion} submitLabel="Uninstall">
      <input type="hidden" name="graderId" value={graderId} />
      <p className="fine">
        Uninstalling also turns off this workspace&rsquo;s nightly grading and public sharing for
        this grader. Grades already produced stay.
      </p>
    </SettingsForm>
  );
}

// `?install=<graderId>@<version>` names exactly the (grader_id, version) an
// "Install" link on the browse list points at — never anything a visitor
// typed by hand into a trusted role. Looking it up again here, rather than
// trusting the query string, means a stale or tampered link resolves to
// nothing rather than to the wrong grader.
function findInstallable(browsable: BrowsableGrader[], query: string): BrowsableGrader | null {
  const at = query.lastIndexOf('@');
  if (at <= 0) return null;
  const graderId = query.slice(0, at);
  const version = query.slice(at + 1);
  return browsable.find((entry) => entry.id === graderId && entry.version === version) ?? null;
}

// Publishing is a workspace owner's job, and it happens under whatever handle
// that workspace claimed (workspace settings). Browsing and installing other
// workspaces' graders lands on this same page: the browse list links each
// uninstalled entry to this same URL with `?install=...` set, and that query
// swaps the whole page body for the consent screen instead of the list.
export default async function Graders({
  searchParams,
}: {
  searchParams?: Promise<{ install?: string }>;
} = {}) {
  const workspace = await requireWorkspace();
  const owner = workspace.role === 'owner';
  const published = await workspaceGraders();
  const browsable = await browsableGraders(workspace.id);
  // browsableGraders() only carries a grader that still has a non-withdrawn
  // version — an author who withdraws every version of a grader a workspace
  // installed makes that grader vanish from Browse entirely. A permission
  // grant this workspace cannot revoke is exactly what uninstalling exists
  // to prevent, so anything installed but no longer in `browsable` gets its
  // own entry below, uninstall form included.
  const browsableIds = new Set(browsable.map((entry) => entry.id));
  const orphanedInstalls = (await installedGraders(workspace.id)).filter(
    (entry) => !browsableIds.has(entry.manifest.id),
  );
  const search = (await searchParams) ?? {};
  // Owner-gated like the link that produces this query: a member who types
  // the URL by hand must land on the browse list, not on a permission-grant
  // screen whose own Install button would 404 for them.
  const installing = owner && search.install ? findInstallable(browsable, search.install) : null;

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
      {installing ? (
        <ConsentScreen
          manifest={installing.manifest}
          author={installing.author}
          version={installing.version}
          // Already installed (at any version) means this consent screen is
          // confirming an update, not a first install — the same screen
          // either way, because a new version may want to read more.
          action={installing.installed ? updateGraderInstall : installGraderVersion}
          mode={installing.installed ? 'update' : 'install'}
          cancelHref="/app/settings/graders"
        />
      ) : (
        <>
          <Surface className="settings-panel">
            <h2>Browse graders</h2>
            {browsable.length === 0 && <p>Nothing published yet.</p>}
            {browsable.map((entry) => (
              <div className="settings-row" key={`${entry.id}@${entry.version}`}>
                <div>
                  <strong>{entry.manifest.card.title}</strong>
                  <p className="fine">
                    {entry.id} · v{entry.version} · {entry.author} ·{' '}
                    {entry.verifiedAt ? 'Reviewed' : 'Not reviewed'}
                  </p>
                </div>
                {entry.installed ? (
                  <div>
                    <p className="fine">Installed · v{entry.installed.version}</p>
                    {entry.installed.latestVersion !== entry.installed.version && (
                      <>
                        <p className="fine">
                          Update available — version {entry.installed.latestVersion}
                        </p>
                        {owner && (
                          <Link
                            href={`/app/settings/graders?install=${encodeURIComponent(`${entry.id}@${entry.installed.latestVersion}`)}`}
                          >
                            Update
                          </Link>
                        )}
                      </>
                    )}
                    {owner && <UninstallForm graderId={entry.id} />}
                  </div>
                ) : (
                  owner && (
                    <Link
                      href={`/app/settings/graders?install=${encodeURIComponent(`${entry.id}@${entry.version}`)}`}
                    >
                      Install
                    </Link>
                  )
                )}
              </div>
            ))}
          </Surface>
          {orphanedInstalls.length > 0 && (
            <Surface className="settings-panel">
              <h2>Installed, no longer offered</h2>
              {orphanedInstalls.map((entry) => (
                <div className="settings-row" key={entry.manifest.id}>
                  <div>
                    <strong>{entry.manifest.card.title}</strong>
                    <p className="fine">
                      {entry.manifest.id} · v{entry.version} · Withdrawn by its author
                    </p>
                  </div>
                  {owner && <UninstallForm graderId={entry.manifest.id} />}
                </div>
              ))}
            </Surface>
          )}
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
                    immutable — withdraw it and publish a new version instead of editing it in
                    place.
                  </p>
                </>
              ) : (
                <p>
                  Claim a publishing handle in{' '}
                  <Link href={workspaceSettingsPath()}>workspace settings</Link> before you can
                  publish a grader.
                </p>
              )}
            </Surface>
          )}
        </>
      )}
    </>
  );
}
