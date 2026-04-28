import { prisma } from '../index';
import { sendSmsForTenant, checkSuppression } from '../twilio/twilioClient';
import { recordUsage } from '../routes/billing';
import { getTenantSendContext, isWithinQuietHours } from './tenantSettings';
import { sendDuplicateAlertEmail } from './emailNotifications';
import { isContactInQuietHours } from '../utils/contactTimezone';
import { buildOptimizedSendSchedule } from './sendTimeOptimizer';

const DISPATCHER_INTERVAL_MS = 5000;
const MAX_BATCH_SIZE = 50;
const DUPLICATE_ALERT_THRESHOLD = 3;

const campaignDuplicateCounts = new Map<string, number>();
const alertedCampaigns = new Set<string>();

// Safety: prevent overlapping dispatcher runs
let dispatcherRunning = false;

interface SendSettings {
  sendRatePerMinute: number;
  sendJitterMinMs: number;
  sendJitterMaxMs: number;
  rcsEnabled: boolean;
  rcsFallbackToSms: boolean;
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
    rcsEnabled: (settings as any)?.rcsEnabled ?? false,
    rcsFallbackToSms: (settings as any)?.rcsFallbackToSms ?? true,
  };
}

export function startQueueDispatcher() {
  console.log('Queue dispatcher started');

  setInterval(async () => {
    if (dispatcherRunning) {
      console.warn('[Dispatcher] Previous run still in progress, skipping this tick');
      return;
    }
    await processOutboundQueue();
  }, DISPATCHER_INTERVAL_MS);

  setInterval(() => {
    campaignDuplicateCounts.clear();
    alertedCampaigns.clear();
  }, 30 * 60 * 1000);

  processOutboundQueue();
}

