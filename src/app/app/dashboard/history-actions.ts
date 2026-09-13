'use server';

import { currentUserId } from '../../../auth/session';
import { hasHistoryInterest, persistHistoryInterest } from '../../../db/queries/history-interest';

export async function registerHistoryInterest(): Promise<{ status: 'registered' }> {
  const userId = await currentUserId();
  if (!userId) throw new Error('Sign in to register your interest.');
  await persistHistoryInterest(userId);
  return { status: 'registered' };
}

export async function historyInterestStatus(): Promise<{
  status: 'registered' | 'unregistered' | 'signed-out';
}> {
  const userId = await currentUserId();
  if (!userId) return { status: 'signed-out' };
  return { status: (await hasHistoryInterest(userId)) ? 'registered' : 'unregistered' };
}
