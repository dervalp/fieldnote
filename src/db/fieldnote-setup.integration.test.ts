import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, closeDb } from './index';
import * as schema from './schema';

const context = vi.hoisted(() => ({ repositoryId: '' }));
vi.mock('../auth/session', () => ({ currentUser: async () => ({ id: 'unused' }) }));
vi.mock('../lib/env', () => ({ env: () => ({ DEMO_MODE: 'false' }) }));
vi.mock('../workspaces/access', () => ({
  requireRepository: async (repositoryId: string) => {
    if (repositoryId !== context.repositoryId) throw new Error('not found');
    return { id: repositoryId };
  },
}));

const owner = randomUUID();
const workspace = randomUUID();
const repositories: string[] = [];
const sha = 'a'.repeat(40);
const agents = [{ agent: 'codex' as const, supported: true, skillsRoot: '.agents/skills' }];

beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
  await db().insert(schema.users).values({ id: owner, login: 'setup', credentials: 'fixture' });
  await db().insert(schema.workspaces).values({ id: workspace, name: 'Setup' });
});

afterAll(async () => {
  if (repositories.length) {
    // Table existence keeps cleanup valid while exercising the pre-feature schema in RED.
    const runs = (
      await db()
        .select({ id: schema.authoringRuns.id })
        .from(schema.authoringRuns)
        .where(inArray(schema.authoringRuns.repositoryId, repositories))
    ).map((run) => run.id);
    if (schema.authoredPullRequests) {
      const prs = (
        await db()
          .select({ id: schema.authoredPullRequests.id })
          .from(schema.authoredPullRequests)
          .where(inArray(schema.authoredPullRequests.repositoryId, repositories))
      ).map((pr) => pr.id);
      if (prs.length)
        await db()
          .delete(schema.authoredPullRequestRepairs)
          .where(inArray(schema.authoredPullRequestRepairs.authoredPullRequestId, prs));
      await db()
        .delete(schema.authoredPullRequests)
        .where(inArray(schema.authoredPullRequests.repositoryId, repositories));
      await db()
        .delete(schema.repositoryFieldnoteInstallations)
        .where(inArray(schema.repositoryFieldnoteInstallations.repositoryId, repositories));
      if (runs.length) {
        await db()
          .delete(schema.authoringNotes)
          .where(inArray(schema.authoringNotes.authoringRunId, runs));
        await db()
          .delete(schema.fieldnoteSetupFiles)
          .where(inArray(schema.fieldnoteSetupFiles.proposalRunId, runs));
        await db()
          .delete(schema.fieldnoteSetupProposals)
          .where(inArray(schema.fieldnoteSetupProposals.authoringRunId, runs));
      }
    }
    await db()
      .delete(schema.authoringRuns)
      .where(inArray(schema.authoringRuns.repositoryId, repositories));
    await db().delete(schema.repositories).where(inArray(schema.repositories.id, repositories));
    await db().delete(schema.installations).where(inArray(schema.installations.id, repositories));
  }
  await db().delete(schema.workspaces).where(eq(schema.workspaces.id, workspace));
  await db().delete(schema.users).where(eq(schema.users.id, owner));
  await closeDb();
});

async function repository() {
  const id = randomUUID();
  repositories.push(id);
  context.repositoryId = id;
  await db()
    .insert(schema.installations)
    .values({ id, githubInstallationId: id, accountLogin: 'octo', accountType: 'Organization' });
  await db().insert(schema.repositories).values({
    id,
    installationId: id,
    githubRepositoryId: id,
    owner: 'octo',
    name: 'repo',
    defaultBranch: 'main',
    isPrivate: false,
  });
  return id;
}

function run(
  repositoryId: string,
  overrides: Partial<typeof schema.authoringRuns.$inferInsert> = {},
) {
  return {
    id: randomUUID(),
    repositoryId,
    workflow: 'fieldnote-setup' as const,
    kind: 'plan' as const,
    requestedBy: owner,
    requestedWorkspaceId: workspace,
    state: 'running' as const,
    authorVersion: 'setup-v1',
    sha,
    ...overrides,
  };
}

async function plan(repositoryId?: string) {
  const value = run(repositoryId ?? (await repository()));
  await db().insert(schema.authoringRuns).values(value);
  return value;
}

