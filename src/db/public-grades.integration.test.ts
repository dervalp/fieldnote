import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDb } from './index';
import {
  installations,
  publicGrades as publicGradeRows,
  repositories,
  users,
  workspaces,
  workspaceMemberships,
  workspaceRepositories,
  gradeRuns,
} from './schema';
import { publicGradeSettings, writePublicGrade } from './queries/public-grade-settings';
import { publicGrade } from './queries/public-grades';
import { AGENT_READINESS, agentReadinessManifest } from '../domain/grading/graders/agent-readiness';
import { runDeclarative } from '../domain/grading/declarative';

// A signed-out visitor is a session that throws, which is what currentUser()
// does in the real application; requireWorkspace() calls it first.
const context = vi.hoisted(() => ({ user: '', workspace: '', demo: false }));
vi.mock('../auth/session', () => ({
  currentUser: async () => {
    if (!context.user) throw new Error('Not signed in');
    return { id: context.user };
  },
  cookieOptions: {},
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: context.workspace }) }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
}));
vi.mock('../lib/env', () => ({ env: () => ({ DEMO_MODE: context.demo ? 'true' : 'false' }) }));

const { default: PublicGradePage } = await import(
  '../app/r/[owner]/[repo]/[graderOwner]/[graderName]/page'
);
const { GET: badge } = await import(
  '../app/r/[owner]/[repo]/[graderOwner]/[graderName]/badge.svg/route'
);

const address = (owner: string, repo: string, graderId = AGENT_READINESS) => {
  const [graderOwner, graderName] = graderId.split('/');
  return Promise.resolve({ owner, repo, graderOwner, graderName });
};
const pageHtml = async (owner: string, repo: string, graderId = AGENT_READINESS) =>
  renderToStaticMarkup(await PublicGradePage({ params: address(owner, repo, graderId) }));
const badgeSvg = async (owner: string, repo: string, graderId = AGENT_READINESS) => {
  const response = await badge(new Request('https://fieldnote.dev/badge.svg'), {
    params: address(owner, repo, graderId),
  });
  return { status: response.status, body: await response.text() };
};

let owner = '';
let secondOwner = '';
let member = '';
let workspace = '';
beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
  owner = randomUUID();
  secondOwner = randomUUID();
  member = randomUUID();
  workspace = randomUUID();
  await db()
    .insert(users)
    .values([
      { id: owner, login: 'owner', credentials: 'fixture' },
      { id: secondOwner, login: 'owner-two', credentials: 'fixture' },
      { id: member, login: 'member', credentials: 'fixture' },
    ]);
  await db().insert(workspaces).values({ id: workspace, name: 'Public', defaultForUserId: owner });
  await db()
    .insert(workspaceMemberships)
    .values([
      { workspaceId: workspace, userId: owner, role: 'owner' },
      { workspaceId: workspace, userId: secondOwner, role: 'owner' },
      { workspaceId: workspace, userId: member, role: 'member' },
    ]);
});

const fixtureRepositories: string[] = [];
afterAll(async () => {
  if (fixtureRepositories.length) {
    await db()
      .delete(publicGradeRows)
      .where(inArray(publicGradeRows.repositoryId, fixtureRepositories));
    await db().delete(gradeRuns).where(inArray(gradeRuns.repositoryId, fixtureRepositories));
    await db()
      .delete(workspaceRepositories)
      .where(inArray(workspaceRepositories.repositoryId, fixtureRepositories));
    await db().delete(repositories).where(inArray(repositories.id, fixtureRepositories));
    await db().delete(installations).where(inArray(installations.id, fixtureRepositories));
  }
  // requireWorkspace() calls ensureDefaultWorkspace() for whoever the session
  // names, and secondOwner and member have no defaultForUserId of their own —
  // only the fixture "workspace" does. That call silently creates a personal
  // workspace and membership the first time either of them goes through
  // writePublicGrade(). Sweep by user id and by defaultForUserId rather than
  // just the fixture workspace id, so those rows don't survive the run and
  // trip the users foreign key below.
  await db()
    .delete(workspaceMemberships)
    .where(inArray(workspaceMemberships.userId, [owner, secondOwner, member]));
  await db()
    .delete(workspaces)
    .where(inArray(workspaces.defaultForUserId, [owner, secondOwner, member]));
  await db().delete(users).where(inArray(users.id, [owner, secondOwner, member]));
  await closeDb();
});

