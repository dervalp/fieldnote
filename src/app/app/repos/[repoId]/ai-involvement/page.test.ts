import { expect, test, vi } from 'vitest';

test('the route rejects a repository the caller cannot see', async () => {
  vi.doMock('../../../../../auth/access', () => ({
    requireTrackedRepository: () => {
      throw new Error('Repository unavailable: nope');
    },
  }));
  const { default: Page } = await import('./page');
  await expect(Page({ params: Promise.resolve({ repoId: 'nope' }) })).rejects.toThrow(
    'Repository unavailable',
  );
});