async function proposal(planRunId: string) {
  await db()
    .insert(schema.fieldnoteSetupProposals)
    .values({
      authoringRunId: planRunId,
      repositorySha: sha,
      skillsRelease: '0.1.0',
      skillsRevision: 'b'.repeat(40),
      releaseLockHash: `sha256:${'c'.repeat(64)}`,
      detectedAgents: [],
      confirmedAgents: agents,
      state: 'awaiting-input',
    });
  await db()
    .insert(schema.fieldnoteSetupFiles)
    .values({
      id: randomUUID(),
      proposalRunId: planRunId,
      path: '.fieldnote/profile.yaml',
      kind: 'profile',
      body: 'version: 1',
      hash: `sha256:${'d'.repeat(64)}`,
    });
}

test('persists the workflow discriminator instead of treating setup as readiness', async () => {
  const value = await plan();
  const rows = await db().execute(
    sql`select to_jsonb(r) as row from authoring_runs r where id = ${value.id}`,
  );
  expect(rows[0].row).toMatchObject({ workflow: 'fieldnote-setup' });
});

test('generated migrations backfill pre-existing readiness rows and remove the temporary default', async () => {
  const databaseName = `setup_migration_${randomUUID().replaceAll('-', '')}_test`;
  const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${databaseName}`;
  await admin`create database ${admin(databaseName)}`;
  const connection = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    const migrations = readMigrationFiles({ migrationsFolder: 'drizzle' });
    for (const migration of migrations.slice(0, 20)) {
      for (const statement of migration.sql) await connection.unsafe(statement);
    }
    await connection`insert into users(id, login, credentials) values ('owner', 'owner', 'fixture')`;
    await connection`insert into workspaces(id, name) values ('workspace', 'workspace')`;
    await connection`insert into github_installations(id, github_installation_id, account_login, account_type) values ('installation', 'installation', 'octo', 'Organization')`;
    await connection`insert into repositories(id, installation_id, github_repository_id, owner, name, default_branch, is_private) values ('repository', 'installation', 'repository', 'octo', 'repo', 'main', false)`;
    await connection`insert into authoring_runs(id, repository_id, kind, requested_by, requested_workspace_id, state, author_version) values ('legacy', 'repository', 'plan', 'owner', 'workspace', 'queued', 'readiness-floor-v01')`;
    for (const migration of migrations.slice(20)) {
      for (const statement of migration.sql) await connection.unsafe(statement);
    }
    const [legacy] =
      await connection`select workflow, plan_run_id from authoring_runs where id = 'legacy'`;
    expect(legacy).toEqual({ workflow: 'readiness-remediation', plan_run_id: null });
    const [column] =
      await connection`select column_default from information_schema.columns where table_name = 'authoring_runs' and column_name = 'workflow'`;
    expect(column.column_default).toBeNull();
    const [reasonsColumn] =
      await connection`select data_type, udt_name from information_schema.columns where table_name = 'repository_fieldnote_installations' and column_name = 'reasons'`;
    expect(reasonsColumn).toEqual({ data_type: 'ARRAY', udt_name: '_text' });
  } finally {
    await connection.end();
    await admin`drop database ${admin(databaseName)}`;
    await admin.end();
  }
});

test.each(['detectedAgents', 'confirmedAgents'] as const)(
  'rejects malformed %s JSON on proposal write and load',
  async (field) => {
    const value = await plan();
    await proposal(value.id);
    const invalid =
      field === 'detectedAgents'
        ? [
            {
              agent: 'codex' as const,
              label: 'Codex',
              supported: true,
              confirmed: false,
              evidence: [],
              extra: 'untrusted',
            },
          ]
        : [
            {
              agent: 'codex' as const,
              supported: true,
              skillsRoot: '.agents/skills',
              extra: 'untrusted',
            },
          ];
    // Structurally compatible TypeScript values can still contain undeclared fields.
    await expect(
      db()
        .update(schema.fieldnoteSetupProposals)
        .set({ [field]: invalid })
        .where(eq(schema.fieldnoteSetupProposals.authoringRunId, value.id)),
    ).rejects.toThrow();
    // Bypass the application boundary to simulate malformed historical/external JSON.
    await db().execute(
      sql`update fieldnote_setup_proposals set ${sql.identifier(field === 'detectedAgents' ? 'detected_agents' : 'confirmed_agents')} = ${JSON.stringify(invalid)}::jsonb where authoring_run_id = ${value.id}`,
    );
    const { loadSetupPlan, readySetupAndQueueExecute } = await import('./queries/fieldnote-setup');
    await expect(loadSetupPlan(value.id)).rejects.toThrow();
    await expect(readySetupAndQueueExecute(value.id)).rejects.toThrow();
    const [stored] = await db()
      .select()
      .from(schema.authoringRuns)
      .where(eq(schema.authoringRuns.id, value.id));
    expect(stored.state).toBe('running');
    expect(
      await db()
        .select()
        .from(schema.authoringRuns)
        .where(eq(schema.authoringRuns.planRunId, value.id)),
    ).toEqual([]);
  },
);

test('rejects invalid installation agent JSON before persistence and when loading corrupted rows', async () => {
  const repositoryId = await repository();
  const { recordInstallationObservation } = await import('./queries/fieldnote-setup');
  const observation = {
    state: 'partial' as const,
    release: '0.1.0',
    revision: 'b'.repeat(40),
    lockHash: 'hash',
    agents,
    commitSha: sha,
    reasons: ['Missing profile', 'Missing skills'],
  };
  const invalidAgents = [{ ...agents[0], extra: 'untrusted' }];
  await expect(
    recordInstallationObservation(repositoryId, { ...observation, agents: invalidAgents }),
  ).rejects.toThrow();
  expect(
    await db()
      .select()
      .from(schema.repositoryFieldnoteInstallations)
      .where(eq(schema.repositoryFieldnoteInstallations.repositoryId, repositoryId)),
  ).toEqual([]);
  const stored = await recordInstallationObservation(repositoryId, observation);
  expect(stored.reasons).toEqual(['Missing profile', 'Missing skills']);
  await db().execute(
    sql`update repository_fieldnote_installations set agents = '[{"agent":"unknown","supported":true,"skillsRoot":".agents/skills"}]'::jsonb where repository_id = ${repositoryId}`,
  );
  await expect(
    db()
      .select()
      .from(schema.repositoryFieldnoteInstallations)
      .where(eq(schema.repositoryFieldnoteInstallations.repositoryId, repositoryId)),
  ).rejects.toThrow();
});

test('requires a linked plan for execute and forbids one for plan', async () => {
  const repositoryId = await repository();
  await expect(
    db()
      .insert(schema.authoringRuns)
      .values(run(repositoryId, { kind: 'execute', planRunId: null })),
  ).rejects.toThrow();
  const source = await plan(repositoryId);
  await expect(
    db()
      .insert(schema.authoringRuns)
      .values(run(await repository(), { planRunId: source.id })),
  ).rejects.toThrow();
});

test('makes readiness explicit and rejects unknown workflows', async () => {
  const value = run(await repository(), { workflow: 'readiness-remediation' });
  await db().insert(schema.authoringRuns).values(value);
  const [stored] = await db()
    .select()
    .from(schema.authoringRuns)
    .where(eq(schema.authoringRuns.id, value.id));
  expect(stored.workflow).toBe('readiness-remediation');
  await expect(
    db().execute(
      sql`insert into authoring_runs(id, repository_id, kind, requested_by, requested_workspace_id, state, author_version) values (${randomUUID()}, ${await repository()}, 'plan', ${owner}, ${workspace}, 'queued', 'v1')`,
    ),
  ).rejects.toThrow();
  await expect(
    db().execute(
      sql`insert into authoring_runs(id, repository_id, kind, workflow, requested_by, requested_workspace_id, state, author_version) values (${randomUUID()}, ${await repository()}, 'plan', 'unknown', ${owner}, ${workspace}, 'queued', 'v1')`,
    ),
  ).rejects.toThrow();
});

test('allows one proposal per plan and one generated file per proposal path', async () => {
  const value = await plan();
  await proposal(value.id);
  await expect(proposal(value.id)).rejects.toThrow();
  await expect(
    db().insert(schema.fieldnoteSetupFiles).values({
      id: randomUUID(),
      proposalRunId: value.id,
      path: '.fieldnote/profile.yaml',
      kind: 'profile',
      body: 'duplicate',
      hash: 'hash',
    }),
  ).rejects.toThrow();
});

test('atomically completes a plan and reuses one queued execute under concurrent ready calls', async () => {
  const value = await plan();
  await proposal(value.id);
  const { readySetupAndQueueExecute } = await import('./queries/fieldnote-setup');
  const results = await Promise.all([
    readySetupAndQueueExecute(value.id),
    readySetupAndQueueExecute(value.id),
  ]);
  expect(results[0]).toMatchObject({
    kind: 'execute',
    workflow: 'fieldnote-setup',
    planRunId: value.id,
    state: 'queued',
    repositoryId: value.repositoryId,
  });
  expect(results[1].id).toBe(results[0].id);
  expect((await readySetupAndQueueExecute(value.id)).id).toBe(results[0].id);
  const [stored] = await db()
    .select()
    .from(schema.authoringRuns)
    .where(eq(schema.authoringRuns.id, value.id));
  expect(stored).toMatchObject({ state: 'complete', sha });
  expect(stored.completedAt).toBeInstanceOf(Date);
  const [ready] = await db()
    .select()
    .from(schema.fieldnoteSetupProposals)
    .where(eq(schema.fieldnoteSetupProposals.authoringRunId, value.id));
  expect(ready.state).toBe('ready');
  await db()
    .update(schema.authoringRuns)
    .set({ state: 'failed' })
    .where(eq(schema.authoringRuns.id, results[0].id));
  await expect(
    db()
      .insert(schema.authoringRuns)
      .values(run(value.repositoryId, { kind: 'execute', planRunId: value.id })),
  ).rejects.toThrow();
});

test('failed ready validation leaves proposal and plan unchanged', async () => {
  const value = await plan();
  await proposal(value.id);
  await db()
    .update(schema.fieldnoteSetupProposals)
    .set({ confirmedAgents: null })
    .where(eq(schema.fieldnoteSetupProposals.authoringRunId, value.id));
  const { readySetupAndQueueExecute } = await import('./queries/fieldnote-setup');
  await expect(readySetupAndQueueExecute(value.id)).rejects.toThrow();
  const [stored] = await db()
    .select()
    .from(schema.authoringRuns)
    .where(eq(schema.authoringRuns.id, value.id));
  expect(stored.state).toBe('running');
  const [pending] = await db()
    .select()
    .from(schema.fieldnoteSetupProposals)
    .where(eq(schema.fieldnoteSetupProposals.authoringRunId, value.id));
  expect(pending.state).toBe('awaiting-input');
});

test('readiness queries and completion cannot consume a setup plan', async () => {
  const value = await plan();
  const { latestPlan, getPlan, listUndispatchedPlans, completeAuthoringRun } =
    await import('./queries/authoring-runs');
  expect(await latestPlan(value.repositoryId)).toBeNull();
  expect(await getPlan(value.repositoryId, value.id)).toBeNull();
  await expect(
    completeAuthoringRun(value.id, [
      { checkId: 'root-readme', path: 'README.md', rationale: 'missing', ordinal: 0 },
    ]),
  ).rejects.toThrow('Not a readiness plan');
  await db()
    .update(schema.authoringRuns)
    .set({ state: 'queued' })
    .where(eq(schema.authoringRuns.id, value.id));
  expect(await listUndispatchedPlans()).not.toContain(value.id);
});

test('notes have a stable tie-break order and browser reads authorize the repository', async () => {
  const value = await plan();
  const createdAt = new Date('2026-09-16T10:00:00Z');
  await db()
    .insert(schema.authoringNotes)
    .values([
      {
        id: `${value.id}-b`,
        authoringRunId: value.id,
        speaker: 'human',
        kind: 'answer',
        body: 'second',
        createdAt,
      },
      {
        id: `${value.id}-a`,
        authoringRunId: value.id,
        speaker: 'agent',
        kind: 'question',
        body: 'first',
        createdAt,
      },
    ]);
  const { getSetupPlan } = await import('./queries/fieldnote-setup');
  expect(
    (await getSetupPlan(value.repositoryId, value.id))?.notes.map((note) => note.body),
  ).toEqual(['first', 'second']);
  context.repositoryId = 'unauthorized';
  await expect(getSetupPlan(value.repositoryId, value.id)).rejects.toThrow('not found');
  context.repositoryId = value.repositoryId;
  expect(await getSetupPlan(value.repositoryId, randomUUID())).toBeNull();
});

test('setup collection and result retries persist one question, then concurrent answers consume it once', async () => {
  const value = await plan();
  const { saveSetupSnapshot, saveSetupResult, appendSetupAnswer, loadSetupPlan } =
    await import('./queries/fieldnote-setup');
  const identity = {
    release: 'skills-v0.1.0',
    revision: 'b'.repeat(40),
    releaseLockHash: `sha256:${'c'.repeat(64)}` as const,
  };
  const snapshot = {
    sha,
    complete: true,
    paths: ['AGENTS.md'],
    documents: [],
    candidates: [
      {
        agent: 'codex' as const,
        label: 'Codex',
        supported: true,
        confirmed: false,
        evidence: [{ source: 'path' as const, value: 'AGENTS.md' }],
      },
    ],
  };
  await saveSetupSnapshot(value.id, identity, snapshot);
  await saveSetupSnapshot(value.id, identity, snapshot);
  expect((await loadSetupPlan(value.id))?.proposal?.detectedAgents).toEqual(snapshot.candidates);
  const result = {
    state: 'awaiting-input' as const,
    findings: ['Found Codex'],
    confirmedFacts: [],
    nextQuestion: { key: 'agents' as const, text: 'Confirm Codex?', evidence: ['AGENTS.md'] },
    confirmedAgents: [],
    files: [],
    sandboxId: 'local',
    model: 'local',
  };
  await Promise.all([
    saveSetupResult(value.id, result, null),
    saveSetupResult(value.id, result, null),
  ]);
  let stored = (await loadSetupPlan(value.id))!;
  const question = stored.notes.filter((note) => note.kind === 'question');
  expect(question).toHaveLength(1);
  await Promise.all([
    appendSetupAnswer(value.repositoryId, value.id, question[0].id, 'Yes', agents),
    appendSetupAnswer(value.repositoryId, value.id, question[0].id, 'Yes', agents),
  ]);
  stored = (await loadSetupPlan(value.id))!;
  expect(stored.notes.filter((note) => note.kind === 'answer')).toHaveLength(1);
  expect(stored.proposal?.state).toBe('exploring');
  expect(stored.proposal?.confirmedAgents).toEqual(agents);
  const answerId = stored.notes.find((note) => note.kind === 'answer')!.id;
  const next = {
    ...result,
    confirmedAgents: agents,
    nextQuestion: {
      key: 'Tracker.kind' as const,
      text: 'Which tracker?',
      evidence: ['No tracker'],
    },
  };
  await Promise.all([
    saveSetupResult(value.id, next, answerId),
    saveSetupResult(value.id, next, answerId),
  ]);
  stored = (await loadSetupPlan(value.id))!;
  expect(stored.notes.filter((note) => note.kind === 'question')).toHaveLength(2);
  expect(stored.notes.filter((note) => note.kind === 'answer')).toHaveLength(1);
  await expect(
    appendSetupAnswer(value.repositoryId, value.id, question[0].id, 'stale', agents),
  ).rejects.toThrow();
});

test('ready author output and linked execute are committed atomically, including concurrent retries', async () => {
  const value = await plan();
  await proposal(value.id);
  await db()
    .update(schema.fieldnoteSetupProposals)
    .set({ state: 'exploring' })
    .where(eq(schema.fieldnoteSetupProposals.authoringRunId, value.id));
  const { saveSetupResult, loadSetupPlan } = await import('./queries/fieldnote-setup');
  const result = {
    state: 'ready' as const,
    findings: [],
    confirmedFacts: [],
    nextQuestion: null,
    confirmedAgents: agents,
    files: [
      {
        path: '.fieldnote/profile.md',
        content: '# Profile',
        kind: 'profile' as const,
        hash: `sha256:${'d'.repeat(64)}` as const,
      },
    ],
    sandboxId: 'local',
    model: 'local',
  };
  await Promise.all([
    saveSetupResult(value.id, result, null),
    saveSetupResult(value.id, result, null),
  ]);
  const stored = (await loadSetupPlan(value.id))!;
  expect(stored.run.state).toBe('complete');
  expect(stored.proposal?.state).toBe('ready');
  expect(stored.files.find((file) => file.path === '.fieldnote/profile.md')?.body).toBe(
    '# Profile',
  );
  expect(
    await db()
      .select()
      .from(schema.authoringRuns)
      .where(eq(schema.authoringRuns.planRunId, value.id)),
  ).toHaveLength(1);
});

test('failed ready validation rolls back generated files, notes, and model provenance', async () => {
  const value = await plan();
  await proposal(value.id);
  await db()
    .update(schema.fieldnoteSetupProposals)
    .set({ state: 'exploring' })
    .where(eq(schema.fieldnoteSetupProposals.authoringRunId, value.id));
  const { saveSetupResult, loadSetupPlan } = await import('./queries/fieldnote-setup');
  await expect(
    saveSetupResult(
      value.id,
      {
        state: 'ready',
        findings: ['new finding'],
        confirmedFacts: [],
        nextQuestion: null,
        confirmedAgents: [],
        files: [
          {
            path: '.fieldnote/profile.md',
            content: 'profile',
            kind: 'profile',
            hash: `sha256:${'d'.repeat(64)}`,
          },
        ],
        sandboxId: 'local',
        model: 'local',
      },
      null,
    ),
  ).rejects.toThrow();
  const stored = (await loadSetupPlan(value.id))!;
  expect(stored.run).toMatchObject({ state: 'running', model: null });
  expect(stored.notes).toEqual([]);
  expect(stored.files.map((file) => file.path)).toEqual(['.fieldnote/profile.yaml']);
});

test('PR identity is unique per repository, repairs are bounded, and opening a PR does not install', async () => {
  const value = await plan();
  await proposal(value.id);
  const { readySetupAndQueueExecute, recordAuthoredPullRequest, recordInstallationObservation } =
    await import('./queries/fieldnote-setup');
  const execute = await readySetupAndQueueExecute(value.id);
  const pr = await recordAuthoredPullRequest({
    authoringRunId: execute.id,
    repositoryId: value.repositoryId,
    number: 42,
    branch: 'fieldnote/setup',
    headSha: sha,
    url: 'https://github.com/octo/repo/pull/42',
    outcome: 'open',
    openedAt: new Date(),
  });
  const { id: prId, ...samePr } = pr;
  expect((await recordAuthoredPullRequest(samePr)).id).toBe(prId);
  await expect(recordAuthoredPullRequest({ ...samePr, number: 43 })).rejects.toThrow(
    'different pull request',
  );
  const rows = await db()
    .select()
    .from(schema.repositoryFieldnoteInstallations)
    .where(eq(schema.repositoryFieldnoteInstallations.repositoryId, value.repositoryId));
  expect(rows).toEqual([]);
  await db()
    .update(schema.authoringRuns)
    .set({ state: 'failed' })
    .where(eq(schema.authoringRuns.id, execute.id));
  const other = run(value.repositoryId, { state: 'failed' });
  await db().insert(schema.authoringRuns).values(other);
  await expect(
    db()
      .insert(schema.authoredPullRequests)
      .values({ ...pr, id: randomUUID(), authoringRunId: other.id }),
  ).rejects.toThrow();
  const repair = {
    id: randomUUID(),
    authoredPullRequestId: pr.id,
    ordinal: 1,
    triggerKind: 'ci',
    triggerReference: 'check-1',
    state: 'queued' as const,
    baseHeadSha: sha,
  };
  for (const ordinal of [0, 4])
    await expect(
      db()
        .insert(schema.authoredPullRequestRepairs)
        .values({ ...repair, ordinal }),
    ).rejects.toThrow();
  await db().insert(schema.authoredPullRequestRepairs).values(repair);
  await expect(
    db()
      .insert(schema.authoredPullRequestRepairs)
      .values({ ...repair, id: randomUUID() }),
  ).rejects.toThrow();
  await recordInstallationObservation(value.repositoryId, {
    state: 'partial',
    release: '0.1.0',
    revision: 'b'.repeat(40),
    lockHash: 'hash',
    agents,
    commitSha: sha,
    reasons: ['Missing profile'],
  });
  await recordInstallationObservation(value.repositoryId, {
    state: 'current',
    release: '0.1.0',
    revision: 'b'.repeat(40),
    lockHash: 'hash',
    agents,
    commitSha: sha,
    reasons: [],
  });
  expect(
    await db()
      .select()
      .from(schema.repositoryFieldnoteInstallations)
      .where(
        and(
          eq(schema.repositoryFieldnoteInstallations.repositoryId, value.repositoryId),
          eq(schema.repositoryFieldnoteInstallations.state, 'current'),
        ),
      ),
  ).toHaveLength(1);
});
