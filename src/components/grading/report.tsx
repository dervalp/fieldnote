'use client';
import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@fieldnote/design-system';
import { runGrade } from '../../app/app/repos/[repoId]/grading/actions';
// The evidence list moved to report-view.tsx, a server component; this
// stylesheet still dresses the controls below, so it stays imported here too.
import './report.css';
type Status = {
  id: string;
  state: 'queued' | 'running' | 'complete' | 'failed' | 'insufficient';
  errorCode?: string | null;
};
export function GradeControls({
  repositoryId,
  graderId,
  initial,
  canRun,
}: {
  repositoryId: string;
  graderId: string;
  initial: Status | null;
  canRun: boolean;
}) {
  const router = useRouter();
  const [run, setRun] = useState(initial);
  const [connection, setConnection] = useState('');
  const [result, action, pending] = useActionState(async () => {
    try {
      const next = await runGrade(repositoryId, graderId);
      setConnection('');
      setRun({ id: next.runId, state: 'queued' });
      return '';
    } catch {
      return 'Could not start the grader. Check your repository access and try again.';
    }
  }, '');
  useEffect(() => {
    setRun(initial);
  }, [initial?.id, initial?.state]); // Sync refreshed server status.
  useEffect(() => {
    if (!run || !['queued', 'running'].includes(run.state)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const response = await fetch(
          `/api/repos/${encodeURIComponent(repositoryId)}/grades/${encodeURIComponent(run!.id)}`,
          { cache: 'no-store', signal: controller.signal },
        );
        if (stopped) return;
        if (response.status === 401 || response.status === 404) {
          setConnection(
            response.status === 401
              ? 'Your session has ended. Sign in again to continue.'
              : 'This repository or grade is no longer available.',
          );
          return;
        }
        if (!response.ok) throw new Error('Unavailable');
        const next: Status = await response.json();
        if (
          next.id !== run!.id ||
          !['queued', 'running', 'complete', 'failed', 'insufficient'].includes(next.state)
        )
          throw new Error('Invalid status');
        setConnection('');
        if (next.state === 'complete' || next.state === 'failed' || next.state === 'insufficient') {
          setRun(next);
          router.refresh();
          return;
        }
        setRun(next);
      } catch {
        if (stopped) return;
        setConnection(
          'Reconnecting to grader status. Your last completed report is still available.',
        );
      }
      if (!stopped) timer = setTimeout(poll, 2500);
    }
    timer = setTimeout(poll, 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [repositoryId, run?.id, run?.state, router]);
  const active = run?.state === 'queued' || run?.state === 'running';
  return (
    <div className="grading-controls">
      {canRun ? (
        <form action={action}>
          <Button disabled={pending || active}>
            {pending
              ? 'Requesting…'
              : active
                ? 'Grader in progress…'
                : run?.state === 'failed' || run?.state === 'insufficient'
                  ? 'Run grader again'
                  : 'Run grader'}
          </Button>
        </form>
      ) : (
        <p className="muted">
          Demo reports are read-only. A connected workspace member can run the grader.
        </p>
      )}
      <p role="status">
        {connection ||
          result ||
          (run?.state === 'queued'
            ? 'Queued. Waiting to collect repository evidence.'
            : run?.state === 'running'
              ? 'Collecting and checking evidence at a pinned commit.'
              : run?.state === 'insufficient'
                ? 'There was not enough evidence to score this run. The measurements below are still worth reading.'
                : run?.state === 'failed'
                  ? run.errorCode === 'insufficient_evidence'
                    ? 'There is not enough record in this window to score. Try again once more work has merged.'
                    : run.errorCode === 'sandbox_unavailable'
                      ? 'Grading is temporarily unavailable. Try again later.'
                      : run.errorCode === 'consent_required'
                        ? 'This grader now asks to read more than this workspace agreed to. A workspace owner can review it in settings.'
                        : 'The grader could not finish. Your last completed report is unchanged. Try again.'
                  : '')}
      </p>
    </div>
  );
}
