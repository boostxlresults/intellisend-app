/**
 * Master lock for marketing sends (campaigns and sequences).
 *
 * Off unless MARKETING_SENDS_ENABLED is exactly "true". While it is off:
 *   - campaigns cannot be scheduled and the scheduler fires none,
 *   - contacts cannot be enrolled in sequences and no sequence step is queued,
 *   - the dispatcher leaves any queued campaign or sequence message untouched.
 * Inbox replies, AI replies and opt-in or opt-out confirmations are not affected.
 */
export function marketingSendsEnabled(): boolean {
  return process.env.MARKETING_SENDS_ENABLED === 'true';
}

export const MARKETING_LOCK_MESSAGE =
  'Marketing sends are switched off while the send engine is rebuilt and tested. Inbox replies still work.';
