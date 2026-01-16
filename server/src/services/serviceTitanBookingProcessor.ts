import { prisma } from '../index';
import { buildConversationSummary } from './conversationSummary';
import { createBookingFromInboundSms } from './serviceTitanClient';

const LEASE_DURATION_MS = 60000;
const POLL_INTERVAL_MS = 5000;
const BACKOFF_BASE_MS = 30000;

let isRunning = false;

export function startServiceTitanBookingProcessor(): void {
  if (isRunning) {
    console.log('ServiceTitan booking processor already running');
    return;
  }
  
  isRunning = true;
  console.log('ServiceTitan booking processor started');
  processJobs();
}

export function stopServiceTitanBookingProcessor(): void {
  isRunning = false;
  console.log('ServiceTitan booking processor stopped');
}

async function processJobs(): Promise<void> {
  while (isRunning) {
    try {
      await processNextJob();
    } catch (error) {
      console.error('Error in ServiceTitan booking processor:', error);
    }
    
    await sleep(POLL_INTERVAL_MS);
  }
}

async function processNextJob(): Promise<void> {
  const now = new Date();
  const leaseExpiry = new Date(now.getTime() + LEASE_DURATION_MS);
  
  const job = await prisma.$queryRaw<any[]>`
    UPDATE "ServiceTitanBookingJob"
    SET 
      status = 'PROCESSING',
      "leaseExpiresAt" = ${leaseExpiry},
      attempts = attempts + 1,
      "updatedAt" = ${now}
    WHERE id = (
      SELECT id FROM "ServiceTitanBookingJob"
      WHERE (status = 'PENDING' OR (status = 'PROCESSING' AND "leaseExpiresAt" < ${now}))
        AND "nextRunAt" <= ${now}
        AND attempts < "maxAttempts"
      ORDER BY "nextRunAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;
  
  if (!job || job.length === 0) {
    return;
  }
  
  const jobRecord = job[0];
  console.log(`Processing ServiceTitan booking job ${jobRecord.id} (attempt ${jobRecord.attempts})`);
  
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: jobRecord.conversationId },
      select: { serviceTitanBookingId: true },
    });
    
    if (conversation?.serviceTitanBookingId) {
      await prisma.serviceTitanBookingJob.update({
        where: { id: jobRecord.id },
        data: {
          status: 'SUCCESS',
          bookingId: conversation.serviceTitanBookingId,
          leaseExpiresAt: null,
        },
      });
      console.log(`ServiceTitan booking job ${jobRecord.id} - conversation already has booking`);
      return;
    }
    
    const contact = await prisma.contact.findUnique({
      where: { id: jobRecord.contactId },
    });
    
    if (!contact) {
      await prisma.serviceTitanBookingJob.update({
        where: { id: jobRecord.id },
        data: {
          status: 'FAILED',
          errorMessage: 'Contact not found',
          leaseExpiresAt: null,
        },
      });
      return;
    }
    
    const summary = await buildConversationSummary(jobRecord.conversationId, 50, 4000);
    
    const campaignMessage = await prisma.message.findFirst({
      where: { 
        conversationId: jobRecord.conversationId,
        campaignId: { not: null },
      },
      include: { campaign: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    
    const frontendUrl = process.env.FRONTEND_URL || process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
      : null;
    
    const result = await createBookingFromInboundSms({
      tenantId: jobRecord.tenantId,
      messageSid: jobRecord.messageSid,
      contact: {
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        email: contact.email,
      },
      conversationId: jobRecord.conversationId,
      toNumber: jobRecord.toNumber,
      lastInboundMessage: jobRecord.messageBody,
      conversationSummary: summary,
      campaignName: campaignMessage?.campaign?.name || undefined,
      frontendUrl: frontendUrl || undefined,
    });
    
    if (result.success && result.bookingId) {
      const bookingIdStr = String(result.bookingId);
      await prisma.$transaction([
        prisma.serviceTitanBookingJob.update({
          where: { id: jobRecord.id },
          data: {
            status: 'SUCCESS',
            bookingId: bookingIdStr,
            leaseExpiresAt: null,
          },
        }),
        prisma.conversation.update({
          where: { id: jobRecord.conversationId },
          data: {
            serviceTitanBookingId: bookingIdStr,
            serviceTitanBookingCreatedAt: new Date(),
          },
        }),
      ]);
      console.log(`ServiceTitan booking created: ${bookingIdStr} for job ${jobRecord.id}`);
    } else {
      const shouldRetry = result.errorCode !== 'MISSING_SCOPE' && result.errorCode !== 'INVALID_TENANT';
      
      if (shouldRetry && jobRecord.attempts < jobRecord.maxAttempts) {
        const nextRun = new Date(Date.now() + BACKOFF_BASE_MS * jobRecord.attempts);
        await prisma.serviceTitanBookingJob.update({
          where: { id: jobRecord.id },
          data: {
            status: 'PENDING',
            leaseExpiresAt: null,
            nextRunAt: nextRun,
            errorMessage: `[${result.errorCode}] ${result.error}`,
          },
        });
        console.log(`ServiceTitan booking job ${jobRecord.id} - ${result.errorCode}: ${result.error}, rescheduled`);
      } else {
        await prisma.serviceTitanBookingJob.update({
          where: { id: jobRecord.id },
          data: {
            status: 'FAILED',
            leaseExpiresAt: null,
            errorMessage: `[${result.errorCode}] ${result.error}`,
          },
        });
        console.log(`ServiceTitan booking job ${jobRecord.id} - FAILED: ${result.errorCode}: ${result.error}`);
      }
    }
  } catch (error: any) {
    console.error(`ServiceTitan booking job ${jobRecord.id} failed:`, error);
    
    if (jobRecord.attempts >= jobRecord.maxAttempts) {
      await prisma.serviceTitanBookingJob.update({
        where: { id: jobRecord.id },
        data: {
          status: 'FAILED',
          errorMessage: error.message,
          leaseExpiresAt: null,
        },
      });
      console.log(`ServiceTitan booking job ${jobRecord.id} - max attempts reached, marked as FAILED`);
    } else {
      const nextRun = new Date(Date.now() + BACKOFF_BASE_MS * jobRecord.attempts);
      await prisma.serviceTitanBookingJob.update({
        where: { id: jobRecord.id },
        data: {
          status: 'PENDING',
          errorMessage: error.message,
          leaseExpiresAt: null,
          nextRunAt: nextRun,
        },
      });
      console.log(`ServiceTitan booking job ${jobRecord.id} - rescheduled for ${nextRun.toISOString()}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
