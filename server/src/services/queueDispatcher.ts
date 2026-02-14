import { prisma } from '../index';
import { sendSmsForTenant, checkSuppression } from '../twilio/twilioClient';
import { recordUsage } from '../routes/billing';
import { getTenantSendContext, isWithinQuietHours } from './tenantSettings';

const DISPATCHER_INTERVAL_MS = 5000;
const MAX_BATCH_SIZE = 50;

interface SendSettings {
  sendRatePerMinute: number;
  sendJitterMinMs: number;
  sendJitterMaxMs: number;
}

function getQuietHoursEndTime(timezone: string, quietHoursEndMinutes: number): Date {
  const now = new Date();
  const endHour = Math.floor(quietHoursEndMinutes / 60);
  const endMinute = quietHoursEndMinutes % 60;

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(now);
    const localHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const localMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    const localMinutes = localHour * 60 + localMinute;

    let minutesUntilEnd: number;
    if (localMinutes < quietHoursEndMinutes) {
      minutesUntilEnd = quietHoursEndMinutes - localMinutes;
    } else {
      minutesUntilEnd = (24 * 60 - localMinutes) + quietHoursEndMinutes;
    }

    return new Date(now.getTime() + minutesUntilEnd * 60 * 1000 + 60000);
  } catch {
    return new Date(now.getTime() + 8 * 60 * 60 * 1000);
  }
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

      const sendContext = await getTenantSendContext(tenantId);
      if (sendContext && isWithinQuietHours(new Date(), sendContext.timezone, sendContext.quietHoursStart, sendContext.quietHoursEnd)) {
        const deferTime = getQuietHoursEndTime(sendContext.timezone, sendContext.quietHoursEnd);
        const messageIds = messages.map(m => m.id);
        await prisma.outboundMessageQueue.updateMany({
          where: { id: { in: messageIds }, status: 'PENDING' },
          data: { processAfter: deferTime },
        });
        for (const msg of messages) {
          await prisma.messageEvent.create({
            data: {
              tenantId,
              contactId: msg.contactId,
              phone: msg.phone,
              eventType: 'QUIET_HOURS_BLOCKED',
              campaignId: msg.campaignId,
            },
          });
        }
        console.log(`Queue dispatcher: Quiet hours active for tenant ${tenantId}, deferred ${messages.length} messages until ${deferTime.toISOString()}`);
        continue;
      }

      for (let i = 0; i < messages.length; i++) {
        const queueItem = messages[i];

        try {
          if (sendContext && isWithinQuietHours(new Date(), sendContext.timezone, sendContext.quietHoursStart, sendContext.quietHoursEnd)) {
            const deferTime = getQuietHoursEndTime(sendContext.timezone, sendContext.quietHoursEnd);
            const remainingIds = messages.slice(i).map(m => m.id);
            await prisma.outboundMessageQueue.updateMany({
              where: { id: { in: remainingIds }, status: 'PENDING' },
              data: { processAfter: deferTime },
            });
            console.log(`Queue dispatcher: Quiet hours started mid-batch for tenant ${tenantId}, deferred ${remainingIds.length} remaining messages until ${deferTime.toISOString()}`);
            break;
          }

          await prisma.outboundMessageQueue.update({
            where: { id: queueItem.id },
            data: { status: 'PROCESSING', attempts: queueItem.attempts + 1 },
          });

          if (queueItem.campaignId && queueItem.campaignStepId) {
            const alreadySentForPhone = await prisma.message.findFirst({
              where: {
                tenantId,
                campaignId: queueItem.campaignId,
                campaignStepId: queueItem.campaignStepId,
                toNumber: queueItem.phone,
              },
            });
            if (alreadySentForPhone) {
              await prisma.outboundMessageQueue.update({
                where: { id: queueItem.id },
                data: {
                  status: 'SUPPRESSED',
                  processedAt: new Date(),
                  errorMessage: 'Duplicate - already sent to this phone for this campaign step',
                },
              });
              console.log(`Queue: Skipped duplicate send to ${queueItem.phone} for campaign ${queueItem.campaignId}`);
              continue;
            }
          }

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

          // Skip rate limit for conversation replies (AI agent responses, direct replies)
          // Only apply rate limit to campaign/sequence messages
          const isConversationReply = !!queueItem.conversationId && !queueItem.campaignId && !queueItem.sequenceEnrollmentStepId;
          
          // Determine media URL - if sendAsMms is true but no image, use transparent pixel to force MMS
          let effectiveMediaUrl = queueItem.mediaUrl || undefined;
          if (queueItem.sendAsMms && !effectiveMediaUrl) {
            effectiveMediaUrl = 'https://upload.wikimedia.org/wikipedia/commons/c/ca/1x1.png';
          }
          
          const smsResult = await sendSmsForTenant({
            tenantId,
            fromNumber: queueItem.fromNumber,
            toNumber: queueItem.phone,
            body: queueItem.body,
            mediaUrl: effectiveMediaUrl,
            skipOptOutFooter: true, // Opt-out footer already added when queued
            skipRateLimitCheck: isConversationReply, // Don't rate limit active conversations
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

            await recordUsage(tenantId, (queueItem.mediaUrl || queueItem.sendAsMms) ? 'mms' : 'sms');

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

            // Always save message to conversation (for campaigns, AI agent, and direct sends)
            let conversation = queueItem.conversationId 
              ? await prisma.conversation.findUnique({ where: { id: queueItem.conversationId } })
              : await prisma.conversation.findFirst({
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
    mediaUrl?: string;
    sendAsMms?: boolean;
  }>
): Promise<{ queued: number }> {
  const sendSettings = await getTenantSendSettings(tenantId);
  const delayBetweenMessages = 60000 / sendSettings.sendRatePerMinute;

  const alreadyQueued = await prisma.outboundMessageQueue.findMany({
    where: {
      tenantId,
      campaignId,
      campaignStepId,
      status: { in: ['PENDING', 'PROCESSING', 'SENT'] },
    },
    select: { phone: true },
  });
  const alreadyQueuedPhones = new Set(alreadyQueued.map(q => q.phone));

  const alreadySent = await prisma.message.findMany({
    where: {
      tenantId,
      campaignId,
      campaignStepId,
    },
    select: { toNumber: true },
  });
  alreadySent.forEach(m => alreadyQueuedPhones.add(m.toNumber));

  const deduplicatedMessages = messages.filter(msg => !alreadyQueuedPhones.has(msg.phone));

  if (deduplicatedMessages.length < messages.length) {
    console.log(`Queue: Filtered ${messages.length - deduplicatedMessages.length} duplicate phone numbers for campaign ${campaignId}`);
  }

  if (deduplicatedMessages.length === 0) {
    console.log(`Queue: All messages for campaign ${campaignId} already queued or sent, nothing to add`);
    return { queued: 0 };
  }

  const queueItems = deduplicatedMessages.map((msg, index) => {
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
      mediaUrl: msg.mediaUrl || undefined,
      sendAsMms: msg.sendAsMms || false,
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
