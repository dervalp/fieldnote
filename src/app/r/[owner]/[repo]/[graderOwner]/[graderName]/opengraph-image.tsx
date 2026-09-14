import { ImageResponse } from 'next/og';
import { publicGrade } from '../../../../../../db/queries/public-grades';
import { OgCard } from '../../../../../../components/grading/og-card';

// The page and the badge beside it both pin this, and all three must revoke on
// the same terms: Next caches an opengraph-image route unless a request-time
// API or a dynamic config option says otherwise, and it cannot see a Drizzle
// query. Cached, a revoked share would keep serving a scored card.
export const dynamic = 'force-dynamic';

export const alt = 'A grade, by fieldnote';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({
  params,
}: {
  params: Promise<{ owner: string; repo: string; graderOwner: string; graderName: string }>;
}) {
  const { owner, repo, graderOwner, graderName } = await params;
  const view = await publicGrade(owner, repo, `${graderOwner}/${graderName}`);
  return new ImageResponse(<OgCard view={view} />, size);
}
