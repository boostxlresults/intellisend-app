import { Router } from 'express';
import { prisma } from '../index';
import { getMirrorTenantId, isMirrorConfigured } from '../services/mirror/mirrorClient';
import { runMirrorAudienceSync } from '../services/mirror/mirrorAudienceSync';

const router = Router();

/** Status of the ServiceTitan mirror sync for a tenant, plus the last 10 runs. */
router.get('/:tenantId/mirror-sync/status', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const configured = isMirrorConfigured();
    const managesTenant = configured && getMirrorTenantId() === tenantId;

    const runs = await prisma.mirrorSyncRun.findMany({
      where: { tenantId },
      orderBy: { startedAt: 'desc' },
      take: 10,
    });
    const managedContacts = await prisma.contact.count({
      where: { tenantId, stCustomerId: { not: null } },
    });
    const systemTags = await prisma.tag.findMany({
      where: { tenantId, isSystem: true },
      select: { id: true, name: true, _count: { select: { contacts: true } } },
      orderBy: { name: 'asc' },
    });

    res.json({
      configured,
      managesTenant,
      enabled: managesTenant && process.env.MIRROR_SYNC_ENABLED !== 'false',
      managedContacts,
      runs,
      systemTags: systemTags.map((t) => ({ id: t.id, name: t.name, contactCount: t._count.contacts })),
    });
  } catch (error: any) {
    console.error('Error fetching mirror sync status:', error);
    res.status(500).json({ error: error.message });
  }
});

/** Start a sync now. Returns immediately; poll /status for the result. */
router.post('/:tenantId/mirror-sync/run', async (req, res) => {
  try {
    const { tenantId } = req.params;
    if (!isMirrorConfigured() || getMirrorTenantId() !== tenantId) {
      return res.status(400).json({ error: 'The ServiceTitan mirror sync is not configured for this account.' });
    }
    runMirrorAudienceSync(tenantId, 'manual').then((r) => {
      if (r.skipped) console.log(`[Mirror Sync] Manual run skipped: ${r.skipped}`);
    });
    res.status(202).json({ started: true });
  } catch (error: any) {
    console.error('Error starting mirror sync:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
