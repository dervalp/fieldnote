import { publicGrade } from '../../../../../../../db/queries/public-grades';
import { renderBadge } from '../../../../../../../domain/grading/badge';

export const dynamic = 'force-dynamic';

/**
 * The README pill. Always 200, always an SVG, always the same cache policy:
 * a private answer that looked different from a shared one — a 404, a shorter
 * cache — would let anyone enumerate which repositories fieldnote grades.
 *
 * Five minutes is the compromise the design names: GitHub proxies README
 * images, so a busy README must not reach the database on every view, and the
 * cost is that revoking sharing takes up to that long to reach a cached badge.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ owner: string; repo: string; graderOwner: string; graderName: string }> },
) {
  const { owner, repo, graderOwner, graderName } = await params;
  const view = await publicGrade(owner, repo, `${graderOwner}/${graderName}`);
  return new Response(renderBadge(view), {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
