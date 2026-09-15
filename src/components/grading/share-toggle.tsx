'use client';
import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@fieldnote/design-system';
import { setPublicGrade } from '../../app/app/repos/[repoId]/grading/actions';

/**
 * Sharing one grader's grade publicly, for one repository.
 *
 * Owners only — making something public is a bigger step than running a grade —
 * and a member sees the state rather than a control that would refuse them.
 * Turning it off keeps the link alive as `private`, so the copy says "stop
 * sharing", not "delete".
 *
 * A demo repository renders nothing at all: "Demo mode renders no switch", and
 * the member-shaped line about asking a workspace owner is a promise nobody in
 * a demo can keep.
 */
export function ShareToggle({
  repositoryId,
  graderId,
  graderTitle,
  shared,
  canShare,
  isDemo,
  isPrivate,
  pagePath,
  badgePath,
  baseUrl,
}: {
  repositoryId: string;
  graderId: string;
  graderTitle: string;
  shared: boolean;
  canShare: boolean;
  isDemo: boolean;
  isPrivate: boolean;
  pagePath: string;
  badgePath: string;
  baseUrl: string;
}) {
  const router = useRouter();
  const [error, action, pending] = useActionState(async () => {
    try {
      await setPublicGrade(repositoryId, graderId, !shared);
      router.refresh();
      return '';
    } catch {
      return 'Could not change sharing. A workspace owner can share a grade publicly.';
    }
  }, '');
  if (isDemo) return null;
  const pageUrl = `${baseUrl}${pagePath}`;
  const markdown = `[![${graderTitle}](${baseUrl}${badgePath})](${pageUrl})`;
  return (
    <div className="grade-share">
      {canShare ? (
        <form action={action}>
          <Button disabled={pending}>
            {pending ? 'Saving…' : shared ? 'Stop sharing publicly' : 'Share publicly'}
          </Button>
        </form>
      ) : (
        <p className="muted">
          {shared
            ? 'Shared publicly. A workspace owner can stop sharing it.'
            : 'Not shared. A workspace owner can share this grade publicly.'}
        </p>
      )}
      {shared && (
        <>
          <p>
            Public page: <a href={pageUrl}>{pageUrl}</a>
          </p>
          <pre className="grade-share-markdown">
            <code>{markdown}</code>
          </pre>
        </>
      )}
      {canShare && !shared && isPrivate && (
        <p className="muted">
          This repository is private. Sharing shows its score, check names and counts — never file
          names.
        </p>
      )}
      <p role="status">{error}</p>
    </div>
  );
}
