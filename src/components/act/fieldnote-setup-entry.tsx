import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button, Surface } from '@fieldnote/design-system';
import { requestFieldnoteSetup } from '../../app/app/repos/[repoId]/grading/actions';
import type { InstallationState } from '../../domain/fieldnote-skills/types';
import type { SetupProgress } from '../../db/queries/fieldnote-setup';
import { actRunPath } from '../../lib/app-routes';
import type { HumanReason } from '../../domain/act/pr-monitor';

const progressCopy: Record<SetupProgress['state'], string> = {
  exploring: 'Exploring the repository',
  'awaiting-input': 'Waiting for your answer',
  preparing: 'Preparing the setup pull request',
  open: 'Monitoring the setup pull request',
  stopped: 'Automatic setup repairs stopped. Human action is required.',
  verifying: 'Verifying the installation',
  failed: 'The setup could not finish. Resume the conversation to review its progress.',
  closed:
    'The setup pull request was closed without merging. Fieldnote has not been installed by this pull request.',
};
const stopCopy: Record<HumanReason, string> = {
  ambiguous: 'Review the feedback and resolve it in the pull request.',
  permission_loss: 'Restore GitHub App write access, then finish or close the pull request.',
  repair_limit:
    'Three automatic repair rounds have been used. Finish the remaining changes in the pull request.',
  secret:
    'The requested change needs credentials. Handle it outside the setup conversation and do not paste secrets here.',
  destructive: 'The requested change needs a human decision. Review it in the pull request.',
  head_changed:
    'The pull request branch changed outside automatic repair. Review and finish the changes in the pull request.',
  invalid_repair:
    'Automatic repair could not validate a safe change. Review and finish the changes in the pull request.',
  repair_failed:
    'Automatic repair could not finish. Review the failure and finish the changes in the pull request.',
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
          {progress.state === 'stopped' && (
            <p>{stopCopy[progress.monitorReason ?? 'invalid_repair']}</p>
          )}
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
            {installation.kind === 'outdated' && (
              <p>Fieldnote Skills {version(installation.installed)} installed</p>
            )}
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
