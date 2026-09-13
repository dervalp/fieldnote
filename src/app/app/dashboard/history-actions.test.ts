import { beforeEach, expect, test, vi } from 'vitest';
const { identity, insert, registered } = vi.hoisted(() => ({
  identity: vi.fn(),
  insert: vi.fn(),
  registered: vi.fn(),
}));
vi.mock('../../../auth/session', () => ({ currentUserId: identity }));
vi.mock('../../../db/queries/history-interest', () => ({
  persistHistoryInterest: insert,
  hasHistoryInterest: registered,
}));
import { registerHistoryInterest, historyInterestStatus } from './history-actions';
beforeEach(() => {
  vi.resetAllMocks();
  identity.mockResolvedValue('server-user');
  registered.mockResolvedValue(false);
});
test('signed-out registration rejects without persisting interest', async () => {
  identity.mockResolvedValue(null);
  await expect(registerHistoryInterest()).rejects.toThrow('Sign in');
  expect(insert).not.toHaveBeenCalled();
  expect(await historyInterestStatus()).toEqual({ status: 'signed-out' });
});
test('registration derives identity on server, ignores extra client arguments, and returns no access grant', async () => {
  const result = await Reflect.apply(registerHistoryInterest, null, ['attacker-user', 'paid']);
  expect(result).toEqual({ status: 'registered' });
  expect(insert).toHaveBeenCalledExactlyOnceWith('server-user');
});
test('failed persistence never returns success and retry can succeed', async () => {
  insert.mockRejectedValueOnce(new Error('database unavailable'));
  await expect(registerHistoryInterest()).rejects.toThrow();
  expect(await registerHistoryInterest()).toEqual({ status: 'registered' });
});
test('reopening loads current user registration without writing', async () => {
  expect(await historyInterestStatus()).toEqual({ status: 'unregistered' });
  registered.mockResolvedValue(true);
  expect(await historyInterestStatus()).toEqual({ status: 'registered' });
  expect(registered).toHaveBeenCalledWith('server-user');
  expect(insert).not.toHaveBeenCalled();
});
test('status failures reject so the UI cannot show success', async () => {
  registered.mockRejectedValueOnce(new Error('database unavailable'));
  await expect(historyInterestStatus()).rejects.toThrow();
});
