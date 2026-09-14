import { Surface } from '@fieldnote/design-system';
import type { CompletedGrade } from '../../db/queries/grade-runs';
import { rangeEnd } from '../dashboard/range-query';
import './report.css';

/**
 * The evidence list, split out of report.tsx so it is a server component.
 * GradeReport reads no state, no effect and no router, and the public page is
 * the one route with no session: rendering it from the `'use client'` module
 * beside it would ship an anonymous visitor the polling client and a server
 * action reference for an action it can never call.
 */
export function GradeReport({
  grade,
  owner,
  name,
  outdated,
  checkTitles,
  graderTitle,
  disclaimer,
}: {
  // Omit<…, 'id'>: the public page builds its own narrow grade with no run id,
  // and this component never reads one.
  grade: Omit<CompletedGrade, 'id'>;
  owner: string;
  name: string;
  outdated: boolean;
  checkTitles: Record<string, string>;
  graderTitle: string;
  disclaimer: string;
}) {
  const base = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/blob/${encodeURIComponent(grade.sha)}/`;
  const scored = grade.score !== null;
  return (
    <Surface className="grading-report" aria-label={`${graderTitle} evidence`}>
      <div className="eyebrow">Foundations / Evidence</div>
      <h2>A record you can inspect.</h2>
      {outdated && (
        <p>
          Historical rubric — this report uses an earlier rubric or evaluator. Run the grader for a
          current assessment.
        </p>
      )}
      {!scored && grade.incompleteReason && (
        <p className="grading-unscored">{grade.incompleteReason}</p>
      )}
      {grade.checks.map((check) => (
        <article className="grading-check" key={check.id}>
          <h3>
            <span>{checkTitles[check.id] ?? check.id}</span>
            <span>
              {check.status === 'pass' ? 'Pass' : 'Missing'}
              {scored && ` · ${check.points} / ${check.maxPoints}`}
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
          {graderTitle} v{grade.rubricVersion} · Evaluator {grade.evaluatorVersion}
          <br />
          Completed{' '}
          <time dateTime={new Date(grade.computedAt).toISOString()}>
            {new Date(grade.computedAt).toISOString().replace('T', ' ').replace('.000Z', ' UTC')}
          </time>
          <br />
          Commit <code>{grade.sha}</code>
          {grade.window && (
            <>
              <br />
              Window <time dateTime={grade.window.start}>{grade.window.start.slice(0, 10)}</time>
              {' – '}
              <time dateTime={grade.window.endExclusive}>{rangeEnd(grade.window)}</time> (
              {grade.window.days} days)
            </>
          )}
        </p>
        <p>{disclaimer}</p>
      </div>
    </Surface>
  );
}