type RepoOptions = { isPrivate?: boolean; active?: boolean; installationActive?: boolean; isDemo?: boolean; linked?: boolean; owner?: string; name?: string };
async function fixtureRepository(options: RepoOptions = {}): Promise<string> {
  const id = randomUUID();
  fixtureRepositories.push(id);
  await db().insert(installations).values({
    id,
    githubInstallationId: id,
    accountLogin: 'test',
    accountType: 'User',
    active: options.installationActive ?? true,
  });
  await db()
    .insert(repositories)
    .values({
      id,
      installationId: id,
      githubRepositoryId: id,
      owner: options.owner ?? `owner-${id.slice(0, 8)}`,
      name: options.name ?? 'repo',
      defaultBranch: 'main',
      isPrivate: options.isPrivate ?? false,
      active: options.active ?? true,
      isDemo: options.isDemo ?? false,
    });
  if (options.linked ?? true)
    await db()
      .insert(workspaceRepositories)
      .values({ workspaceId: workspace, repositoryId: id, connectedBy: owner });
  return id;
}

beforeEach(() => {
  context.user = owner;
  context.workspace = workspace;
  context.demo = false;
});

test('an owner shares, revokes and shares again, and the row survives', async () => {
  const repositoryId = await fixtureRepository();
  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  expect(await publicGradeSettings(repositoryId)).toEqual({ [AGENT_READINESS]: { shared: true } });

  await writePublicGrade(repositoryId, AGENT_READINESS, false);
  expect(await publicGradeSettings(repositoryId)).toEqual({ [AGENT_READINESS]: { shared: false } });
  const [revoked] = await db()
    .select()
    .from(publicGradeRows)
    .where(eq(publicGradeRows.repositoryId, repositoryId));
  expect(revoked.revokedAt).toBeInstanceOf(Date);

  context.user = secondOwner;
  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  const [reshared] = await db()
    .select()
    .from(publicGradeRows)
    .where(eq(publicGradeRows.repositoryId, repositoryId));
  expect(reshared.revokedAt).toBeNull();
  expect(reshared.enabledBy).toBe(secondOwner);
});

test('a member cannot share', async () => {
  const repositoryId = await fixtureRepository();
  context.user = member;
  await expect(writePublicGrade(repositoryId, AGENT_READINESS, true)).rejects.toThrow('not found');
  expect(await db().select().from(publicGradeRows).where(eq(publicGradeRows.repositoryId, repositoryId))).toEqual([]);
});

test('a signed-out visitor cannot share', async () => {
  const repositoryId = await fixtureRepository();
  context.user = '';
  await expect(writePublicGrade(repositoryId, AGENT_READINESS, true)).rejects.toThrow();
});

test('the demo workspace cannot share', async () => {
  const repositoryId = await fixtureRepository();
  context.demo = true;
  await expect(writePublicGrade(repositoryId, AGENT_READINESS, true)).rejects.toThrow();
});

test('an unknown grader cannot be shared', async () => {
  const repositoryId = await fixtureRepository();
  await expect(writePublicGrade(repositoryId, 'nobody/nothing', true)).rejects.toThrow();
});

test('a repository the workspace is not connected to cannot be shared', async () => {
  const repositoryId = await fixtureRepository({ linked: false });
  await expect(writePublicGrade(repositoryId, AGENT_READINESS, true)).rejects.toThrow();
});

