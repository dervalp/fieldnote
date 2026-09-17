import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button, Surface } from '@fieldnote/design-system';
import { requestFieldnoteSetup } from '../../app/app/repos/[repoId]/grading/actions';
import type { InstallationState } from '../../domain/fieldnote-skills/types';
import type { SetupProgress } from '../../db/queries/fieldnote-setup';
import { actRunPath } from '../../lib/app-routes';

const progressCopy: Record<SetupProgress['state'], string> = {
  exploring: 'Exploring the repository',
  'awaiting-input': 'Waiting for your answer',
  preparing: 'Preparing the setup pull request',
  open: 'Monitoring the setup pull request',
  verifying: 'Verifying the installation',
  failed: 'The setup could not finish. Resume the conversation to review its progress.',
  closed:
    'The setup pull request was closed without merging. Fieldnote has not been installed by this pull request.',
};
const version = (release: string) => release.replace(/^skills-/, '').replace(/^(?!v)/, 'v');

export function FieldnoteSetupEntry({
  repositoryId,
  installation,
  progress,
  canStart,
  showStart = true,
  latestAvailable = true,
}: {
  repositoryId: string;
  installation: InstallationState;
  progress: SetupProgress | null;
  canStart: boolean;
  showStart?: boolean;
  latestAvailable?: boolean;
}) {
  const active = progress && progress.state !== 'failed' && progress.state !== 'closed';
  let label = 'Set up Fieldnote';
  if (installation.kind === 'outdated')
    label = installation.latest
      ? `Update Fieldnote to ${version(installation.latest)}`
      : 'Update Fieldnote';
  if (installation.kind === 'partial' || installation.kind === 'drifted')
    label = 'Repair Fieldnote setup';
  async function start() {
    'use server';
    const { runId } = await requestFieldnoteSetup(repositoryId);
    redirect(actRunPath(repositoryId, runId));
  }
  return (
    <Surface>
      <h3>Fieldnote setup</h3>
      {!latestAvailable && (
        <p className="muted">
          Unable to check for a newer Fieldnote Skills release. Showing the last verified
          installation.
        </p>
      )}
      {progress && (
        <>
          <p>{progressCopy[progress.state]}</p>
          <p>
            <Link href={actRunPath(repositoryId, progress.runId)}>
              Resume the setup conversation
            </Link>
          </p>
          {progress.pullRequestUrl && (
            <p>
              <a href={progress.pullRequestUrl}>View setup pull request</a>
            </p>
          )}
        </>
      )}
      {!active &&
        (installation.kind === 'current' ? (
          <p>Fieldnote Skills {version(installation.release)} installed</p>
        ) : installation.kind === 'proposed' ? (
          <p>
            <Link href={actRunPath(repositoryId, installation.runId)}>
              Resume the setup conversation
            </Link>
          </p>
        ) : (
          <>
            {(installation.kind === 'partial' || installation.kind === 'drifted') && (
              <ul>
                {installation.reasons.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            )}
            {showStart &&
              (canStart ? (
                <form action={start}>
                  <Button type="submit">{label}</Button>
                </form>
              ) : (
                <p>{label}. Enable Act with repository write access in settings to continue.</p>
              ))}
          </>
        ))}
    </Surface>
  );
}
