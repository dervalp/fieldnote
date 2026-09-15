import { expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GraderManifest } from '../../../../domain/grading/manifest';

const deps = vi.hoisted(() => ({
  reviewQueue: vi.fn(),
}));
vi.mock('../../../../db/queries/grader-publishing', () => ({
  reviewQueue: deps.reviewQueue,
}));
vi.mock('./actions', () => ({
  verifyGraderVersion: vi.fn(),
  withdrawGraderVersionAsStaff: vi.fn(),
}));
import AdminGraders from './page';

const fixtureManifest: GraderManifest = {
  id: 'acme/test-coverage',
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'test-discipline',
  kind: 'declarative',
  needs: { 'repo.files': ['README.md'] },
  disclaimer: 'Evidence, not certification.',
  card: {
    title: 'Test Coverage',
    tagline: 'Is it tested?',
    groups: [{ title: 'All', checks: ['readme'] }],
  },
  checks: [
    {
      id: 'readme',
      title: 'Project documentation',
      points: 100,
      explain: { pass: 'Found a README.', fail: 'No README.' },
      primitive: 'file-exists',
      args: { root: true, nonempty: true, anyOf: ['README.md'], caseInsensitive: false },
    },
  ],
} as GraderManifest;

test('a non-staff visitor gets a 404 rather than a hint that the page exists', async () => {
  deps.reviewQueue.mockRejectedValue(new Error('NEXT_HTTP_ERROR_FALLBACK;404'));
  await expect(AdminGraders()).rejects.toThrow('404');
});

test('staff see the manifest a reviewer has to judge', async () => {
  deps.reviewQueue.mockResolvedValue([
    {
      graderId: 'acme/test-coverage',
      version: '0.1.0',
      manifest: fixtureManifest,
      author: 'acme',
      publishedAt: new Date('2026-09-15'),
    },
  ]);
  const html = renderToStaticMarkup(await AdminGraders());
  expect(html).toContain('acme/test-coverage');
  expect(html).toContain('Project documentation'); // a check title
  expect(html).toContain('The contents of files matching README.md');
  expect(html).toContain('Mark verified');
  expect(html).toContain('name="note"');
});

test('an empty queue says so and offers nothing to press', async () => {
  deps.reviewQueue.mockResolvedValue([]);
  const html = renderToStaticMarkup(await AdminGraders());
  expect(html).toContain('Nothing waiting for review.');
  expect(html).not.toContain('Mark verified');
});
