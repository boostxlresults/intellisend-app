import { prisma } from '../index';
import { checkSuppression } from '../twilio/twilioClient';
import { generateImprovedMessage } from '../ai/aiEngine';
import { getTenantSendContext, isWithinQuietHours } from './tenantSettings';
import { queueCampaignMessages } from './queueDispatcher';
import { normalizePhone } from '../utils/phoneNormalize';
import { sendDuplicateAlertEmail } from './emailNotifications';
import { filterSmsCapableContacts } from './phoneValidator';
import { isContactInOptInCooldown } from './psaOptInWorkflow';

const SCHEDULER_INTERVAL_MS = 60000;

// Safety: recover campaigns stuck in RUNNING state for more than 30 minutes
const STUCK_CAMPAIGN_TIMEOUT_MS = 30 * 60 * 1000;

// Safety: prevent overlapping scheduler runs
let schedulerRunning = false;

export function startCampaignScheduler() {
  console.log('Campaign scheduler started');
  
  setInterval(async () => {
    if (schedulerRunning) {
      console.warn('[Scheduler] Previous run still in progress, skipping this tick');
      return;
    }
    await processScheduledCampaigns();
  }, SCHEDULER_INTERVAL_MS);
  
  processScheduledCampaigns();
}

async function processScheduledCampaigns() {
  schedulerRunning = true;
  try {
    const now = new Date();

    // --- SAFETY: Recover campaigns stuck in RUNNING state ---
    const stuckCutoff = new Date(now.getTime() - STUCK_CAMPAIGN_TIMEOUT_MS);
    const stuckCampaigns = await prisma.campaign.findMany({
      where: {
        status: 'RUNNING',
        updatedAt: { lt: stuckCutoff },
      },
      select: { id: true, name: true },
    });
    for (const stuck of stuckCampaigns) {
      console.error(`[Scheduler] STUCK CAMPAIGN DETECTED: ${stuck.name} (${stuck.id}) has been RUNNING for >30 min. Resetting to SCHEDULED.`);
      await prisma.campaign.update({
        where: { id: stuck.id },
        data: { status: 'SCHEDULED' },
      });
    }
    
    const scheduledCampaigns = await prisma.campaign.findMany({
      where: {
        status: 'SCHEDULED',
        startAt: { lte: now },
        complianceConsentVerified: true,
        complianceOptOutIncluded: true,
        complianceQuietHoursOk: true,
        complianceContentReviewed: true,
      },
      include: {
        tenant: true,
        segment: {
          include: {
            members: {
              include: {
                contact: true,
              },
            },
          },
        },
        campaignSegments: {
          include: {
            segment: {
              include: {
                members: {
                  include: {
                    contact: true,
                  },
                },
              },
            },
          },
        },
        steps: {
          orderBy: { order: 'asc' },
        },
      },
    });
    
    for (const campaign of scheduledCampaigns) {
      // --- SAFETY: Isolate each campaign in its own try/catch so one bad campaign never crashes the scheduler ---
      try {
        await processSingleCampaign(campaign, now);
      } catch (campaignError: any) {
        console.error(`[Scheduler] CRITICAL ERROR processing campaign ${campaign.id} (${campaign.name}): ${campaignError.message}`);
        // Reset campaign to SCHEDULED so it can be retried on next tick
        try {
          await prisma.campaign.update({
            where: { id: campaign.id },
            data: { status: 'SCHEDULED' },
          });
          console.log(`[Scheduler] Reset campaign ${campaign.id} to SCHEDULED for retry`);
        } catch (resetError: any) {
          console.error(`[Scheduler] Failed to reset campaign ${campaign.id}: ${resetError.message}`);
        }
      }
    }
  } catch (error: any) {
    console.error('[Scheduler] Campaign scheduler error:', error.message);
  } finally {
    schedulerRunning = false;
  }
}

