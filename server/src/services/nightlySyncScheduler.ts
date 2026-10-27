import { prisma } from '../index';
import { syncServiceTitanContacts } from './serviceTitanContactSync';
import { syncServiceTitanRevenue } from './serviceTitanRevenueSync';
import { getMirrorTenantId, isMirrorConfigured } from './mirror/mirrorClient';
import { runMirrorAudienceSync } from './mirror/mirrorAudienceSync';

const CHECK_INTERVAL_MS = 60000;
/** Minute past each hour the mirror sync starts. Offset from :00 to avoid the top-of-hour rush. */
const MIRROR_SYNC_MINUTE = Number(process.env.MIRROR_SYNC_MINUTE ?? 7);

let lastSyncDate: string | null = null;
let lastMirrorHour: string | null = null;

function mirrorSyncEnabled(): boolean {
  return isMirrorConfigured() && !!getMirrorTenantId() && process.env.MIRROR_SYNC_ENABLED !== 'false';
}

export function startNightlySyncScheduler() {
  console.log('Nightly ServiceTitan sync scheduler started');
  if (mirrorSyncEnabled()) {
    console.log(`[Mirror Sync] Hourly ServiceTitan mirror sync enabled for tenant ${getMirrorTenantId()} at :${String(MIRROR_SYNC_MINUTE).padStart(2, '0')}`);
  }

  setInterval(async () => {
    await checkAndRunHourlyMirrorSync();
    await checkAndRunNightlySync();
  }, CHECK_INTERVAL_MS);
}

async function checkAndRunHourlyMirrorSync() {
  if (!mirrorSyncEnabled()) return;
  const now = new Date();
  const hourKey = now.toISOString().slice(0, 13);
  if (now.getMinutes() < MIRROR_SYNC_MINUTE || lastMirrorHour === hourKey) return;
  lastMirrorHour = hourKey;
  try {
    const result = await runMirrorAudienceSync(getMirrorTenantId()!, 'scheduled');
    if (result.skipped) console.log(`[Mirror Sync] Skipped: ${result.skipped}`);
  } catch (error) {
    console.error('[Mirror Sync] Unexpected error:', error);
  }
}

async function checkAndRunNightlySync() {
  try {
    const now = new Date();
    const currentHour = now.getHours();
    const currentDate = now.toISOString().split('T')[0];

    if (currentHour === 0 && lastSyncDate !== currentDate) {
      console.log(`[Nightly Sync] Starting nightly ServiceTitan sync at ${now.toISOString()}`);
      lastSyncDate = currentDate;

      const tenants = await prisma.serviceTitanConfig.findMany({
        where: { enabled: true },
        select: { tenantId: true },
      });

      console.log(`[Nightly Sync] Found ${tenants.length} tenants with ServiceTitan enabled`);

      for (const tenant of tenants) {
        try {
          // The mirror sync owns contacts and tags for its tenant. Running the
          // older API-based import as well would re-add tags the mirror removed.
          if (mirrorSyncEnabled() && tenant.tenantId === getMirrorTenantId()) {
            console.log(`[Nightly Sync] Tenant ${tenant.tenantId}: contacts managed by mirror sync, skipping API contact import`);
          } else {
            console.log(`[Nightly Sync] Syncing contacts for tenant ${tenant.tenantId}`);
            const result = await syncServiceTitanContacts(tenant.tenantId);
            console.log(`[Nightly Sync] Tenant ${tenant.tenantId}: ${result.matchedContacts} matched, ${result.newlyTagged} newly tagged`);
          }

          console.log(`[Nightly Sync] Syncing revenue for tenant ${tenant.tenantId}`);
          const revenueResult = await syncServiceTitanRevenue(tenant.tenantId);
          if (revenueResult.success) {
            console.log(`[Nightly Sync] Tenant ${tenant.tenantId} revenue: ${revenueResult.updatedCount} jobs updated, $${revenueResult.revenueFound} found`);
          }
        } catch (error) {
          console.error(`[Nightly Sync] Error syncing tenant ${tenant.tenantId}:`, error);
        }

        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      console.log(`[Nightly Sync] Completed nightly sync for all tenants`);
    }
  } catch (error) {
    console.error('[Nightly Sync] Error in nightly sync scheduler:', error);
  }
}
