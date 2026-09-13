import Link from 'next/link';
import { Surface } from '@fieldnote/design-system';
import { accessibleRepositories } from '../../auth/access';
import { env } from '../../lib/env';
import { repositoryRecords } from '../../db/queries/repository-records';
import { readRange, rangeQuery, type RangePageProps } from '../../components/dashboard/range-query';
import { InvalidRange } from '../../components/dashboard/basic-dashboard';
import {
  githubRepositoryUrl,
  RepositoryMetadata,
} from '../../components/dashboard/repository-metadata';
import { AppShell } from '../../components/app-shell';
export const dynamic = 'force-dynamic';
export default async function Directory({ searchParams }: RangePageProps = {}) {
  const available = await accessibleRepositories();
  const demo = env().DEMO_MODE === 'true';
  const repositories = available.filter(
    (repo) => repo.trackingStartedAt !== null || (demo && repo.isDemo),
  );
  const search = (await searchParams) ?? {};
  let range;
  try {
    range = readRange(search);
  } catch (error) {
    return (
      <AppShell crumbs={[{ label: 'All repositories' }]}>
        <InvalidRange message={(error as Error).message} href="/repos" />
      </AppShell>
    );
  }
  const query = rangeQuery(range, search);
  const records = await repositoryRecords(repositories.map((repo) => repo.id));
  return (
    <AppShell crumbs={[{ label: 'All repositories' }]}>
      <div className="metrics-page">
        <div className="eyebrow">Connected work</div>
        <h1>Your repositories.</h1>
        <p className="page-intro">
          {repositories.length} accessible tracked repositories. One engineering record.
        </p>
        <div className="repository-links">
          <Link href={`/dashboard${query}`}>← Overview</Link>
          <Link href="/onboarding">Add repository ↗</Link>
        </div>
        {repositories.map((repo) => (
          <Surface className="directory-repository" key={repo.id}>
            <div className="repository-heading">
              <h2>
                <Link href={`/repos/${encodeURIComponent(repo.id)}${query}`}>
                  {repo.owner}/{repo.name} ↗
                </Link>
              </h2>
              <a href={githubRepositoryUrl(repo)}>GitHub ↗</a>
            </div>
            <RepositoryMetadata
              record={records.find((record) => record.repositoryId === repo.id)!}
              githubUrl={githubRepositoryUrl(repo)}
            />
          </Surface>
        ))}
        {!repositories.length && (
          <p>
            No accessible tracked repositories. Add a repository to begin collecting PR evidence.
          </p>
        )}
      </div>
    </AppShell>
  );
}