async function processOutboundQueue() {
  dispatcherRunning = true;
  try {
    const now = new Date();

    const pausedCampaigns = await prisma.campaign.findMany({
      where: { status: 'PAUSED' },
      select: { id: true },
    });
    const pausedCampaignIds = new Set(pausedCampaigns.map(c => c.id));

    const pendingMessages = await prisma.outboundMessageQueue.findMany({
      where: {
        status: 'PENDING',
        processAfter: { lte: now },
      },
      orderBy: { processAfter: 'asc' },
      take: MAX_BATCH_SIZE,
    });

    const filteredMessages = pendingMessages.filter(msg => {
      if (msg.campaignId && pausedCampaignIds.has(msg.campaignId)) {
        return false;
      }
      return true;
    });

    if (filteredMessages.length < pendingMessages.length) {
      const pausedMsgIds = pendingMessages
        .filter(msg => msg.campaignId && pausedCampaignIds.has(msg.campaignId))
        .map(msg => msg.id);
      await prisma.outboundMessageQueue.updateMany({
        where: { id: { in: pausedMsgIds } },
        data: {
          status: 'FAILED',
          processedAt: new Date(),
          errorMessage: 'Campaign paused - message cancelled',
        },
      });
    }

    if (filteredMessages.length === 0) return;

    const tenantGroups = new Map<string, typeof filteredMessages>();
    for (const msg of filteredMessages) {
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

              const campaignKey = queueItem.campaignId;
              const dupCount = (campaignDuplicateCounts.get(campaignKey) || 0) + 1;
              campaignDuplicateCounts.set(campaignKey, dupCount);
              console.warn(`DUPLICATE DETECTED: ${queueItem.phone} for campaign ${campaignKey} (count: ${dupCount}/${DUPLICATE_ALERT_THRESHOLD})`);

              if (dupCount >= DUPLICATE_ALERT_THRESHOLD && !alertedCampaigns.has(campaignKey)) {
                alertedCampaigns.add(campaignKey);
                console.error(`DUPLICATE ANOMALY: Campaign ${campaignKey} hit ${dupCount} duplicates - AUTO-PAUSING`);

                await prisma.campaign.update({
                  where: { id: campaignKey },
                  data: { status: 'PAUSED' },
                });

                const remainingIds = messages.slice(i + 1)
                  .filter(m => m.campaignId === campaignKey)
                  .map(m => m.id);
                if (remainingIds.length > 0) {
                  await prisma.outboundMessageQueue.updateMany({
                    where: { id: { in: remainingIds }, status: 'PENDING' },
                    data: {
                      status: 'FAILED',
                      processedAt: new Date(),
                      errorMessage: 'Campaign auto-paused due to duplicate anomaly',
                    },
                  });
                }

                const campaignInfo = await prisma.campaign.findUnique({
                  where: { id: campaignKey },
                  select: { name: true, tenantId: true },
                });
                const tenantInfo = campaignInfo ? await prisma.tenant.findUnique({
                  where: { id: campaignInfo.tenantId },
                  select: { name: true },
                }) : null;
                const tenantSettings = campaignInfo ? await prisma.tenantSettings.findUnique({
                  where: { tenantId: campaignInfo.tenantId },
                  select: { notificationEmail: true },
                }) : null;
                if (tenantSettings?.notificationEmail) {
                  sendDuplicateAlertEmail({
                    toEmail: tenantSettings.notificationEmail,
                    tenantName: tenantInfo?.name || 'Unknown',
                    campaignId: campaignKey,
                    campaignName: campaignInfo?.name || 'Unknown',
                    duplicateCount: dupCount,
                    totalQueued: messages.length,
                    action: 'AUTO_PAUSED',
                    source: 'dispatcher',
                  }).catch(err => console.error('[Email] Failed to send duplicate alert:', err));
                }

                break;
              }

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

          // --- PER-CONTACT QUIET HOURS CHECK (Feature 1) ---
          // Check the contact's LOCAL timezone derived from their area code, not just the tenant timezone.
          // This ensures TCPA compliance for contacts in stricter-law states (FL 8PM, CT 8PM, TX 9PM).
          // AI conversation replies (conversationId set, no campaignId) are EXEMPT.
          if (queueItem.campaignId && !queueItem.conversationId) {
            const contactQuietCheck = isContactInQuietHours(queueItem.phone, sendContext?.timezone || 'America/Phoenix');
            if (contactQuietCheck.blocked) {
              const deferTime = contactQuietCheck.nextAllowedAt || new Date(Date.now() + 8 * 60 * 60 * 1000);
              await prisma.outboundMessageQueue.update({
                where: { id: queueItem.id },
                data: { status: 'PENDING', processAfter: deferTime },
              });
              await prisma.messageEvent.create({
                data: {
                  tenantId,
                  contactId: queueItem.contactId,
                  phone: queueItem.phone,
                  eventType: 'QUIET_HOURS_BLOCKED',
                  campaignId: queueItem.campaignId,
                  errorMessage: contactQuietCheck.reason,
                },
              });
              console.log(`[Dispatcher] Per-contact quiet hours blocked ${queueItem.phone}: ${contactQuietCheck.reason}`);
              continue;
            }
          }

          // --- GLOBAL FREQUENCY CAP CHECK (Feature 5) ---
          // Applies only to system-initiated campaign/sequence messages.
          // AI conversation replies and transactional messages (opt-in/opt-out confirmations) are EXEMPT.
          // Exempt signals: conversationId present with no campaignId = AI reply.
          const isSystemInitiated = !!queueItem.campaignId || !!queueItem.sequenceEnrollmentStepId;
          if (isSystemInitiated) {
            const tenantSettings = await prisma.tenantSettings.findUnique({
              where: { tenantId },
              select: { globalFreqCapWeekly: true, globalFreqCapDaily: true },
            });
            const weeklyCapLimit = (tenantSettings as any)?.globalFreqCapWeekly ?? 3;
            const dailyCapLimit = (tenantSettings as any)?.globalFreqCapDaily ?? 2;
            const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const [weeklyCount, dailyCount] = await Promise.all([
              prisma.messageEvent.count({
                where: { tenantId, phone: queueItem.phone, eventType: 'SENT', createdAt: { gte: oneWeekAgo } },
              }),
              prisma.messageEvent.count({
                where: { tenantId, phone: queueItem.phone, eventType: 'SENT', createdAt: { gte: oneDayAgo } },
              }),
            ]);
            if (weeklyCount >= weeklyCapLimit || dailyCount >= dailyCapLimit) {
              // Defer to next week window instead of dropping
              const nextWindow = new Date(oneWeekAgo.getTime() + 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
              await prisma.outboundMessageQueue.update({
                where: { id: queueItem.id },
                data: { status: 'PENDING', processAfter: nextWindow },
              });
              await prisma.messageEvent.create({
                data: {
                  tenantId,
                  contactId: queueItem.contactId,
                  phone: queueItem.phone,
                  eventType: 'RATE_LIMITED',
                  campaignId: queueItem.campaignId,
                  errorMessage: `Global frequency cap: ${weeklyCount}/${weeklyCapLimit} weekly, ${dailyCount}/${dailyCapLimit} daily`,
                },
              });
              console.log(`[Dispatcher] Frequency cap deferred ${queueItem.phone}: ${weeklyCount}/${weeklyCapLimit} weekly`);
              continue;
            }
          }

          // Skip rate limit for conversation replies (AI agent responses, direct replies)
          // Only apply rate limit to campaign/sequence messages
          const isConversationReply = !!queueItem.conversationId && !queueItem.campaignId && !queueItem.sequenceEnrollmentStepId;
          
          // Determine media URL - if sendAsMms is true but no image, use transparent pixel to force MMS
          let effectiveMediaUrl = queueItem.mediaUrl || undefined;
          if (queueItem.sendAsMms && !effectiveMediaUrl) {
            effectiveMediaUrl = 'https://upload.wikimedia.org/wikipedia/commons/c/ca/1x1.png';
          }
          
          // Determine if RCS should be attempted for this message.
          // RCS is only used for system-initiated campaign messages when enabled by the tenant.
          // AI conversation replies always use SMS for reliability.
          const useRcs = sendSettings.rcsEnabled && !!queueItem.campaignId && !queueItem.conversationId;

          const smsResult = await sendSmsForTenant({
            tenantId,
            fromNumber: queueItem.fromNumber,
            toNumber: queueItem.phone,
            body: queueItem.body,
            mediaUrl: effectiveMediaUrl,
            skipOptOutFooter: true, // Opt-out footer already added when queued
            skipRateLimitCheck: isConversationReply, // Don't rate limit active conversations
            preferRcs: useRcs, // Attempt RCS first, auto-fallback to SMS if device doesn't support it
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
    console.error('[Dispatcher] Queue dispatcher error:', error.message);
  } finally {
    dispatcherRunning = false;
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

  const duplicateCount = messages.length - deduplicatedMessages.length;
  if (duplicateCount > 0) {
    console.warn(`DUPLICATE WARNING: Filtered ${duplicateCount} duplicate phone numbers at queue time for campaign ${campaignId}`);
    
    if (duplicateCount >= DUPLICATE_ALERT_THRESHOLD) {
      console.error(`DUPLICATE ANOMALY at queue time: Campaign ${campaignId} tried to queue ${duplicateCount} duplicates - AUTO-PAUSING`);
      
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'PAUSED' },
      });

      const campaignInfo = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { name: true },
      });
      const tenantInfo = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      });
      const tenantSettings = await prisma.tenantSettings.findUnique({
        where: { tenantId },
        select: { notificationEmail: true },
      });
      if (tenantSettings?.notificationEmail) {
        sendDuplicateAlertEmail({
          toEmail: tenantSettings.notificationEmail,
          tenantName: tenantInfo?.name || 'Unknown',
          campaignId,
          campaignName: campaignInfo?.name || 'Unknown',
          duplicateCount,
          totalQueued: messages.length,
          action: 'AUTO_PAUSED',
          source: 'dispatcher',
        }).catch(err => console.error('[Email] Failed to send duplicate alert:', err));
      }

      return { queued: 0 };
    }
  }

  if (deduplicatedMessages.length === 0) {
    console.log(`Queue: All messages for campaign ${campaignId} already queued or sent, nothing to add`);
    return { queued: 0 };
  }

  // --- SEND-TIME OPTIMIZATION (Feature 6) ---
  // Build a personalized send schedule for each contact based on their reply history.
  // Contacts with engagement history get their message at their historically active hour.
  // Contacts with no history get the default send hour (10 AM local time).
  // This replaces the flat sequential delay with intelligent per-contact scheduling.
  const tenantSendContext = await getTenantSendContext(tenantId);
  const fallbackTz = tenantSendContext?.timezone || 'America/Phoenix';
  
  let optimizedSchedule: Map<string, Date> | null = null;
  try {
    optimizedSchedule = await buildOptimizedSendSchedule(
      tenantId,
      deduplicatedMessages.map(m => ({ id: m.contactId, phone: m.phone })),
      fallbackTz,
      sendSettings.sendJitterMinMs,
      sendSettings.sendJitterMaxMs
    );
    console.log(`[SendTimeOptimizer] Built optimized schedule for ${deduplicatedMessages.length} contacts in campaign ${campaignId}`);
  } catch (err: any) {
    console.error(`[SendTimeOptimizer] Failed to build schedule, falling back to sequential: ${err.message}`);
  }

  const queueItems = deduplicatedMessages.map((msg, index) => {
    let processAfter: Date;
    
    if (optimizedSchedule && optimizedSchedule.has(msg.contactId)) {
      // Use the contact's personalized optimal send time
      processAfter = optimizedSchedule.get(msg.contactId)!;
    } else {
      // Fallback: sequential delay with jitter
      const jitter = getRandomJitter(sendSettings.sendJitterMinMs, sendSettings.sendJitterMaxMs);
      processAfter = new Date(Date.now() + index * delayBetweenMessages + jitter);
    }

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
