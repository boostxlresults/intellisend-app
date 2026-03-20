import { prisma } from '../index';
import { getServiceTitanConfig, getServiceTitanToken } from './serviceTitanClient';

export async function syncServiceTitanRevenue(tenantId: string) {
  console.log(`[ServiceTitan Revenue Sync] Starting for tenant ${tenantId}`);
  
  const config = await getServiceTitanConfig(tenantId);
  if (!config || !config.enabled) {
    console.log(`[ServiceTitan Revenue Sync] Tenant ${tenantId} not configured or disabled`);
    return { success: false, reason: 'not_configured' };
  }

  const accessToken = await getServiceTitanToken({
    tenantApiBaseUrl: config.tenantApiBaseUrl,
    serviceTitanTenantId: config.serviceTitanTenantId,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });

  if (!accessToken) {
    console.error(`[ServiceTitan Revenue Sync] Failed to get access token for tenant ${tenantId}`);
    return { success: false, reason: 'auth_failed' };
  }

  // Find all conversations with a booking ID but no job ID, or with a job ID but no revenue
  // We only check conversations from the last 90 days to avoid scanning ancient history
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const pendingConversations = await prisma.conversation.findMany({
    where: {
      tenantId,
      serviceTitanBookingId: { not: null },
      serviceTitanRevenue: null,
      serviceTitanBookingCreatedAt: { gte: ninetyDaysAgo }
    },
    include: {
      messages: {
        where: { campaignId: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { campaignId: true }
      }
    }
  });

  console.log(`[ServiceTitan Revenue Sync] Found ${pendingConversations.length} pending conversations to check`);

  let updatedCount = 0;
  let revenueFound = 0;

  for (const conv of pendingConversations) {
    try {
      const campaignId = conv.messages[0]?.campaignId;
      if (!campaignId) continue; // Only track revenue for campaign-driven conversations

      let jobId = conv.serviceTitanJobId;

      // 1. If we have a booking but no job ID, check if the booking turned into a job
      if (!jobId && conv.serviceTitanBookingId) {
        const bookingUrl = `${config.tenantApiBaseUrl}/crm/v2/tenant/${config.serviceTitanTenantId}/bookings/${conv.serviceTitanBookingId}`;
        const bookingRes = await fetch(bookingUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'ST-App-Key': config.appKey,
          }
        });

        if (bookingRes.ok) {
          const bookingData = await bookingRes.json() as any;
          if (bookingData.jobId) {
            jobId = String(bookingData.jobId);
            await prisma.conversation.update({
              where: { id: conv.id },
              data: { serviceTitanJobId: jobId }
            });
            console.log(`[ServiceTitan Revenue Sync] Found Job ID ${jobId} for Booking ${conv.serviceTitanBookingId}`);
          }
        }
      }

      // 2. If we have a job ID, check its status and invoices
      if (jobId) {
        const jobUrl = `${config.tenantApiBaseUrl}/jpm/v2/tenant/${config.serviceTitanTenantId}/jobs/${jobId}`;
        const jobRes = await fetch(jobUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'ST-App-Key': config.appKey,
          }
        });

        if (jobRes.ok) {
          const jobData = await jobRes.json() as any;
          
          // Only pull revenue if the job is Completed
          if (jobData.status === 'Completed') {
            const invoiceUrl = `${config.tenantApiBaseUrl}/accounting/v2/tenant/${config.serviceTitanTenantId}/invoices?jobId=${jobId}`;
            const invoiceRes = await fetch(invoiceUrl, {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'ST-App-Key': config.appKey,
              }
            });

            if (invoiceRes.ok) {
              const invoiceData = await invoiceRes.json() as any;
              let totalRevenue = 0;
              
              if (invoiceData.data && invoiceData.data.length > 0) {
                // Sum up all invoice totals for this job
                for (const invoice of invoiceData.data) {
                  totalRevenue += (invoice.total || 0);
                }
              }

              if (totalRevenue > 0) {
                // Update Conversation
                await prisma.conversation.update({
                  where: { id: conv.id },
                  data: { serviceTitanRevenue: totalRevenue }
                });

                // Update Campaign Totals
                await prisma.campaign.update({
                  where: { id: campaignId },
                  data: {
                    totalBookings: { increment: 1 },
                    totalRevenue: { increment: totalRevenue }
                  }
                });

                console.log(`[ServiceTitan Revenue Sync] Attributed $${totalRevenue} to Campaign ${campaignId} from Job ${jobId}`);
                updatedCount++;
                revenueFound += totalRevenue;
              }
            }
          } else if (jobData.status === 'Canceled') {
            // If canceled, mark revenue as 0 so we stop checking it
            await prisma.conversation.update({
              where: { id: conv.id },
              data: { serviceTitanRevenue: 0 }
            });
          }
        }
      }
      
      // Sleep slightly to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`[ServiceTitan Revenue Sync] Error processing conversation ${conv.id}:`, error);
    }
  }

  console.log(`[ServiceTitan Revenue Sync] Completed. Updated ${updatedCount} jobs, total revenue found: $${revenueFound}`);
  return { success: true, updatedCount, revenueFound };
}
