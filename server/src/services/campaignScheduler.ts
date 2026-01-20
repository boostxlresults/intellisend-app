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
      
      if (!campaign.segment) {
        console.warn(`Campaign ${campaign.id} has no segment`);
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
      }> = [];
      
      let skippedCount = 0;
      let suppressedCount = 0;
      
      for (const member of campaign.segment.members) {
        const contact = member.contact;
        
        try {
          const existingDelivery = await prisma.message.findFirst({
            where: {
              tenantId: campaign.tenantId,
              contactId: contact.id,
              campaignId: campaign.id,
              campaignStepId: firstStep.id,
            },
          });
          
          if (existingDelivery) {
            skippedCount++;
            continue;
          }
          
          const alreadyQueued = await prisma.outboundMessageQueue.findFirst({
            where: {
              tenantId: campaign.tenantId,
              contactId: contact.id,
              campaignId: campaign.id,
              campaignStepId: firstStep.id,
              status: { in: ['PENDING', 'PROCESSING'] },
            },
          });
          
          if (alreadyQueued) {
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
          });
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
