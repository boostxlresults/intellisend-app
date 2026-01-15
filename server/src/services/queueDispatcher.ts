import { prisma } from '../index';
import { sendSmsForTenant, checkSuppression } from '../twilio/twilioClient';
import { recordUsage } from '../routes/billing';

const DISPATCHER_INTERVAL_MS = 5000;
const MAX_BATCH_SIZE = 50;

interface SendSettings {
  sendRatePerMinute: number;
  sendJitterMinMs: number;
  sendJitterMaxMs: number;
}

function getRandomJitter(minMs: number, maxMs: number): number {
  const safeMin = Math.min(minMs, maxMs);
  const safeMax = Math.max(minMs, maxMs);
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

async function getTenantSendSettings(tenantId: string): Promise<SendSettings> {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
  });

  return {
    sendRatePerMinute: settings?.sendRatePerMinute ?? 30,
    sendJitterMinMs: settings?.sendJitterMinMs ?? 1000,
    sendJitterMaxMs: settings?.sendJitterMaxMs ?? 5000,
  };
}

export function startQueueDispatcher() {
  console.log('Queue dispatcher started');

  setInterval(async () => {
    await processOutboundQueue();
  }, DISPATCHER_INTERVAL_MS);

  processOutboundQueue();
}

async function processOutboundQueue() {
  try {
    const now = new Date();

    const pendingMessages = await prisma.outboundMessageQueue.findMany({
      where: {
        status: 'PENDING',
        processAfter: { lte: now },
      },
      orderBy: { processAfter: 'asc' },
      take: MAX_BATCH_SIZE,
    });

    if (pendingMessages.length === 0) return;

    const tenantGroups = new Map<string, typeof pendingMessages>();
    for (const msg of pendingMessages) {
      const group = tenantGroups.get(msg.tenantId) || [];
      group.push(msg);
      tenantGroups.set(msg.tenantId, group);
    }

    for (const [tenantId, messages] of tenantGroups) {
      const sendSettings = await getTenantSendSettings(tenantId);
      const delayBetweenMessages = 60000 / sendSettings.sendRatePerMinute;

      for (let i = 0; i < messages.length; i++) {
        const queueItem = messages[i];

        try {
          await prisma.outboundMessageQueue.update({
            where: { id: queueItem.id },
            data: { status: 'PROCESSING', attempts: queueItem.attempts + 1 },
          });

          const isSuppressed = await checkSuppression(tenantId, queueItem.phone);

          if (isSuppressed) {
            await prisma.outboundMessageQueue.update({
              where: { id: queueItem.id },
              data: {
                status: 'SUPPRESSED',
                processedAt: new Date(),
                errorMessage: 'Contact is suppressed',
              },
            });

            await prisma.messageEvent.create({
              data: {
                tenantId,
                contactId: queueItem.contactId,
                phone: queueItem.phone,
                eventType: 'SUPPRESSED',
                campaignId: queueItem.campaignId,
              },
            });

            continue;
          }

          const smsResult = await sendSmsForTenant({
            tenantId,
            fromNumber: queueItem.fromNumber,
            toNumber: queueItem.phone,
            body: queueItem.body,
            mediaUrl: queueItem.mediaUrl || undefined,
          });

          if (smsResult.rateLimited) {
            const jitter = getRandomJitter(sendSettings.sendJitterMinMs, sendSettings.sendJitterMaxMs);
            await prisma.outboundMessageQueue.update({
              where: { id: queueItem.id },
              data: {
                status: 'PENDING',
                processAfter: new Date(Date.now() + 60000 + jitter),
                errorMessage: 'Rate limited - will retry',
              },
            });
            continue;
          }

          if (smsResult.suppressed) {
            await prisma.outboundMessageQueue.update({
              where: { id: queueItem.id },
              data: {
                status: 'SUPPRESSED',
                processedAt: new Date(),
                errorMessage: 'Contact opted out',
              },
            });
            continue;
          }

          if (smsResult.success) {
            await prisma.outboundMessageQueue.update({
              where: { id: queueItem.id },
              data: {
                status: 'SENT',
                processedAt: new Date(),
                twilioSid: smsResult.messageSid,
              },
            });

            await recordUsage(tenantId, queueItem.mediaUrl ? 'mms' : 'sms');

            if (queueItem.sequenceEnrollmentStepId) {
              await prisma.sequenceEnrollmentStep.update({
                where: { id: queueItem.sequenceEnrollmentStepId },
                data: { sentAt: new Date() },
              });

              const enrollmentStep = await prisma.sequenceEnrollmentStep.findUnique({
                where: { id: queueItem.sequenceEnrollmentStepId },
                include: { enrollment: true },
              });

              if (enrollmentStep) {
                const allSteps = await prisma.sequenceEnrollmentStep.findMany({
                  where: { enrollmentId: enrollmentStep.enrollmentId },
                });

                const allSent = allSteps.every(s => s.sentAt || s.skipped);

                if (allSent) {
                  await prisma.sequenceEnrollment.update({
                    where: { id: enrollmentStep.enrollmentId },
                    data: { status: 'COMPLETED', completedAt: new Date() },
                  });
                }
              }
            }

            if (queueItem.campaignId && queueItem.campaignStepId) {
              let conversation = await prisma.conversation.findFirst({
                where: {
                  tenantId,
                  contactId: queueItem.contactId,
                  status: 'OPEN',
                },
              });

              if (!conversation) {
                conversation = await prisma.conversation.create({
                  data: {
                    tenantId,
                    contactId: queueItem.contactId,
                    status: 'OPEN',
                  },
                });
              }

              await prisma.message.create({
                data: {
                  conversationId: conversation.id,
                  tenantId,
                  contactId: queueItem.contactId,
                  direction: 'OUTBOUND',
                  channel: 'SMS',
                  body: queueItem.body,
                  fromNumber: queueItem.fromNumber,
                  toNumber: queueItem.phone,
                  twilioMessageSid: smsResult.messageSid,
                  status: 'sent',
                  campaignId: queueItem.campaignId,
                  campaignStepId: queueItem.campaignStepId,
                },
              });

              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { lastMessageAt: new Date() },
              });

              await prisma.contact.update({
                where: { id: queueItem.contactId },
                data: { lastContactedAt: new Date() },
              });
            }

            console.log(`Queue: Sent SMS to ${queueItem.phone}`);
          } else {
            await prisma.outboundMessageQueue.update({
              where: { id: queueItem.id },
              data: {
                status: 'FAILED',
                processedAt: new Date(),
                errorMessage: smsResult.error || 'Unknown error',
              },
            });

            console.error(`Queue: Failed to send to ${queueItem.phone}: ${smsResult.error}`);
          }
        } catch (error: any) {
          await prisma.outboundMessageQueue.update({
            where: { id: queueItem.id },
            data: {
              status: 'FAILED',
              processedAt: new Date(),
              errorMessage: error.message,
            },
          });
          console.error(`Queue error for ${queueItem.phone}:`, error.message);
        }

        if (i < messages.length - 1) {
          const jitter = getRandomJitter(sendSettings.sendJitterMinMs, sendSettings.sendJitterMaxMs);
          await new Promise((resolve) => setTimeout(resolve, delayBetweenMessages + jitter));
        }
      }
    }
  } catch (error: any) {
    console.error('Queue dispatcher error:', error.message);
  }
}

export async function queueCampaignMessages(
  tenantId: string,
  campaignId: string,
  campaignStepId: string,
  messages: Array<{
    contactId: string;
    phone: string;
    body: string;
    fromNumber: string;
  }>
): Promise<{ queued: number }> {
  const sendSettings = await getTenantSendSettings(tenantId);
  const delayBetweenMessages = 60000 / sendSettings.sendRatePerMinute;

  const queueItems = messages.map((msg, index) => {
    const jitter = getRandomJitter(sendSettings.sendJitterMinMs, sendSettings.sendJitterMaxMs);
    const processAfter = new Date(Date.now() + index * delayBetweenMessages + jitter);

    return {
      tenantId,
      campaignId,
      campaignStepId,
      contactId: msg.contactId,
      phone: msg.phone,
      body: msg.body,
      fromNumber: msg.fromNumber,
      status: 'PENDING' as const,
      processAfter,
    };
  });

  await prisma.outboundMessageQueue.createMany({
    data: queueItems,
  });

  console.log(`Queued ${queueItems.length} messages for campaign ${campaignId} with jitter spacing`);

  return { queued: queueItems.length };
}
