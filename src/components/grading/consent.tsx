import { Surface } from '@fieldnote/design-system';
import { consentSentences } from '../../domain/grading/needs-consent';
import { SettingsForm } from '../settings-form';
import { GraderStateLine } from './grader-state';
import type { GraderManifest } from '../../domain/grading/manifest';

/**
 * What a grader may read, in the grader's own declaration and fieldnote's
 * words. Every sentence is generated from `needs` — an author never describes
 * their own permissions — and the collector enforces the same declaration at
 * grading time, so this screen and the runtime cannot drift.
 */
export function ConsentScreen({
  manifest,
  author,
  version,
  action,
  cancelHref,
  mode = 'install',
  verifiedAt = null,
  withdrawnAt = null,
}: {
  manifest: GraderManifest;
  author: string;
  version: string;
  action: (form: FormData) => Promise<{ error?: string }>;
  cancelHref: string;
  // The page reuses this same screen to confirm an update, not just a first
  // install — a new version may want to read more, so it re-asks the same
  // way. 'install' is the default so every existing caller says what it
  // always said.
  mode?: 'install' | 'update';
  // A reviewer reads exactly what a customer is shown here: the same
  // verified/withdrawn/not-reviewed line as everywhere else a grader is
  // named, beneath the author.
  verifiedAt?: Date | null;
  withdrawnAt?: Date | null;
}) {
  const verb = mode === 'update' ? 'Update' : 'Install';
  return (
    <Surface className="grader-consent">
      <h2>
        {verb} {manifest.card.title}
      </h2>
      <p>
        {author} · version {version}
      </p>
      <GraderStateLine verifiedAt={verifiedAt} withdrawnAt={withdrawnAt} />
      <p>{manifest.card.tagline}</p>
      <h3>This grader will be allowed to read</h3>
      <ul>
        {consentSentences(manifest.needs).map((sentence) => (
          <li key={sentence}>{sentence}</li>
        ))}
      </ul>
      <p>Nothing else is collected. It runs against every repository in this workspace.</p>
      {/* SettingsForm runs the action through useActionState and renders a
          failure — "That version is no longer available to install.", say —
          as a role="alert" paragraph. A bare <form action={action}> would
          discard the Result and leave a failed install looking identical to
          a successful one; installGraderVersion redirects on success, so
          this screen never re-renders itself either way. */}
      <SettingsForm action={action} submitLabel={verb}>
        <input type="hidden" name="graderId" value={manifest.id} />
        <input type="hidden" name="version" value={version} />
      </SettingsForm>
      <a href={cancelHref}>Cancel</a>
    </Surface>
  );
}
