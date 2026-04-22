/**
 * psaOptInWorkflow.ts
 * 
 * Feature 4: 3-Phase PSA Workflow Engine
 * 
 * When a contact replies "Y" (or any opt-in keyword) to a PSA campaign message,
 * this service automatically:
 * 
 * Phase 1 (PSA Blast) — handled by campaignScheduler.ts
 * Phase 2 (Opt-In Capture) — this file handles the transition:
 *   1. Detects which PSA campaign the contact received (via their last campaign message)
 *   2. If the campaign has a psaOptInSegmentId configured, adds the contact to that segment
 *   3. Sets an optInCooldownUntil timestamp on the contact (default 24 hours)
 *      to prevent immediate marketing blasts before the consent is fully established
 * Phase 3 (Warm Marketing) — contact is now in the warm segment, eligible for marketing
 *   campaigns after the cooldown expires
 * 
 * The cooldown enforcement is done in campaignScheduler.ts (checks optInCooldownUntil).
 */

import { prisma } from '../index';

/**
 * Process a PSA opt-in event for a contact.
 * Called from twilioWebhooks.ts after a Y/YES reply is detected.
 * 
 * @param tenantId - The tenant ID
 * @param contactId - The contact who replied Y
 * @param phone - The contact's phone number
 */
export async function processPsaOptIn(
  tenantId: string,
  contactId: string,
  phone: string
): Promise<{ promoted: boolean; segmentName?: string; cooldownHours?: number }> {
  try {
    // Find the most recent PSA campaign that sent a message to this contact
    const lastPsaMessage = await prisma.message.findFirst({
      where: {
        tenantId,
        contactId,
        direction: 'OUTBOUND',
        campaign: {
          type: 'PSA',
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            type: true,
            psaOptInSegmentId: true,
            psaOptInCooldownHours: true,
          },
        },
      },
    });

    if (!lastPsaMessage?.campaign) {
      // No PSA campaign found for this contact — standard opt-in flow applies
      console.log(`[PSA Workflow] No PSA campaign found for contact ${contactId}, skipping PSA promotion`);
      return { promoted: false };
    }

    const campaign = lastPsaMessage.campaign as any;

    if (!campaign.psaOptInSegmentId) {
      // PSA campaign exists but no opt-in segment configured — log and skip
      console.log(`[PSA Workflow] PSA campaign ${campaign.id} has no psaOptInSegmentId configured`);
      return { promoted: false };
    }

    // Add contact to the warm opt-in segment
    const segment = await prisma.segment.findUnique({
      where: { id: campaign.psaOptInSegmentId },
      select: { id: true, name: true },
    });

    if (!segment) {
      console.warn(`[PSA Workflow] Opt-in segment ${campaign.psaOptInSegmentId} not found for campaign ${campaign.id}`);
      return { promoted: false };
    }

    // Upsert segment membership (avoid duplicates)
    await prisma.segmentMember.upsert({
      where: {
        segmentId_contactId: {
          segmentId: segment.id,
          contactId,
        },
      },
      create: {
        segmentId: segment.id,
        contactId,
      },
      update: {},
    });

    // Set opt-in cooldown on the contact
    const cooldownHours = campaign.psaOptInCooldownHours ?? 24;
    const cooldownUntil = new Date(Date.now() + cooldownHours * 60 * 60 * 1000);
    
    await prisma.contact.update({
      where: { id: contactId },
      data: {
        optInCooldownUntil: cooldownUntil,
      } as any,
    });

    console.log(`[PSA Workflow] Contact ${phone} promoted to warm segment "${segment.name}" (cooldown until ${cooldownUntil.toISOString()})`);

    return {
      promoted: true,
      segmentName: segment.name,
      cooldownHours,
    };
  } catch (err: any) {
    console.error(`[PSA Workflow] Error processing PSA opt-in for contact ${contactId}:`, err.message);
    return { promoted: false };
  }
}

/**
 * Check if a contact is currently within their PSA opt-in cooldown period.
 * Used by campaignScheduler to block marketing sends during the cooldown.
 * 
 * @returns true if the contact is in cooldown (block the send)
 */
export async function isContactInOptInCooldown(contactId: string): Promise<boolean> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { optInCooldownUntil: true } as any,
  });

  const c = contact as any;
  if (!c?.optInCooldownUntil) return false;
  return new Date(c.optInCooldownUntil) > new Date();
}
