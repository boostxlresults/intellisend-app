/**
 * sendTimeOptimizer.ts
 * 
 * Feature 6: Send-Time Optimization
 * 
 * Instead of blasting an entire list at a fixed time (e.g., 10:00 AM for everyone),
 * this service analyzes each contact's historical reply timestamps to predict the
 * optimal hour to send them a message.
 * 
 * Logic:
 * 1. Look at all inbound messages from this contact in the last 90 days.
 * 2. Extract the hour of day for each reply (in the contact's local timezone).
 * 3. Find the hour with the most replies (peak engagement hour).
 * 4. If the contact has no history, fall back to a configurable default (e.g., 10 AM).
 * 5. If the optimal hour is within quiet hours for the contact's timezone, shift to
 *    the next allowed hour.
 * 
 * Integration:
 * - Called by queueCampaignMessages() in queueDispatcher.ts
 * - The processAfter timestamp for each message is adjusted to the contact's optimal hour
 *   on the next available day (today if the hour hasn't passed, tomorrow otherwise).
 * 
 * This is a "soft" optimization — it spreads delivery across the day rather than
 * sending all messages at once, which also reduces carrier spam filter triggers.
 */

import { prisma } from '../index';
import { getTimezoneFromPhone, getContactQuietHoursWindow } from '../utils/contactTimezone';

const DEFAULT_SEND_HOUR = 10; // 10:00 AM local time if no history available
const MIN_REPLIES_FOR_OPTIMIZATION = 2; // Need at least 2 replies to trust the pattern

/**
 * Get the optimal send hour (0-23) for a contact based on their reply history.
 * Returns the hour in the contact's LOCAL timezone.
 */
export async function getOptimalSendHour(
  tenantId: string,
  contactId: string,
  phone: string,
  fallbackTimezone: string = 'America/Phoenix'
): Promise<{ hour: number; timezone: string; confidence: 'high' | 'low' | 'default' }> {
  const contactTimezone = getTimezoneFromPhone(phone, fallbackTimezone);
  const { startHour, endHour } = getContactQuietHoursWindow(phone, fallbackTimezone);

  try {
    // Get all inbound messages from this contact in the last 90 days
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    
    const inboundMessages = await prisma.message.findMany({
      where: {
        tenantId,
        contactId,
        direction: 'INBOUND',
        createdAt: { gte: ninetyDaysAgo },
      },
      select: { createdAt: true },
    });

    if (inboundMessages.length < MIN_REPLIES_FOR_OPTIMIZATION) {
      // Not enough data — use default send hour
      const safeDefault = Math.max(startHour, Math.min(DEFAULT_SEND_HOUR, endHour - 1));
      return { hour: safeDefault, timezone: contactTimezone, confidence: 'default' };
    }

    // Count replies by hour in the contact's local timezone
    const hourCounts = new Array(24).fill(0);
    
    for (const msg of inboundMessages) {
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: contactTimezone,
          hour: '2-digit',
          hour12: false,
        });
        const parts = formatter.formatToParts(msg.createdAt);
        const localHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
        hourCounts[localHour]++;
      } catch {
        // Skip if timezone resolution fails
      }
    }

    // Find the peak engagement hour within the allowed sending window
    let bestHour = DEFAULT_SEND_HOUR;
    let bestCount = 0;
    
    for (let h = startHour; h < endHour; h++) {
      if (hourCounts[h] > bestCount) {
        bestCount = hourCounts[h];
        bestHour = h;
      }
    }

    const confidence = bestCount >= 3 ? 'high' : 'low';
    
    return { hour: bestHour, timezone: contactTimezone, confidence };
  } catch (err: any) {
    console.error(`[SendTimeOptimizer] Error for contact ${contactId}:`, err.message);
    const safeDefault = Math.max(startHour, Math.min(DEFAULT_SEND_HOUR, endHour - 1));
    return { hour: safeDefault, timezone: contactTimezone, confidence: 'default' };
  }
}

/**
 * Calculate the next Date when a contact's optimal send hour occurs.
 * If the optimal hour is still in the future today, returns today at that hour.
 * Otherwise returns tomorrow at that hour.
 * 
 * @param optimalHour - Hour of day (0-23) in the contact's local timezone
 * @param contactTimezone - IANA timezone string for the contact
 * @param baseOffset - Additional offset in ms (for spreading messages across a batch)
 */
export function getNextOptimalSendTime(
  optimalHour: number,
  contactTimezone: string,
  baseOffset: number = 0
): Date {
  const now = new Date();
  
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: contactTimezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const localHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const localMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    
    let minutesUntilOptimal: number;
    
    if (localHour < optimalHour) {
      // Optimal hour is later today
      minutesUntilOptimal = (optimalHour - localHour) * 60 - localMinute;
    } else if (localHour === optimalHour && localMinute < 30) {
      // Within the optimal hour right now — send soon
      minutesUntilOptimal = 5;
    } else {
      // Optimal hour has passed today — schedule for tomorrow
      minutesUntilOptimal = (24 - localHour + optimalHour) * 60 - localMinute;
    }
    
    return new Date(now.getTime() + minutesUntilOptimal * 60 * 1000 + baseOffset);
  } catch {
    // Fallback: send in 1 hour
    return new Date(now.getTime() + 60 * 60 * 1000 + baseOffset);
  }
}

/**
 * Build an optimized processAfter schedule for a batch of contacts.
 * Each contact gets their personal optimal send time.
 * Within the same optimal hour, messages are spread with jitter to avoid bursts.
 * 
 * @returns Map of contactId → processAfter Date
 */
export async function buildOptimizedSendSchedule(
  tenantId: string,
  contacts: Array<{ id: string; phone: string }>,
  fallbackTimezone: string,
  jitterMinMs: number = 1000,
  jitterMaxMs: number = 5000
): Promise<Map<string, Date>> {
  const schedule = new Map<string, Date>();
  
  // Group contacts by their optimal hour to add intra-hour jitter
  const hourGroups = new Map<number, Array<{ id: string; phone: string }>>();
  
  for (const contact of contacts) {
    const { hour } = await getOptimalSendHour(tenantId, contact.id, contact.phone, fallbackTimezone);
    const group = hourGroups.get(hour) || [];
    group.push(contact);
    hourGroups.set(hour, group);
  }
  
  // Assign send times with intra-hour spreading
  for (const [hour, group] of hourGroups) {
    // Find the timezone of the first contact in this group (they'll all be similar)
    const firstContactTimezone = getTimezoneFromPhone(group[0].phone, fallbackTimezone);
    const baseTime = getNextOptimalSendTime(hour, firstContactTimezone);
    
    // Spread messages within the hour using jitter
    const spreadIntervalMs = Math.min(
      (55 * 60 * 1000) / Math.max(group.length, 1), // Spread across 55 minutes
      60000 // Max 1 minute between messages in the same hour
    );
    
    group.forEach((contact, index) => {
      const jitter = Math.floor(Math.random() * (jitterMaxMs - jitterMinMs + 1)) + jitterMinMs;
      const sendTime = new Date(baseTime.getTime() + index * spreadIntervalMs + jitter);
      schedule.set(contact.id, sendTime);
    });
  }
  
  return schedule;
}
