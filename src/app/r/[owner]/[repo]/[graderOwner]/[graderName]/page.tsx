import type { Metadata } from 'next';
import Link from 'next/link';
import { GradeCard, Surface } from '@fieldnote/design-system';
import { publicGrade } from '../../../../../../db/queries/public-grades';
import type { PublicGradeView } from '../../../../../../domain/grading/public-grade';
import { gradeCardProps } from '../../../../../../components/grading/grade-presentation';
import { GradeReport } from '../../../../../../components/grading/report-view';
import './public-grade.css';

export const dynamic = 'force-dynamic';

type Params = Promise<{ owner: string; repo: string; graderOwner: string; graderName: string }>;

async function view(params: Params): Promise<PublicGradeView> {
  const { owner, repo, graderOwner, graderName } = await params;
  return publicGrade(owner, repo, `${graderOwner}/${graderName}`);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const resolved = await view(params);
  // A private page says nothing and is not indexed — including nothing about
  // the address that was asked for.
  if (resolved.state === 'private')
    return { title: 'Private grade', robots: { index: false, follow: false } };
  return {
    title: `${resolved.grader.title} · ${resolved.repository.owner}/${resolved.repository.name}`,
    description: `${resolved.grader.title}, graded by fieldnote.`,
  };
}

export default async function PublicGrade({ params }: { params: Params }) {
  const resolved = await view(params);
  return (
    <main id="main-content" className="public-grade">
      {resolved.state === 'private' ? (
        <Surface className="public-grade-private">
          <h1>This grade is private.</h1>
          <p>Nobody has shared this grade publicly, or it does not exist.</p>
        </Surface>
      ) : resolved.state === 'ungraded' ? (
        <Surface>
          <h1>{resolved.grader.title}</h1>
          <p>Not graded yet.</p>
        </Surface>
      ) : (
        <>
          <GradeCard
            {...gradeCardProps({
              score: resolved.grade.score,
              repositoryName: `${resolved.repository.owner} / ${resolved.repository.name}`,
              sha: resolved.grade.sha,
              rubricVersion: resolved.grade.rubricVersion,
              checks: resolved.grade.checks,
              graderId: resolved.grader.id,
            })}
          />
          {resolved.stale && (
            <p className="public-grade-stale">
              This grade is more than 30 days old and has not been re-checked since.
            </p>
          )}
          <GradeReport
            grade={resolved.grade}
            owner={resolved.repository.owner}
            name={resolved.repository.name}
            checkTitles={resolved.grader.checkTitles}
            graderTitle={resolved.grader.title}
            disclaimer={resolved.grader.disclaimer}
            outdated={
              resolved.grade.rubricVersion !== resolved.grader.version ||
              resolved.grade.evaluatorVersion !== resolved.grader.evaluatorVersion
            }
          />
        </>
      )}
      <p className="public-grade-footer">
        <Link href="/">Graded by fieldnote</Link>
      </p>
    </main>
  );
}
