import { Router } from 'express';
import { prisma } from '../index';
import { testServiceTitanConnection } from '../services/serviceTitanClient';

const router = Router();

router.get('/:tenantId/servicetitan-config', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const config = await prisma.serviceTitanConfig.findUnique({
      where: { tenantId },
    });
    
    if (!config) {
      return res.json(null);
    }
    
    res.json({
      id: config.id,
      tenantId: config.tenantId,
      tenantApiBaseUrl: config.tenantApiBaseUrl,
      serviceTitanTenantId: config.serviceTitanTenantId,
      appKey: config.appKey,
      clientId: config.clientId,
      bookingProvider: config.bookingProvider,
      bookingProviderId: config.bookingProviderId,
      enabled: config.enabled,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    });
  } catch (error: any) {
    console.error('Error fetching ServiceTitan config:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/servicetitan-config', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const {
      tenantApiBaseUrl,
      serviceTitanTenantId,
      appKey,
      clientId,
      clientSecret,
      bookingProvider,
      enabled,
    } = req.body;
    
    const existing = await prisma.serviceTitanConfig.findUnique({
      where: { tenantId },
    });
    
    const newSecret = clientSecret || existing?.clientSecret || '';
    const newAppKey = appKey || existing?.appKey || '';
    
    if (enabled === true) {
      if (!tenantApiBaseUrl || !serviceTitanTenantId || !clientId) {
        return res.status(400).json({
          error: 'API Base URL, ServiceTitan Tenant ID, and Client ID are required when enabling the integration',
        });
      }
      if (!newSecret) {
        return res.status(400).json({
          error: 'Client Secret is required when enabling the integration',
        });
      }
      if (!newAppKey) {
        return res.status(400).json({
          error: 'App Key is required when enabling the integration',
        });
      }
    }
    
    const updateData = {
      tenantApiBaseUrl: tenantApiBaseUrl || existing?.tenantApiBaseUrl || '',
      serviceTitanTenantId: serviceTitanTenantId || existing?.serviceTitanTenantId || '',
      appKey: newAppKey,
      clientId: clientId || existing?.clientId || '',
      clientSecret: newSecret,
      bookingProvider: bookingProvider || existing?.bookingProvider || 'IntelliSend-SMS',
      bookingProviderId: req.body.bookingProviderId || existing?.bookingProviderId || null,
      enabled: enabled ?? existing?.enabled ?? false,
    };
    
    const config = await prisma.serviceTitanConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        ...updateData,
      },
      update: updateData,
    });
    
    res.json({
      id: config.id,
      tenantId: config.tenantId,
      tenantApiBaseUrl: config.tenantApiBaseUrl,
      serviceTitanTenantId: config.serviceTitanTenantId,
      appKey: config.appKey,
      clientId: config.clientId,
      bookingProvider: config.bookingProvider,
      bookingProviderId: config.bookingProviderId,
      enabled: config.enabled,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    });
  } catch (error: any) {
    console.error('Error saving ServiceTitan config:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/servicetitan-test', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const result = await testServiceTitanConnection(tenantId);
    
    res.json(result);
  } catch (error: any) {
    console.error('Error testing ServiceTitan connection:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.post('/:tenantId/servicetitan/sync-contacts', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const { syncServiceTitanContacts } = await import('../services/serviceTitanContactSync');
    const result = await syncServiceTitanContacts(tenantId);
    
    res.json(result);
  } catch (error: any) {
    console.error('Error syncing ServiceTitan contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/servicetitan/import-contacts', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const { importServiceTitanContacts } = await import('../services/serviceTitanContactSync');
    const result = await importServiceTitanContacts(tenantId);
    
    res.json(result);
  } catch (error: any) {
    console.error('Error importing ServiceTitan contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:tenantId/servicetitan/sync-status', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const { getServiceTitanTagId } = await import('../services/serviceTitanContactSync');
    const tagId = await getServiceTitanTagId(tenantId);
    
    const totalContacts = await prisma.contact.count({
      where: { tenantId },
    });
    
    if (!tagId) {
      return res.json({ tagId: null, taggedCount: 0, totalContacts });
    }
    
    const taggedCount = await prisma.contactTag.count({
      where: { tagId },
    });
    
    res.json({ tagId, taggedCount, totalContacts });
  } catch (error: any) {
    console.error('Error getting sync status:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/servicetitan/test-availability', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const { getServiceTitanAvailability } = await import('../services/aiAgent/serviceTitanSearch');
    const slots = await getServiceTitanAvailability(tenantId, { maxSlots: 5 });
    
    if (slots.length > 0) {
      res.json({
        success: true,
        slots,
        source: 'ServiceTitan Capacity API',
      });
    } else {
      res.json({
        success: true,
        slots: [],
        source: 'ServiceTitan Capacity API (no availability returned)',
      });
    }
  } catch (error: any) {
    console.error('Error testing ServiceTitan availability:', error);
    res.status(500).json({ success: false, slots: [], error: error.message });
  }
});

export default router;
