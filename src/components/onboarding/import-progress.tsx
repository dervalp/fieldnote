'use client';
import Link from 'next/link';
import { Button, Surface } from '@fieldnote/design-system';
import { useActionState, useEffect, useRef } from 'react';
import type { ImportSnapshot, StartResult } from '../../domain/import/types';
import { retryAnalysis } from '../../app/onboarding/actions';
import { useImportStatus } from './use-import-status';
import { progressPercent } from './polling';
export function ImportProgress({
  initial,
  repository,
  canAdmin,
  focusOnMount = false,
}: {
  initial: ImportSnapshot;
  repository: { id: string; owner: string; name: string };
  canAdmin: boolean;
  focusOnMount?: boolean;
}) {
  const [result, retry, pending] = useActionState<StartResult, FormData>(
    async () => retryAnalysis(repository.id, initial.id),
    {},
  );
  const run = result.run ?? initial;
  return result.run && result.run.id !== initial.id ? (
    <ImportProgress
      key={run.id}
      initial={run}
      repository={repository}
      canAdmin={canAdmin}
      focusOnMount
    />
  ) : (
    <ProgressContent
      key={run.id}
      initial={run}
      repository={repository}
      canAdmin={canAdmin}
      retry={retry}
      pending={pending}
      error={result.error}
      focusOnMount={focusOnMount}
    />
  );
}
function ProgressContent({
  initial,
  repository,
  canAdmin,
  retry,
  pending,
  error,
  focusOnMount,
}: {
  initial: ImportSnapshot;
  repository: { id: string; owner: string; name: string };
  canAdmin: boolean;
  retry: (form: FormData) => void;
  pending: boolean;
  error?: string;
  focusOnMount: boolean;
}) {
  const { snapshot: run, connection } = useImportStatus(initial);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnMount) heading.current?.focus({ preventScroll: true });
    if (window.location.pathname === '/onboarding') {
      const query = new URLSearchParams(window.location.search);
      query.set('repo', repository.id);
      query.set('run', initial.id);
      window.history.replaceState(null, '', `?${query.toString()}`);
    }
  }, [initial.id, repository.id, focusOnMount]);
  const href = `/repos/${encodeURIComponent(repository.id)}`;
  const percent =
    run.state === 'queued' || run.state === 'discovering' ? null : progressPercent(run);
  const copy =
    run.state === 'queued'
      ? 'Your import is queued.'
      : run.state === 'discovering'
        ? 'Finding your latest 100 pull requests.'
        : run.state === 'importing'
          ? `${run.completed} of ${run.total ?? 'an unknown number of'} PRs imported.`
          : run.state === 'complete'
            ? run.total === 0
              ? 'No pull requests yet.'
              : 'Your engineering record is ready.'
            : run.state === 'partial'
              ? `${run.completed} PRs imported. ${run.failed} PRs could not be imported.`
              : 'Your import could not finish.';
  const milestone = Math.floor(run.completed / 10) * 10;
  const announcement =
    run.state === 'importing' ? `Importing pull requests. ${milestone} PRs imported.` : copy;
  return (
    <Surface className="onboarding-panel import-panel" aria-label="Import progress">
      <div className="eyebrow">First engineering record</div>
      <h2 ref={heading} tabIndex={-1}>
        {copy}
      </h2>
      <p className="onboarding-sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {run.state === 'complete' && (
        <span className="import-complete-mark" aria-hidden="true">
          ✓
        </span>
      )}
      {percent !== null && (
        <>
          <progress
            className="onboarding-sr-only"
            aria-label="Pull requests imported"
            max={100}
            value={percent}
          />
          <div className="import-progress-track" aria-hidden="true">
            <div className="import-progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <p className="muted">
            {run.completed} of {run.total} PRs imported
          </p>
        </>
      )}
      {run.state === 'importing' && (
        <p className="muted">
          Each PR includes its CI history. Some requests may take longer while requests to GitHub
          are retried.
        </p>
      )}
      {run.failed > 0 && run.state !== 'partial' && <p>{run.failed} PRs could not be imported.</p>}
      {run.state === 'failed' && (
        <p>{run.message || 'Try again to continue importing your repository.'}</p>
      )}
      {run.state === 'complete' && run.total === 0 && (
        <p>New pull request activity will be updated as it arrives.</p>
      )}
      {run.state === 'complete' && run.total !== 0 && (
        <p>
          Imported batch: {run.total ?? 'unknown'} PRs. Initial import: latest 100 pull requests by
          creation date. New activity is updated as it arrives.
        </p>
      )}
      {connection === 'reconnecting' && <p role="status">Reconnecting to import status</p>}
      {connection === 'signed-out' && (
        <p role="status">
          Your session has ended. <a href="/api/auth/login">Sign in to continue</a>
        </p>
      )}
      {connection === 'unavailable' && (
        <p role="status">
          This repository is no longer available. <Link href="/dashboard">Back to overview</Link>
        </p>
      )}
      <div className="onboarding-actions">
        {connection !== 'unavailable' &&
          connection !== 'signed-out' &&
          (run.state === 'complete' || run.state === 'partial') && (
            <Link href={href}>
              {run.state === 'partial'
                ? 'View imported PRs'
                : run.total === 0
                  ? 'View repository'
                  : 'View engineering record'}
            </Link>
          )}
        {canAdmin &&
          (run.state === 'partial' || run.state === 'failed') &&
          connection !== 'unavailable' &&
          connection !== 'signed-out' && (
            <form action={retry}>
              <Button disabled={pending}>
                {pending
                  ? 'Requesting retry…'
                  : run.state === 'partial'
                    ? 'Retry failed PRs'
                    : 'Retry import'}
              </Button>
            </form>
          )}
      </div>
      {error && <p role="alert">{error}</p>}
    </Surface>
  );
}
