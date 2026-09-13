'use client';
import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Surface } from '@fieldnote/design-system';
import type { CompletedGrade } from '../../db/queries/grade-runs';
import { runGrade } from '../../app/repos/[repoId]/grading/actions';
import { checkTitles } from '../../domain/grading/check-titles';
import './report.css';
type Status = { id: string; state: 'queued' | 'running' | 'complete' | 'failed' };
export function GradeControls({
  repositoryId,
  initial,
  canRun,
}: {
  repositoryId: string;
  initial: Status | null;
  canRun: boolean;
}) {
  const router = useRouter();
  const [run, setRun] = useState(initial);
  const [connection, setConnection] = useState('');
  const [result, action, pending] = useActionState(async () => {
    try {
      const next = await runGrade(repositoryId);
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
          !['queued', 'running', 'complete', 'failed'].includes(next.state)
        )
          throw new Error('Invalid status');
        setConnection('');
        if (next.state === 'complete' || next.state === 'failed') {
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
                : run?.state === 'failed'
                  ? 'Retry grader'
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
              : run?.state === 'failed'
                ? 'The grader could not finish. Your last completed report is unchanged. Try again.'
                : '')}
      </p>
    </div>
  );
}
export function GradeReport({
  grade,
  owner,
  name,
  outdated,
}: {
  grade: CompletedGrade;
  owner: string;
  name: string;
  outdated: boolean;
}) {
  const base = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/blob/${encodeURIComponent(grade.sha)}/`;
  return (
    <Surface className="grading-report" aria-label="Readiness evidence">
      <div className="eyebrow">Foundations / Evidence</div>
      <h2>A record you can inspect.</h2>
      {outdated && (
        <p>
          Historical rubric — this report uses an earlier rubric or evaluator. Run the grader for a
          current assessment.
        </p>
      )}
      {grade.checks.map((check) => (
        <article className="grading-check" key={check.id}>
          <h3>
            <span>{checkTitles[check.id] ?? check.id}</span>
            <span>
              {check.status === 'pass' ? 'Pass' : 'Missing'} · {check.points} / {check.maxPoints}
            </span>
          </h3>
          <p>{check.explanation}</p>
          {check.paths.length > 0 && (
            <details>
              <summary>
                Show pinned evidence ({check.paths.length}{' '}
                {check.paths.length === 1 ? 'file' : 'files'})
              </summary>
              <ul>
                {check.paths.map((path) => {
                  const ranges = check.lineRanges.filter((range) => range.path === path);
                  const href = base + path.split('/').map(encodeURIComponent).join('/');
                  return (
                    <li key={path}>
                      <a href={href} target="_blank" rel="noreferrer">
                        {path}
                      </a>
                      {ranges.map((range, i) => (
                        <span key={i}>
                          {' '}
                          ·{' '}
                          <a
                            href={`${href}#L${range.start}-L${range.end}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Lines {range.start}–{range.end}
                          </a>
                        </span>
                      ))}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </article>
      ))}
      <div className="grading-report-meta">
        <p>
          Readiness v{grade.rubricVersion} · Evaluator {grade.evaluatorVersion}
          <br />
          Completed{' '}
          <time dateTime={new Date(grade.computedAt).toISOString()}>
            {new Date(grade.computedAt).toISOString().replace('T', ' ').replace('.000Z', ' UTC')}
          </time>
          <br />
          Commit <code>{grade.sha}</code>
        </p>
        <p>
          This assessment checks files and documented commands. It does not execute repository code
          or certify semantic quality.
        </p>
      </div>
    </Surface>
  );
}
