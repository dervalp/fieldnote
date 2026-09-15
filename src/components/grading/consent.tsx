import { Button, Surface } from '@fieldnote/design-system';
import { consentSentences } from '../../domain/grading/needs-consent';
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
}: {
  manifest: GraderManifest;
  author: string;
  version: string;
  action: (form: FormData) => Promise<{ error?: string }>;
  cancelHref: string;
}) {
  return (
    <Surface className="grader-consent">
      <h2>Install {manifest.card.title}</h2>
      <p>
        {author} · version {version}
      </p>
      <p>{manifest.card.tagline}</p>
      <h3>This grader will be allowed to read</h3>
      <ul>
        {consentSentences(manifest.needs).map((sentence) => (
          <li key={sentence}>{sentence}</li>
        ))}
      </ul>
      <p>Nothing else is collected. It runs against every repository in this workspace.</p>
      {/* installGraderVersion returns a Result, like every action behind
          save() — a client component reads that to show an inline error, as
          SettingsForm does. This screen has none: with no JS this is a plain
          full-page form post and the result is never read, and React's own
          typing for a bare <form action> only accepts void | Promise<void>,
          so the cast is the honest way to say that. */}
      <form action={action as unknown as (formData: FormData) => Promise<void>}>
        <input type="hidden" name="graderId" value={manifest.id} />
        <input type="hidden" name="version" value={version} />
        <Button type="submit">Install</Button>
      </form>
      <a href={cancelHref}>Cancel</a>
    </Surface>
  );
}
