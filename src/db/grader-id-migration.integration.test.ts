import { afterAll, beforeAll, expect, test } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, closeDb } from './index';

beforeAll(async () => {
  await migrate(db(), { migrationsFolder: 'drizzle' });
});
afterAll(async () => {
  await closeDb();
});

test('both grading tables identify a grader by grader_id, and no family column survives', async () => {
  // A single scan: the two tables that now carry a grader's identity contribute
  // their grader_id/manifest columns, and — scoped to the whole public schema,
  // not just these two tables — any surviving `family` column would show up as
  // an extra row and fail the exact-match assertion below.
  const rows = [
    ...(await db().execute(sql`
      select table_name, column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and (
          (table_name in ('grade_runs','grader_versions') and column_name in ('grader_id','manifest'))
          or column_name = 'family'
        )
      order by table_name, column_name
    `)),
  ] as unknown as { table_name: string; column_name: string; is_nullable: string }[];
  expect(rows.map((row) => `${row.table_name}.${row.column_name}`)).toEqual([
    'grade_runs.grader_id',
    'grader_versions.grader_id',
    'grader_versions.manifest',
  ]);
  expect(rows.find((row) => row.column_name === 'manifest')?.is_nullable).toBe('NO');
});

test('one active run per grader per repository, not one per repository', async () => {
  const [index] = [
    ...(await db().execute(sql`
      select indexdef from pg_indexes
      where tablename = 'grade_runs' and indexname = 'grade_runs_one_active'
    `)),
  ] as unknown as { indexdef: string }[];
  expect(index.indexdef).toMatch(/repository_id/);
  expect(index.indexdef).toMatch(/grader_id/);
});
