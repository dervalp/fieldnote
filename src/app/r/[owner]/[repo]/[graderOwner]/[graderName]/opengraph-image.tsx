import { ImageResponse } from 'next/og';
import { publicGrade } from '../../../../../../db/queries/public-grades';
import { OgCard } from '../../../../../../components/grading/og-card';

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
