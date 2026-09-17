import { eq, and, notInArray } from 'drizzle-orm';
export { assertTrackedRepository } from '../db/queries/repository-imports';
import { db } from '../db';
import { installations, repositories } from '../db/schema';
import { githubApp } from './app';
import { installationClient } from './client';
import { errorStatus } from './normalize';
export async function reconcileInstallation(githubId: string) {
  const id = `installation:${githubId}`;
  let installation;
  try {
    installation = (
      await githubApp().octokit.rest.apps.getInstallation({ installation_id: Number(githubId) })
    ).data;
  } catch (error) {
    if (errorStatus(error) !== 404) throw error;
    await db()
      .update(installations)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(installations.id, id));
    await db()
      .update(repositories)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(repositories.installationId, id));
    return [];
  }
  const account = installation.account;
  const accountLogin = account && 'login' in account ? account.login : (account?.name ?? 'unknown');
  const values = {
    id,
    githubInstallationId: githubId,
    accountLogin,
    accountType: account && 'type' in account ? account.type : 'Organization',
    active: !installation.suspended_at,
  };
  await db()
    .insert(installations)
    .values(values)
    .onConflictDoUpdate({ target: installations.id, set: { ...values, updatedAt: new Date() } });
  if (installation.suspended_at) {
    await db()
      .update(repositories)
      .set({ active: false })
      .where(eq(repositories.installationId, id));
    return [];
  }
  const client = await installationClient(githubId),
    remote = await client.paginate(client.rest.apps.listReposAccessibleToInstallation, {
      per_page: 100,
    });
  const ids: string[] = [];
  for (const repo of remote) {
    const repositoryId = `repository:${repo.id}`;
    ids.push(repositoryId);
    const row = {
      id: repositoryId,
      installationId: id,
      githubRepositoryId: String(repo.id),
      owner: repo.owner.login,
      name: repo.name,
      defaultBranch: repo.default_branch,
      isPrivate: repo.private,
      active: true,
    };
    await db()
      .insert(repositories)
      .values(row)
      .onConflictDoUpdate({ target: repositories.id, set: { ...row, updatedAt: new Date() } });
  }
  await db()
    .update(repositories)
    .set({ active: false, updatedAt: new Date() })
    .where(
      ids.length
        ? and(eq(repositories.installationId, id), notInArray(repositories.id, ids))
        : eq(repositories.installationId, id),
    );
  return ids;
}
export async function repositoryClient(repositoryId: string) {
  const [record] = await db()
    .select({ repo: repositories, installation: installations })
    .from(repositories)
    .innerJoin(installations, eq(installations.id, repositories.installationId))
    .where(eq(repositories.id, repositoryId));
  if (!record || !record.repo.active || !record.installation.active || record.repo.isDemo)
    throw new Error(`Repository unavailable: ${repositoryId}`);
  return { ...record, client: await installationClient(record.installation.githubInstallationId) };
}

// Resolves a repository row id to the numeric GitHub installation id, and
// nothing else — no active/demo checks, no installation token. Callers that
// only need to address the GitHub App installation (Act's permission check)
// should use this instead of repositoryClient, which also mints an
// installation access token they would immediately discard.
export async function repositoryInstallation(
  repositoryId: string,
): Promise<{ githubInstallationId: string } | null> {
  const [record] = await db()
    .select({ githubInstallationId: installations.githubInstallationId })
    .from(repositories)
    .innerJoin(installations, eq(installations.id, repositories.installationId))
    .where(eq(repositories.id, repositoryId));
  return record ?? null;
}