async function completedRun(
  repositoryId: string,
  options: { completedAt: Date; confirmedAt?: Date; state?: 'complete' | 'insufficient' | 'failed'; score?: number } = {
    completedAt: new Date('2026-09-01T00:00:00.000Z'),
  },
): Promise<string> {
  const id = randomUUID();
  const state = options.state ?? 'complete';
  const result = runDeclarative(agentReadinessManifest, {
    sha: 'a'.repeat(40),
    complete: state === 'complete',
    documents: [{ path: 'README.md', blobSha: 'b'.repeat(40), text: 'hello' }],
  });
  await db()
    .insert(gradeRuns)
    .values({
      id,
      repositoryId,
      graderId: AGENT_READINESS,
      rubricVersion: agentReadinessManifest.version,
      evaluatorVersion: agentReadinessManifest.evaluatorVersion,
      requestedBy: owner,
      requestedWorkspaceId: workspace,
      state,
      sha: 'a'.repeat(40),
      result: state === 'failed' ? null : result,
      completedAt: options.completedAt,
      confirmedAt: options.confirmedAt ?? null,
      createdAt: options.completedAt,
    });
  return id;
}

test('a shared, graded, public repository is readable by anyone', async () => {
  const repositoryId = await fixtureRepository({ owner: 'Acme', name: 'Widgets' });
  await completedRun(repositoryId);
  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  const view = await publicGrade('acme', 'widgets', AGENT_READINESS, new Date('2026-09-10T00:00:00.000Z'));
  expect(view.state).toBe('graded');
  if (view.state !== 'graded') throw new Error('expected a graded view');
  expect(view.repository).toEqual({ owner: 'Acme', name: 'Widgets', isPrivate: false });
  expect(view.grader.title).toBe(agentReadinessManifest.card.title);
  expect(view.stale).toBe(false);
  expect(view.grade.checks.some((check) => check.paths.includes('README.md'))).toBe(true);
});

test('a private repository shares its score and never its file names', async () => {
  const repositoryId = await fixtureRepository({ isPrivate: true });
  await completedRun(repositoryId);
  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  const [repo] = await db().select().from(repositories).where(eq(repositories.id, repositoryId));
  const view = await publicGrade(repo.owner, repo.name, AGENT_READINESS);
  if (view.state !== 'graded') throw new Error('expected a graded view');
  for (const check of view.grade.checks) {
    expect(check.paths).toEqual([]);
    expect(check.lineRanges).toEqual([]);
  }
  expect(view.grade.score).toBeGreaterThan(0);
});

test('a later unscored run does not replace the public grade', async () => {
  const repositoryId = await fixtureRepository();
  await completedRun(repositoryId, { completedAt: new Date('2026-09-01T00:00:00.000Z') });
  await completedRun(repositoryId, { completedAt: new Date('2026-09-05T00:00:00.000Z'), state: 'insufficient' });
  await completedRun(repositoryId, { completedAt: new Date('2026-09-06T00:00:00.000Z'), state: 'failed' });
  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  const [repo] = await db().select().from(repositories).where(eq(repositories.id, repositoryId));
  const view = await publicGrade(repo.owner, repo.name, AGENT_READINESS);
  if (view.state !== 'graded') throw new Error('expected a graded view');
  expect(view.grade.computedAt).toEqual(new Date('2026-09-01T00:00:00.000Z'));
});

test('staleness counts from the last confirmation', async () => {
  const completedAt = new Date('2026-09-01T00:00:00.000Z');
  const thirtyOneDays = new Date(completedAt.getTime() + 31 * 86_400_000);
  const stale = await fixtureRepository();
  await completedRun(stale, { completedAt });
  await writePublicGrade(stale, AGENT_READINESS, true);
  const [staleRepo] = await db().select().from(repositories).where(eq(repositories.id, stale));
  const staleView = await publicGrade(staleRepo.owner, staleRepo.name, AGENT_READINESS, thirtyOneDays);
  expect(staleView.state === 'graded' && staleView.stale).toBe(true);

  const confirmed = await fixtureRepository();
  await completedRun(confirmed, {
    completedAt,
    confirmedAt: new Date(completedAt.getTime() + 20 * 86_400_000),
  });
  await writePublicGrade(confirmed, AGENT_READINESS, true);
  const [freshRepo] = await db().select().from(repositories).where(eq(repositories.id, confirmed));
  const freshView = await publicGrade(freshRepo.owner, freshRepo.name, AGENT_READINESS, thirtyOneDays);
  expect(freshView.state === 'graded' && freshView.stale).toBe(false);
});

