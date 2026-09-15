import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { and, eq, inArray } from 'drizzle-orm';
import { db, closeDb } from './index';
import { graderInstalls, graders, graderVersions, users, workspaces } from './schema';
import {
  graderVersion,
  installBuiltIns,
  installedGrader,
  installedGraders,
  seedBuiltInGraders,
} from './queries/graders';
import { builtInManifests } from '../domain/grading/registry';
import { needsHash } from '../domain/grading/needs-consent';
import { AGENT_READINESS, agentReadinessManifest } from '../domain/grading/graders/agent-readiness';

let user = '';
beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
  user = randomUUID();
  await db().insert(users).values({ id: user, login: 'grader-fixture', credentials: 'fixture' });
});

// Each test gets its own workspace — never shared — so an installBuiltIns()
// in one test cannot leave a later "nothing is installed" test looking at a
// workspace something else already installed into.
const fixtureWorkspaces: string[] = [];
let workspace = '';
beforeEach(async () => {
  workspace = randomUUID();
  fixtureWorkspaces.push(workspace);
  await db().insert(workspaces).values({ id: workspace, name: 'Graders fixture' });
});

afterAll(async () => {
  if (fixtureWorkspaces.length) {
    await db().delete(graderInstalls).where(inArray(graderInstalls.workspaceId, fixtureWorkspaces));
    await db().delete(workspaces).where(inArray(workspaces.id, fixtureWorkspaces));
  }
  await db().delete(users).where(eq(users.id, user));
  await closeDb();
});

test('seeding publishes every built-in as an ordinary verified row owned by nobody', async () => {
  await seedBuiltInGraders();
  for (const manifest of builtInManifests()) {
    const resolved = await graderVersion(manifest.id, manifest.version);
    expect(resolved).toEqual(manifest);
    const [row] = await db().select().from(graderVersions).where(
      and(eq(graderVersions.graderId, manifest.id), eq(graderVersions.version, manifest.version)),
    );
    expect(row.verifiedAt).toBeInstanceOf(Date);
    expect(row.publishedBy).toBeNull();
    const [grader] = await db().select().from(graders).where(eq(graders.id, manifest.id));
    expect(grader.ownedByWorkspaceId).toBeNull();
  }
});

test('seeding twice changes nothing', async () => {
  await seedBuiltInGraders();
  await seedBuiltInGraders();
  const rows = await db().select().from(graderVersions);
  expect(rows).toHaveLength(builtInManifests().length);
});

test('a workspace with the built-ins installed resolves them, pinned', async () => {
  await seedBuiltInGraders();
  await installBuiltIns(workspace);
  const installed = await installedGraders(workspace);
  expect(installed.map((entry) => entry.manifest.id).sort()).toEqual(
    builtInManifests().map((manifest) => manifest.id).sort(),
  );
  const readiness = await installedGrader(workspace, AGENT_READINESS);
  expect(readiness?.version).toBe(agentReadinessManifest.version);
  expect(readiness?.consentedNeeds).toBe(needsHash(agentReadinessManifest.needs));
});

test('an uninstalled grader resolves as null for a workspace but still by version', async () => {
  await seedBuiltInGraders();
  expect(await installedGrader(workspace, AGENT_READINESS)).toBeNull();
  expect(await graderVersion(AGENT_READINESS, agentReadinessManifest.version)).toEqual(
    agentReadinessManifest,
  );
});

test('an unknown grader or version resolves as null rather than throwing', async () => {
  expect(await graderVersion('nobody/nothing', '0.1.0')).toBeNull();
  expect(await graderVersion(AGENT_READINESS, '9.9.9')).toBeNull();
});
