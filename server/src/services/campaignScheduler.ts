import { prisma } from '../index';
import { checkSuppression } from '../twilio/twilioClient';
import { generateImprovedMessage } from '../ai/aiEngine';
import { getTenantSendContext, isWithinQuietHours } from './tenantSettings';
import { queueCampaignMessages } from './queueDispatcher';

const SCHEDULER_INTERVAL_MS = 60000;

export function startCampaignScheduler() {
  console.log('Campaign scheduler started');
  
  setInterval(async () => {
    await processScheduledCampaigns();
  }, SCHEDULER_INTERVAL_MS);
  
  processScheduledCampaigns();
}

async function processScheduledCampaigns() {
  try {
    const now = new Date();
    
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
      console.log(`Processing campaign: ${campaign.name} (${campaign.id})`);
      
      // Atomic claim: only proceed if we successfully change status from SCHEDULED to RUNNING
      const claimed = await prisma.campaign.updateMany({
        where: { 
          id: campaign.id, 
          status: 'SCHEDULED',
        },
        data: { status: 'RUNNING' },
      });
      
      if (claimed.count === 0) {
        console.log(`Campaign ${campaign.id} already claimed by another process, skipping`);
        continue;
      }
      
      const freshCampaign = await prisma.campaign.findUnique({ where: { id: campaign.id }, select: { status: true } });
      if (freshCampaign?.status === 'PAUSED' || freshCampaign?.status === 'COMPLETED') {
        console.log(`Campaign ${campaign.id} was paused/completed after claim, skipping`);
        continue;
      }
      
      const sendContext = await getTenantSendContext(campaign.tenantId);
      
      if (!sendContext) {
        console.warn(`No phone number configured for tenant ${campaign.tenantId} - pausing campaign`);
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: 'PAUSED' },
        });
        continue;
      }
      
      if (isWithinQuietHours(now, sendContext.timezone, sendContext.quietHoursStart, sendContext.quietHoursEnd)) {
        console.log(`Quiet hours active for tenant ${campaign.tenantId} (${sendContext.timezone}), rescheduling campaign`);
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: 'SCHEDULED' },
        });
        continue;
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
        console.warn(`Campaign ${campaign.id} has no segments or segment members`);
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: 'COMPLETED' },
        });
        continue;
      }
      
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
      const uniquePhoneCount = new Set(allSegmentMembers.map(m => m.contact.phone)).size;
      const maxAllowedMessages = uniquePhoneCount;
      
      if (totalAlreadyProcessed >= maxAllowedMessages) {
        console.error(`SAFETY LIMIT: Campaign ${campaign.id} already has ${totalAlreadyProcessed} messages (sent+queued) for ${uniquePhoneCount} unique phones. Max allowed: ${maxAllowedMessages}. Marking COMPLETED.`);
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: 'COMPLETED' },
        });
        continue;
      }
      
      const firstStep = campaign.steps[0];
      if (!firstStep) {
        console.warn(`Campaign ${campaign.id} has no steps`);
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: 'COMPLETED' },
        });
        continue;
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
      existingPhoneDeliveries.forEach(m => processedPhones.add(m.toNumber));
      
      const queuedPhones = await prisma.outboundMessageQueue.findMany({
        where: {
          tenantId: campaign.tenantId,
          campaignId: campaign.id,
          campaignStepId: firstStep.id,
        },
        select: { phone: true },
      });
      queuedPhones.forEach(q => processedPhones.add(q.phone));
      
      for (const member of allSegmentMembers) {
        const contact = member.contact;
        
        try {
          if (excludedContactIds.has(contact.id)) {
            skippedCount++;
            continue;
          }
          
          // Skip if phone number already processed (prevents duplicate sends to same phone via different contact records)
          if (processedPhones.has(contact.phone)) {
            skippedCount++;
            continue;
          }
          
          const isSuppressed = await checkSuppression(campaign.tenantId, contact.phone);
          
          if (isSuppressed) {
            suppressedCount++;
            continue;
          }
          
          let messageBody = firstStep.bodyTemplate;
          
          const companyName = campaign.tenant.publicName || campaign.tenant.name || '';
          
          messageBody = messageBody
            .replace(/{{firstName}}/g, contact.firstName)
            .replace(/{{lastName}}/g, contact.lastName)
            .replace(/{{phone}}/g, contact.phone)
            .replace(/{{companyName}}/g, companyName);
          
          if (firstStep.useAiAssist) {
            const improved = await generateImprovedMessage({
              tenantId: campaign.tenantId,
              originalText: messageBody,
              goal: 'higher_reply_rate',
            });
            messageBody = improved.text;
          }
          
          messagesToQueue.push({
            contactId: contact.id,
            phone: contact.phone,
            body: messageBody,
            fromNumber: sendContext.fromNumber,
            mediaUrl: (firstStep as any).mediaUrl || undefined,
            sendAsMms: (firstStep as any).sendAsMms || false,
          });
          
          // Mark phone as processed to prevent duplicates from other contact records
          processedPhones.add(contact.phone);
        } catch (error: any) {
          console.error(`Error preparing ${contact.phone}:`, error.message);
        }
      }
      
      if (messagesToQueue.length > 0) {
        const result = await queueCampaignMessages(
          campaign.tenantId,
          campaign.id,
          firstStep.id,
          messagesToQueue
        );
        console.log(`Campaign ${campaign.name}: queued ${result.queued} messages, ${skippedCount} skipped, ${suppressedCount} suppressed`);
      } else {
        console.log(`Campaign ${campaign.name}: no new messages to queue (${skippedCount} skipped, ${suppressedCount} suppressed)`);
      }
      
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'COMPLETED' },
      });
    }
  } catch (error: any) {
    console.error('Campaign scheduler error:', error.message);
  }
}