test('a shared repository that has never scored is ungraded, not private', async () => {
  const repositoryId = await fixtureRepository();
  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  const [repo] = await db().select().from(repositories).where(eq(repositories.id, repositoryId));
  expect((await publicGrade(repo.owner, repo.name, AGENT_READINESS)).state).toBe('ungraded');
});

test('every reason to refuse gives the same private answer', async () => {
  const shared = await fixtureRepository();
  await completedRun(shared);
  await writePublicGrade(shared, AGENT_READINESS, true);
  const [sharedRepo] = await db().select().from(repositories).where(eq(repositories.id, shared));

  const revoked = await fixtureRepository();
  await completedRun(revoked);
  await writePublicGrade(revoked, AGENT_READINESS, true);
  await writePublicGrade(revoked, AGENT_READINESS, false);
  const [revokedRepo] = await db().select().from(repositories).where(eq(repositories.id, revoked));

  const never = await fixtureRepository();
  const [neverRepo] = await db().select().from(repositories).where(eq(repositories.id, never));

  const inactive = await fixtureRepository({ active: false });
  const [inactiveRepo] = await db().select().from(repositories).where(eq(repositories.id, inactive));

  const uninstalled = await fixtureRepository({ installationActive: false });
  const [uninstalledRepo] = await db().select().from(repositories).where(eq(repositories.id, uninstalled));

  // writePublicGrade refuses an unconnected repository, so this row is written
  // directly: the lookup must refuse it too, not rely on the writer having.
  const unlinked = await fixtureRepository({ linked: false });
  await db()
    .insert(publicGradeRows)
    .values({ repositoryId: unlinked, graderId: AGENT_READINESS, enabledBy: owner, workspaceId: workspace });
  const [unlinkedRepo] = await db().select().from(repositories).where(eq(repositories.id, unlinked));

  const views = [
    await publicGrade('nobody', 'nothing', AGENT_READINESS),
    await publicGrade(sharedRepo.owner, 'not-this-repo', AGENT_READINESS),
    await publicGrade(sharedRepo.owner, sharedRepo.name, 'nobody/nothing'),
    await publicGrade(revokedRepo.owner, revokedRepo.name, AGENT_READINESS),
    await publicGrade(neverRepo.owner, neverRepo.name, AGENT_READINESS),
    await publicGrade(inactiveRepo.owner, inactiveRepo.name, AGENT_READINESS),
    await publicGrade(uninstalledRepo.owner, uninstalledRepo.name, AGENT_READINESS),
    await publicGrade(unlinkedRepo.owner, unlinkedRepo.name, AGENT_READINESS),
  ];
  for (const view of views) expect(view).toEqual({ state: 'private' });
});

