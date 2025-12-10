import { prisma } from '../index';
import { sendSmsForTenant } from '../twilio/twilioClient';
import { generateImprovedMessage } from '../ai/aiEngine';

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
      
      const defaultNumber = await prisma.tenantNumber.findFirst({
        where: { tenantId: campaign.tenantId, isDefault: true },
      });
      
      if (!defaultNumber) {
        console.warn(`No default number for tenant ${campaign.tenantId}`);
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
      
      for (const member of campaign.segment.members) {
        const contact = member.contact;
        
        try {
          const suppression = await prisma.suppression.findFirst({
            where: {
              tenantId: campaign.tenantId,
              phone: contact.phone,
            },
          });
          
          if (suppression) {
            console.log(`Skipping suppressed contact ${contact.phone} (reason: ${suppression.reason})`);
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
            fromNumber: defaultNumber.phoneNumber,
            toNumber: contact.phone,
            body: messageBody,
          });
          
          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              tenantId: campaign.tenantId,
              contactId: contact.id,
              direction: 'OUTBOUND',
              channel: 'SMS',
              body: messageBody,
              fromNumber: defaultNumber.phoneNumber,
              toNumber: contact.phone,
              twilioMessageSid: smsResult.messageSid,
              status: smsResult.success ? 'sent' : 'failed',
              errorCode: smsResult.error,
              isAiGenerated: firstStep.useAiAssist,
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
          
          console.log(`Sent campaign message to ${contact.phone}`);
        } catch (error: any) {
          console.error(`Failed to send to ${contact.phone}:`, error.message);
        }
      }
      
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'COMPLETED' },
      });
      
      console.log(`Campaign ${campaign.name} completed`);
    }
  } catch (error: any) {
    console.error('Campaign scheduler error:', error.message);
  }
}
