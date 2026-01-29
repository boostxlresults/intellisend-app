import { prisma } from '../index';
import { syncServiceTitanContacts } from './serviceTitanContactSync';

const CHECK_INTERVAL_MS = 60000;

let lastSyncDate: string | null = null;

export function startNightlySyncScheduler() {
  console.log('Nightly ServiceTitan sync scheduler started');
  
  setInterval(async () => {
    await checkAndRunNightlySync();
  }, CHECK_INTERVAL_MS);
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
          console.log(`[Nightly Sync] Syncing tenant ${tenant.tenantId}`);
          const result = await syncServiceTitanContacts(tenant.tenantId);
          console.log(`[Nightly Sync] Tenant ${tenant.tenantId}: ${result.matchedContacts} matched, ${result.newlyTagged} newly tagged`);
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
