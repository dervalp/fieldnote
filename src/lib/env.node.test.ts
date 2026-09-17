import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

const syntheticEnv: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  NODE_ENV: 'test',
  DEMO_MODE: 'false',
  DATABASE_URL: 'postgres://ci:ci@127.0.0.1:1/unreachable',
  GITHUB_APP_ID: '000000',
  GITHUB_APP_SLUG: 'synthetic',
  GITHUB_PRIVATE_KEY: 'synthetic-key',
  GITHUB_WEBHOOK_SECRET: 'synthetic-webhook-secret',
  GITHUB_CLIENT_ID: 'synthetic-client',
  GITHUB_CLIENT_SECRET: 'synthetic-secret',
  APP_URL: 'https://ci.example.invalid',
  TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
  INNGEST_DEV: '1',
};

test('shared environment imports in plain Node without a Next or Vitest resolver', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      "import { integrationEnv } from './src/lib/env-node.ts'; if (integrationEnv().GITHUB_APP_SLUG !== 'synthetic') process.exit(2);",
    ],
    { env: syntheticEnv, encoding: 'utf8', timeout: 10_000 },
  );
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});

test('documented github sync CLI reaches usage validation without provider or database calls', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/sync-repository.ts'], {
    env: syntheticEnv,
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Usage: pnpm github:sync repository:123');
  expect(result.stderr).not.toContain('server-only');
});

test.each([
  {
    reason: 'missing repository',
    env: {},
    message: 'Usage: pnpm github:sync repository:123',
  },
  {
    reason: 'disabled integration',
    env: { DEMO_MODE: 'true' },
    message: 'GitHub integration is disabled in demo mode',
  },
])('github sync rejects $reason before loading operational clients', ({ env, message }) => {
  const guard = `
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (/^(?:drizzle-orm|postgres|inngest|octokit)(?:\\/|$)/.test(specifier))
        throw new Error('Operational clients unavailable');
      return nextResolve(specifier, context);
    }});
  `;
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--import',
      `data:text/javascript,${encodeURIComponent(guard)}`,
      'scripts/sync-repository.ts',
    ],
    { env: { ...syntheticEnv, ...env }, encoding: 'utf8', timeout: 10_000 },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(message);
  expect(result.stderr).not.toContain('Operational clients unavailable');
});
