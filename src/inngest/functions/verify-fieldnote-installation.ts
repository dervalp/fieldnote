import { NonRetriableError } from 'inngest';
import { inngest } from '../client';
import { fieldnoteInstallationVerifyData } from '../events';
import {
  loadInstallationVerification,
  recordVerifiedInstallation,
} from '../../db/queries/fieldnote-installations';
import { validateAuthoringRun } from '../../db/queries/authoring-runs';
import { AuthoringAccessRevokedError } from '../../domain/act/authorization';
import { fetchGrantedPermissions } from '../../github/installation-permissions';
import { readSkillsRelease, latestSkillsReleaseTag } from '../../fieldnote-skills/github-release';
import {
  collectInstallationSnapshot,
  verifyFieldnoteInstallation,
  InstallationVerificationError,
} from '../../github/verify-fieldnote-installation';

export const verifyFieldnoteInstallationFunction = inngest.createFunction(
  {
    id: 'verify-fieldnote-installation',
    triggers: [{ event: 'repository/fieldnote.installation.verify.requested' }],
    retries: 3,
    concurrency: { limit: 1, key: 'event.data.authoredPrId' },
  },
  async ({ event, step }) => {
    const { authoredPrId } = fieldnoteInstallationVerifyData.parse(event.data);
    return step.run('verify-and-record', async () => {
      try {
        const context = await loadInstallationVerification(authoredPrId);
        if (!context || context.pr.outcome !== 'merged') return null;
        const authorize = async () => {
          await validateAuthoringRun(context.run);
          const permissions = await fetchGrantedPermissions(context.run.repositoryId);
          if (permissions.contents !== 'write' || permissions.pullRequests !== 'write')
            throw new InstallationVerificationError('access_unavailable');
        };
        await authorize();
        const release = await readSkillsRelease(context.proposal.skillsRelease);
        if (
          release.revision !== context.proposal.skillsRevision ||
          release.releaseLockHash !== context.proposal.releaseLockHash
        )
          throw new InstallationVerificationError('verification_unavailable');
        const latest = await latestSkillsReleaseTag();
        const snapshot = await collectInstallationSnapshot(
          context.pr.repositoryId,
          context.pr.number,
          context.configurationPaths,
        );
        const observation = verifyFieldnoteInstallation(snapshot, release, {
          setupRunId: context.run.id,
          agents: context.proposal.confirmedAgents ?? [],
          configurationPaths: context.configurationPaths,
          latest,
        });
        await authorize();
        await recordVerifiedInstallation(authoredPrId, observation);
        return { state: observation.state, commitSha: observation.commitSha };
      } catch (error) {
        if (
          error instanceof AuthoringAccessRevokedError ||
          (error instanceof InstallationVerificationError && !error.retryable)
        )
          throw new NonRetriableError('Installation access unavailable');
        if (error instanceof InstallationVerificationError) throw error;
        throw new InstallationVerificationError('verification_unavailable');
      }
    });
  },
);
