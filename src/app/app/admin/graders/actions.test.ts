import { beforeEach, expect, test, vi } from 'vitest';
const { verifyVersion, withdrawVersion, requireStaff } = vi.hoisted(() => ({
  verifyVersion: vi.fn(),
  withdrawVersion: vi.fn(),
  requireStaff: vi.fn(),
}));
vi.mock('../../../../db/queries/grader-publishing', () => ({ verifyVersion, withdrawVersion }));
vi.mock('../../../../workspaces/staff', () => ({ requireStaff }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { withdrawGraderVersionAsStaff } from './actions';

beforeEach(() => {
  vi.resetAllMocks();
});

// Same shape as src/app/app/settings/actions.test.ts's "Next navigation
// errors remain framework control flow": requireStaff() is mocked directly
// (rather than driven through a real notFound()), so this is the one place
// that holds the guarantee that withdrawGraderVersionAsStaff actually calls
// requireStaff() and lets its notFound() propagate, instead of the action's
// own try/catch turning it into an { error } result the caller could
// mistake for an ordinary failure.
test('a non-staff caller\'s notFound propagates, rather than becoming an error result', async () => {
  const notFound = Object.assign(new Error('not found'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  requireStaff.mockRejectedValue(notFound);
  const form = new FormData();
  form.set('graderId', 'acme/test-coverage');
  form.set('version', '0.1.0');
  form.set('note', 'Nope.');
  await expect(withdrawGraderVersionAsStaff(form)).rejects.toBe(notFound);
  expect(withdrawVersion).not.toHaveBeenCalled();
});
