import { prisma } from '../index';
import { sendSmsForTenant, checkSuppression } from '../twilio/twilioClient';
import { generateImprovedMessage } from '../ai/aiEngine';
import { getTenantSendContext, isWithinQuietHours } from './tenantSettings';

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
        console.log(`Quiet hours active for tenant ${campaign.tenantId} (${sendContext.timezone}), skipping sends this run`);
        continue;
      }
      
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'RUNNING' },
      });
      
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
      
      let sentCount = 0;
      let suppressedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      let rateLimitedCount = 0;
      
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
            console.log(`Skipping ${contact.phone}: already sent campaign step ${firstStep.id}`);
            skippedCount++;
            continue;
          }
          
          const isSuppressed = await checkSuppression(campaign.tenantId, contact.phone);
          
          if (isSuppressed) {
            console.log(`SUPPRESSED: Skipping ${contact.phone} for campaign ${campaign.name}`);
            suppressedCount++;
            continue;
          }
          
          let messageBody = firstStep.bodyTemplate;
          
          messageBody = messageBody
            .replace(/{{firstName}}/g, contact.firstName)
            .replace(/{{lastName}}/g, contact.lastName)
            .replace(/{{phone}}/g, contact.phone);
          
          if (firstStep.useAiAssist) {
            const improved = await generateImprovedMessage({
              tenantId: campaign.tenantId,
              originalText: messageBody,
              goal: 'higher_reply_rate',
            });
            messageBody = improved.text;
          }
          
          let conversation = await prisma.conversation.findFirst({
            where: {
              tenantId: campaign.tenantId,
              contactId: contact.id,
              status: 'OPEN',
            },
          });
          
          if (!conversation) {
            conversation = await prisma.conversation.create({
              data: {
                tenantId: campaign.tenantId,
                contactId: contact.id,
                status: 'OPEN',
              },
            });
          }
          
          const smsResult = await sendSmsForTenant({
            tenantId: campaign.tenantId,
            fromNumber: sendContext.fromNumber,
            toNumber: contact.phone,
            body: messageBody,
          });
          
          if (smsResult.suppressed) {
            suppressedCount++;
            continue;
          }
          
          if (smsResult.rateLimited) {
            rateLimitedCount++;
            console.log(`Rate limited: ${contact.phone} for campaign ${campaign.name}`);
            continue;
          }
          
          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              tenantId: campaign.tenantId,
              contactId: contact.id,
              direction: 'OUTBOUND',
              channel: 'SMS',
              body: messageBody,
              fromNumber: sendContext.fromNumber,
              toNumber: contact.phone,
              twilioMessageSid: smsResult.messageSid,
              status: smsResult.success ? 'sent' : 'failed',
              errorCode: smsResult.error,
              isAiGenerated: firstStep.useAiAssist,
              campaignId: campaign.id,
              campaignStepId: firstStep.id,
            },
          });
          
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: new Date() },
          });
          
          await prisma.contact.update({
            where: { id: contact.id },
            data: { lastContactedAt: new Date() },
          });
          
          if (smsResult.success) {
            sentCount++;
            console.log(`Sent campaign message to ${contact.phone}`);
          } else {
            failedCount++;
            console.error(`Failed to send to ${contact.phone}: ${smsResult.error}`);
          }
        } catch (error: any) {
          failedCount++;
          console.error(`Error processing ${contact.phone}:`, error.message);
        }
      }
      
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'COMPLETED' },
      });
      
      console.log(`Campaign ${campaign.name} completed: ${sentCount} sent, ${suppressedCount} suppressed, ${rateLimitedCount} rate limited, ${skippedCount} already sent, ${failedCount} failed`);
    }
  } catch (error: any) {
    console.error('Campaign scheduler error:', error.message);
  }
}
