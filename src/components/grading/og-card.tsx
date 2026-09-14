import { gradePresentation } from '../../domain/grading/presentation';
import type { PublicGradeView } from '../../domain/grading/public-grade';

/**
 * The image a pasted link shows in Slack or X. The card and nothing else: no
 * check, no file name, and for a private view nothing about the address that
 * was asked for.
 *
 * Every element sets `display: flex` because satori — the renderer behind
 * ImageResponse — supports no other layout for a container with children.
 */
export function OgCard({ view }: { view: PublicGradeView }) {
  const row = { display: 'flex', flexDirection: 'column' as const, gap: '16px' };
  const frame = {
    display: 'flex',
    width: '100%',
    height: '100%',
    padding: '64px',
    background: '#faf7f0',
    color: '#1f2933',
    fontSize: '40px',
    alignItems: 'center',
    justifyContent: 'space-between',
  };
  if (view.state === 'private')
    return (
      <div style={frame}>
        <div style={row}>
          <div style={{ display: 'flex', fontSize: '64px' }}>fieldnote</div>
          <div style={{ display: 'flex' }}>A private grade.</div>
        </div>
      </div>
    );
  const headline =
    view.state === 'ungraded'
      ? 'Not graded yet'
      : view.stale
        ? 'stale'
        : `${view.grade.score} · ${gradePresentation(view.grade.score).label}`;
  const colour =
    view.state === 'graded' && !view.stale ? gradePresentation(view.grade.score).color : '#6b7280';
  return (
    <div style={frame}>
      <div style={row}>
        <div style={{ display: 'flex', fontSize: '32px', color: '#6b7280' }}>
          {view.repository.owner}/{view.repository.name}
        </div>
        <div style={{ display: 'flex', fontSize: '64px' }}>{view.grader.title}</div>
        <div style={{ display: 'flex', fontSize: '32px', color: '#6b7280' }}>fieldnote</div>
      </div>
      <div style={{ display: 'flex', fontSize: '96px', color: colour }}>{headline}</div>
    </div>
  );
}
