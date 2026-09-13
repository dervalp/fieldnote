import Link from 'next/link';
import { redirect } from 'next/navigation';
import { env } from '../../../lib/env';
import { needsOnboarding } from '../../../domain/import/onboarding';
import { accessibleRepositories } from '../../../auth/access';
import { loadBasicDashboard } from '../../../db/queries/basic-dashboard';
import { BasicDashboard, InvalidRange } from '../../../components/dashboard/basic-dashboard';
import { readRange, rangeQuery, type RangePageProps } from '../../../components/dashboard/range-query';
export const dynamic = 'force-dynamic';
export default async function Dashboard({ searchParams }: RangePageProps = {}) {
  const available = await accessibleRepositories();
  const demo = env().DEMO_MODE === 'true';
  if (needsOnboarding(available, demo)) redirect('/onboarding');
  const repositories = available.filter(
    (repo) => repo.trackingStartedAt !== null || (demo && repo.isDemo),
  );
  const search = (await searchParams) ?? {};
  let range;
  try {
    range = readRange(search);
  } catch (error) {
    return <InvalidRange message={(error as Error).message} href="/dashboard" />;
  }
  const data = await loadBasicDashboard(
    repositories.map((repo) => repo.id),
    range,
  );
  return (
    <div className="metrics-page">
      <div className="eyebrow">Your engineering record</div>
      <h1>Good work compounds.</h1>
      <p className="page-intro">
        A shared view of progress across {repositories.length} accessible repositories.
      </p>
      <Link href={`/repos${rangeQuery(range, search)}`}>View repositories ↗</Link>
      <BasicDashboard data={data} />
    </div>
  );
}
