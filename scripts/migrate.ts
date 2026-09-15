import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { closeDb, db } from '../src/db';
import { workspaces } from '../src/db/schema';
import { installBuiltIns, seedBuiltInGraders } from '../src/db/queries/graders';
// Migrations need a direct connection. Neon's pooled endpoint runs PgBouncer in
// transaction mode, which discards the session state DDL depends on, and fails
// in ways that never name pooling as the cause. Hosts that expose a single
// connection string (local Postgres) fall back to it unchanged.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const connection = postgres(url, { max: 1 });
try {
  await migrate(drizzle(connection), { migrationsFolder: 'drizzle' });
  // Every environment that runs migrations gets fieldnote's own graders in
  // the registry, the same way it gets its tables: there is no separate boot
  // step, so this is the one place guaranteed to run before anything resolves
  // a grader.
  await seedBuiltInGraders();
  // A workspace created before this slice never went through
  // ensureDefaultWorkspace()/createWorkspace() with installBuiltIns() in
  // them, and won't again unless it re-creates a workspace — so the
  // migration step backfills it here, the same idempotent way installBuiltIns
  // installs anywhere else. Every workspace that exists ends up with the
  // built-ins, not just ones created from now on.
  const existingWorkspaces = await db().select({ id: workspaces.id }).from(workspaces);
  for (const workspace of existingWorkspaces) {
    await installBuiltIns(workspace.id);
  }
} finally {
  await connection.end();
  await closeDb();
}
