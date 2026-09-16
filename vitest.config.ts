import { defineConfig } from 'vitest/config';
// `packages/**` is included so the design system's own guards actually run.
// Without it `vitest run packages/design-system/boundary.test.ts` reports "no
// test files found" and exits 0 — a green tick for a check that never ran.
export default defineConfig({
  resolve: { alias: { 'server-only': 'next/dist/compiled/server-only/empty' } },
  test: { include: ['src/**/*.test.ts', 'packages/**/*.test.ts'], testTimeout: 15000 },
});