async function processSingleCampaign(campaign: any, now: Date) {
  console.log(`[Scheduler] Processing campaign: ${campaign.name} (${campaign.id})`);
  
  // Atomic claim: only proceed if we successfully change status from SCHEDULED to RUNNING
  const claimed = await prisma.campaign.updateMany({
    where: { 
      id: campaign.id, 
      status: 'SCHEDULED',
    },
    data: { status: 'RUNNING' },
  });
  
  if (claimed.count === 0) {
    console.log(`[Scheduler] Campaign ${campaign.id} already claimed by another process, skipping`);
    return;
  }
  
  const freshCampaign = await prisma.campaign.findUnique({ where: { id: campaign.id }, select: { status: true } });
  if (freshCampaign?.status === 'PAUSED' || freshCampaign?.status === 'COMPLETED') {
    console.log(`[Scheduler] Campaign ${campaign.id} was paused/completed after claim, skipping`);
    return;
  }
  
  const sendContext = await getTenantSendContext(campaign.tenantId);
  
  if (!sendContext) {
    console.warn(`[Scheduler] No phone number configured for tenant ${campaign.tenantId} - pausing campaign`);
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'PAUSED' },
    });
    return;
  }
  
  if (isWithinQuietHours(now, sendContext.timezone, sendContext.quietHoursStart, sendContext.quietHoursEnd)) {
    console.log(`[Scheduler] Quiet hours active for tenant ${campaign.tenantId} (${sendContext.timezone}), rescheduling campaign`);
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'SCHEDULED' },
    });
    return;
  }
  
  const allSegmentMembers: Array<{ contact: { id: string; phone: string; firstName: string; lastName: string } }> = [];
  
  if (campaign.campaignSegments && campaign.campaignSegments.length > 0) {
    for (const cs of campaign.campaignSegments) {
      if (cs.segment?.members) {
        allSegmentMembers.push(...cs.segment.members);
      }
    }
  } else if (campaign.segment) {
    allSegmentMembers.push(...campaign.segment.members);
  }
  
  if (allSegmentMembers.length === 0) {
    console.warn(`[Scheduler] Campaign ${campaign.id} has no segments or segment members`);
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'COMPLETED' },
    });
    return;
  }

  // --- HLR NUMBER VALIDATION (Feature 2) ---
  // Filter out landlines and disconnected numbers before queuing.
  // This prevents hard bounces that damage Twilio sender reputation and trigger carrier spam filters.
  // Results are cached on the Contact record for 90 days to minimize Twilio Lookup API costs.
  const allContactsForValidation = allSegmentMembers.map(m => ({
    id: m.contact.id,
    phone: normalizePhone(m.contact.phone),
  }));
  const { valid: validContacts, landlines: landlineContacts } = await filterSmsCapableContacts(
    campaign.tenantId,
    allContactsForValidation
  );
  if (landlineContacts.length > 0) {
    console.log(`[Scheduler] HLR: Blocked ${landlineContacts.length} landlines for campaign ${campaign.id}`);
  }
  const validPhoneSet = new Set(validContacts.map(c => c.phone));
  // Filter allSegmentMembers to only include validated mobile/voip numbers
  const validatedSegmentMembers = allSegmentMembers.filter(m =>
    validPhoneSet.has(normalizePhone(m.contact.phone))
  );
  
  const existingSentCount = await prisma.message.count({
    where: {
      tenantId: campaign.tenantId,
      campaignId: campaign.id,
    },
  });
  const existingQueuedCount = await prisma.outboundMessageQueue.count({
    where: {
      tenantId: campaign.tenantId,
      campaignId: campaign.id,
    },
  });
  const totalAlreadyProcessed = existingSentCount + existingQueuedCount;
  const uniquePhoneCount = new Set(validatedSegmentMembers.map(m => normalizePhone(m.contact.phone))).size;
  const maxAllowedMessages = uniquePhoneCount;
  
  if (totalAlreadyProcessed >= maxAllowedMessages) {
    console.error(`[Scheduler] SAFETY LIMIT: Campaign ${campaign.id} already has ${totalAlreadyProcessed} messages (sent+queued) for ${uniquePhoneCount} unique phones. Max allowed: ${maxAllowedMessages}. AUTO-PAUSING.`);
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'PAUSED' },
    });

    const tenantSettings = await prisma.tenantSettings.findUnique({
      where: { tenantId: campaign.tenantId },
      select: { notificationEmail: true },
    });
    if (tenantSettings?.notificationEmail) {
      sendDuplicateAlertEmail({
        toEmail: tenantSettings.notificationEmail,
        tenantName: campaign.tenant?.name || 'Unknown',
        campaignId: campaign.id,
        campaignName: campaign.name,
        duplicateCount: totalAlreadyProcessed - uniquePhoneCount,
        totalQueued: totalAlreadyProcessed,
        action: 'AUTO_PAUSED',
        source: 'scheduler',
      }).catch(err => console.error('[Email] Failed to send duplicate alert:', err));
    }

    return;
  }
  
  const firstStep = campaign.steps[0];
  if (!firstStep) {
    console.warn(`[Scheduler] Campaign ${campaign.id} has no steps`);
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'COMPLETED' },
    });
    return;
  }
  
  // --- PERFORMANCE FIX: Generate AI-improved message ONCE per campaign, not per contact ---
  // This prevents the AI API from being called thousands of times in a loop, which caused
  // the original runaway incident when the Replit agent timed out and restarted.
  let campaignMessageTemplate = firstStep.bodyTemplate;
  if (firstStep.useAiAssist) {
    try {
      console.log(`[Scheduler] Generating AI-improved message for campaign ${campaign.id} (applied to all contacts)`);
      const improved = await generateImprovedMessage({
        tenantId: campaign.tenantId,
        originalText: campaignMessageTemplate,
        goal: 'higher_reply_rate',
      });
      campaignMessageTemplate = improved.text;
      console.log(`[Scheduler] AI message generated successfully for campaign ${campaign.id}`);
    } catch (aiError: any) {
      console.error(`[Scheduler] AI message generation failed for campaign ${campaign.id}: ${aiError.message}. Using original template.`);
      // Fall back to original template — do NOT abort the campaign
    }
  }
  
  const messagesToQueue: Array<{
    contactId: string;
    phone: string;
    body: string;
    fromNumber: string;
    mediaUrl?: string;
    sendAsMms?: boolean;
  }> = [];
  
  let skippedCount = 0;
  let suppressedCount = 0;
  
  const excludedTagIds: string[] = (campaign as any).excludedTagIds || [];
  
  const allContactIds = allSegmentMembers.map(m => m.contact.id);
  let excludedContactIds = new Set<string>();
  if (excludedTagIds.length > 0) {
    const contactsWithExcludedTags = await prisma.contactTag.findMany({
      where: {
        contactId: { in: allContactIds },
        tagId: { in: excludedTagIds },
      },
      select: { contactId: true },
    });
    excludedContactIds = new Set(contactsWithExcludedTags.map(ct => ct.contactId));
  }
  
  const processedPhones = new Set<string>();
  
  const existingPhoneDeliveries = await prisma.message.findMany({
    where: {
      tenantId: campaign.tenantId,
      campaignId: campaign.id,
      campaignStepId: firstStep.id,
    },
    select: { toNumber: true },
  });
  existingPhoneDeliveries.forEach(m => processedPhones.add(normalizePhone(m.toNumber)));
  
  const queuedPhones = await prisma.outboundMessageQueue.findMany({
    where: {
      tenantId: campaign.tenantId,
      campaignId: campaign.id,
      campaignStepId: firstStep.id,
    },
    select: { phone: true },
  });
  queuedPhones.forEach(q => processedPhones.add(normalizePhone(q.phone)));
  
  const companyName = campaign.tenant.publicName || campaign.tenant.name || '';
  
  for (const member of validatedSegmentMembers) {
    const contact = member.contact;
    
    try {
      if (excludedContactIds.has(contact.id)) {
        skippedCount++;
        continue;
      }
      
      // Skip if phone number already processed (prevents duplicate sends to same phone via different contact records)
      const contactNormalizedPhone = normalizePhone(contact.phone);
      if (processedPhones.has(contactNormalizedPhone)) {
        skippedCount++;
        continue;
      }
      
      const isSuppressed = await checkSuppression(campaign.tenantId, contactNormalizedPhone);
      
      if (isSuppressed) {
        suppressedCount++;
        continue;
      }

      // --- PSA OPT-IN COOLDOWN CHECK (Feature 4) ---
      // Block marketing sends to contacts who just opted in via PSA.
      // The 24-hour cooldown ensures consent is fully established before marketing begins.
      if (campaign.type !== 'PSA') {
        const inCooldown = await isContactInOptInCooldown(contact.id);
        if (inCooldown) {
          skippedCount++;
          console.log(`[Scheduler] Contact ${contact.phone} in PSA opt-in cooldown, skipping for campaign ${campaign.id}`);
          continue;
        }
      }
      
      // Personalize the AI-improved template for this contact (no AI call per contact)
      let messageBody = campaignMessageTemplate
        .replace(/{{firstName}}/g, contact.firstName)
        .replace(/{{lastName}}/g, contact.lastName)
        .replace(/{{phone}}/g, contact.phone)
        .replace(/{{companyName}}/g, companyName);
      
      // --- PERIODIC OPT-OUT REMINDER INJECTION (Feature 3) ---
      // CTIA guidelines require opt-out reminders to be sent periodically to ongoing subscribers.
      // Standard: every 5th message. We count all SENT messages to this phone from this tenant.
      // On the 5th, 10th, 15th, etc. message, we append a more prominent opt-out reminder.
      // On all other messages, we append the standard STOP footer.
      const sentCountToContact = await prisma.messageEvent.count({
        where: { tenantId: campaign.tenantId, phone: contactNormalizedPhone, eventType: 'SENT' },
      });
      const isPeriodicReminderMessage = sentCountToContact > 0 && (sentCountToContact + 1) % 5 === 0;
      
      const lowerBody = messageBody.toLowerCase();
      const hasStopFooter = lowerBody.includes('reply stop') ||
                            lowerBody.includes('text stop') ||
                            lowerBody.includes('stop to unsubscribe') ||
                            lowerBody.includes('unsubscribe');
      if (!hasStopFooter) {
        if (isPeriodicReminderMessage) {
          // Prominent periodic reminder (CTIA compliance)
          messageBody = messageBody + '\n\nReminder: Reply STOP at any time to unsubscribe from all messages. Reply HELP for help.';
        } else {
          messageBody = messageBody + '\n\nReply STOP to unsubscribe.';
        }
      }
      
      messagesToQueue.push({
        contactId: contact.id,
        phone: contactNormalizedPhone,
        body: messageBody,
        fromNumber: sendContext.fromNumber,
        mediaUrl: (firstStep as any).mediaUrl || undefined,
        sendAsMms: (firstStep as any).sendAsMms || false,
      });
      
      processedPhones.add(contactNormalizedPhone);
    } catch (error: any) {
      console.error(`[Scheduler] Error preparing ${contact.phone}:`, error.message);
    }
  }
  
  if (messagesToQueue.length > 0) {
    const result = await queueCampaignMessages(
      campaign.tenantId,
      campaign.id,
      firstStep.id,
      messagesToQueue
    );
    console.log(`[Scheduler] Campaign ${campaign.name}: queued ${result.queued} messages, ${skippedCount} skipped, ${suppressedCount} suppressed`);
  } else {
    console.log(`[Scheduler] Campaign ${campaign.name}: no new messages to queue (${skippedCount} skipped, ${suppressedCount} suppressed)`);
  }
  
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: 'COMPLETED' },
  });
}