test('demo mode shares nothing', async () => {
  const repositoryId = await fixtureRepository();
  await completedRun(repositoryId);
  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  const [repo] = await db().select().from(repositories).where(eq(repositories.id, repositoryId));
  const previous = process.env.DEMO_MODE;
  process.env.DEMO_MODE = 'true';
  try {
    expect(await publicGrade(repo.owner, repo.name, AGENT_READINESS)).toEqual({ state: 'private' });
  } finally {
    if (previous === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = previous;
  }
});

test('every private answer is byte-identical, page and badge alike', async () => {
  const revoked = await fixtureRepository();
  await completedRun(revoked);
  await writePublicGrade(revoked, AGENT_READINESS, true);
  await writePublicGrade(revoked, AGENT_READINESS, false);
  const [revokedRepo] = await db().select().from(repositories).where(eq(repositories.id, revoked));
  const never = await fixtureRepository();
  const [neverRepo] = await db().select().from(repositories).where(eq(repositories.id, never));
  const inactive = await fixtureRepository({ active: false });
  const [inactiveRepo] = await db().select().from(repositories).where(eq(repositories.id, inactive));
  const uninstalled = await fixtureRepository({ installationActive: false });
  const [uninstalledRepo] = await db()
    .select()
    .from(repositories)
    .where(eq(repositories.id, uninstalled));
  const unlinked = await fixtureRepository({ linked: false });
  await db()
    .insert(publicGradeRows)
    .values({ repositoryId: unlinked, graderId: AGENT_READINESS, enabledBy: owner, workspaceId: workspace });
  const [unlinkedRepo] = await db().select().from(repositories).where(eq(repositories.id, unlinked));

  const cases: [string, string, string?][] = [
    ['nobody', 'nothing'],
    [revokedRepo.owner, revokedRepo.name],
    [neverRepo.owner, neverRepo.name],
    [inactiveRepo.owner, inactiveRepo.name],
    [uninstalledRepo.owner, uninstalledRepo.name],
    [unlinkedRepo.owner, unlinkedRepo.name],
    [revokedRepo.owner, revokedRepo.name, 'nobody/nothing'],
  ];
  const pages = await Promise.all(cases.map(([owner, repo, grader]) => pageHtml(owner, repo, grader)));
  const badges = await Promise.all(cases.map(([owner, repo, grader]) => badgeSvg(owner, repo, grader)));
  for (const html of pages) expect(html).toBe(pages[0]);
  for (const svg of badges) expect(svg).toEqual(badges[0]);
  expect(pages[0]).toContain('This grade is private.');
  expect(badges[0].status).toBe(200);
  expect(badges[0].body).toContain('private');
});

test('sharing, revoking and sharing again is visible end to end', async () => {
  const repositoryId = await fixtureRepository();
  await completedRun(repositoryId);
  const [repo] = await db().select().from(repositories).where(eq(repositories.id, repositoryId));

  expect(await pageHtml(repo.owner, repo.name)).toContain('This grade is private.');

  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  const shared = await pageHtml(repo.owner, repo.name);
  expect(shared).toContain(agentReadinessManifest.card.title);
  expect((await badgeSvg(repo.owner, repo.name)).body).toContain('·');

  await writePublicGrade(repositoryId, AGENT_READINESS, false);
  expect(await pageHtml(repo.owner, repo.name)).toContain('This grade is private.');

  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  expect(await pageHtml(repo.owner, repo.name)).toContain(agentReadinessManifest.card.title);
});

test("a private repository's public page shows no file name", async () => {
  const repositoryId = await fixtureRepository({ isPrivate: true });
  await completedRun(repositoryId);
  await writePublicGrade(repositoryId, AGENT_READINESS, true);
  const [repo] = await db().select().from(repositories).where(eq(repositories.id, repositoryId));
  const html = await pageHtml(repo.owner, repo.name);
  expect(html).toContain(agentReadinessManifest.card.title);
  // "No file name" means no evidence path or line range is disclosed — not
  // that the grader's own fixed prose can never contain a filename. The
  // readiness manifest's explanation sentence says "README.md" for every
  // repository alike (see readiness-v01.test.ts and Task 5's private-repo
  // test, which assert on paths/lineRanges for the same reason), so it
  // reveals nothing about this repository and is not what this test guards.
  // What must never appear is a link into the repository's own files: the
  // evidence anchors GradeReport builds are
  // `https://github.com/<owner>/<repo>/blob/<sha>/<path>`, and for a private
  // repository every check's paths are empty, so that <details> block never
  // renders at all.
  expect(html).not.toContain(`https://github.com/${repo.owner}/${repo.name}/blob/`);
});
