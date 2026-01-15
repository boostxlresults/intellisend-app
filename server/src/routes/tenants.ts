import { Router } from 'express';
import { prisma } from '../index';
import { timeStringToMinutes, minutesToTimeString } from '../services/tenantSettings';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const tenants = await prisma.tenant.findMany({
      include: {
        numbers: true,
        _count: {
          select: {
            contacts: true,
            conversations: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(tenants);
  } catch (error: any) {
    console.error('Error fetching tenants:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, publicName, industry, websiteUrl, mainPhone, brandVoice } = req.body;
    
    if (!name || !publicName) {
      return res.status(400).json({ error: 'name and publicName are required' });
    }
    
    const tenant = await prisma.tenant.create({
      data: {
        name,
        publicName,
        industry,
        websiteUrl,
        mainPhone,
        brandVoice,
      },
    });
    
    await prisma.tenantSettings.create({
      data: {
        tenantId: tenant.id,
        timezone: 'America/Phoenix',
        quietHoursStart: 20 * 60,
        quietHoursEnd: 8 * 60,
      },
    });
    
    res.status(201).json(tenant);
  } catch (error: any) {
    console.error('Error creating tenant:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        numbers: true,
      },
    });
    
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    
    res.json(tenant);
  } catch (error: any) {
    console.error('Error fetching tenant:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:tenantId/settings', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    let settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
      include: { defaultFromNumber: true },
    });
    
    if (!settings) {
      settings = await prisma.tenantSettings.create({
        data: {
          tenantId,
          timezone: 'America/Phoenix',
          quietHoursStart: 20 * 60,
          quietHoursEnd: 8 * 60,
        },
        include: { defaultFromNumber: true },
      });
    }
    
    res.json({
      ...settings,
      quietHoursStartFormatted: minutesToTimeString(settings.quietHoursStart),
      quietHoursEndFormatted: minutesToTimeString(settings.quietHoursEnd),
    });
  } catch (error: any) {
    console.error('Error fetching tenant settings:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/settings', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { 
      timezone, 
      quietHoursStart, 
      quietHoursEnd, 
      defaultFromNumberId,
      sendRatePerMinute,
      sendJitterMinMs,
      sendJitterMaxMs,
    } = req.body;
    
    const updateData: any = {};
    
    if (timezone !== undefined) {
      updateData.timezone = timezone;
    }
    
    if (quietHoursStart !== undefined) {
      updateData.quietHoursStart = typeof quietHoursStart === 'string' 
        ? timeStringToMinutes(quietHoursStart) 
        : quietHoursStart;
    }
    
    if (quietHoursEnd !== undefined) {
      updateData.quietHoursEnd = typeof quietHoursEnd === 'string' 
        ? timeStringToMinutes(quietHoursEnd) 
        : quietHoursEnd;
    }
    
    if (defaultFromNumberId !== undefined) {
      if (defaultFromNumberId) {
        const tenantNumber = await prisma.tenantNumber.findFirst({
          where: { id: defaultFromNumberId, tenantId },
        });
        if (!tenantNumber) {
          return res.status(400).json({ error: 'Invalid defaultFromNumberId: number does not belong to this tenant' });
        }
      }
      updateData.defaultFromNumberId = defaultFromNumberId || null;
    }
    
    if (sendRatePerMinute !== undefined) {
      updateData.sendRatePerMinute = Math.max(1, Math.min(120, parseInt(sendRatePerMinute)));
    }
    
    let newMinMs = sendJitterMinMs !== undefined ? Math.max(0, parseInt(sendJitterMinMs)) : undefined;
    let newMaxMs = sendJitterMaxMs !== undefined ? Math.max(1000, parseInt(sendJitterMaxMs)) : undefined;
    
    if (newMinMs !== undefined && newMaxMs !== undefined) {
      if (newMinMs > newMaxMs) {
        const temp = newMinMs;
        newMinMs = newMaxMs;
        newMaxMs = temp;
      }
    }
    
    if (newMinMs !== undefined) {
      updateData.sendJitterMinMs = newMinMs;
    }
    
    if (newMaxMs !== undefined) {
      updateData.sendJitterMaxMs = newMaxMs;
    }
    
    const settings = await prisma.tenantSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        timezone: updateData.timezone || 'America/Phoenix',
        quietHoursStart: updateData.quietHoursStart ?? 20 * 60,
        quietHoursEnd: updateData.quietHoursEnd ?? 8 * 60,
        defaultFromNumberId: updateData.defaultFromNumberId,
        sendRatePerMinute: updateData.sendRatePerMinute ?? 30,
        sendJitterMinMs: updateData.sendJitterMinMs ?? 1000,
        sendJitterMaxMs: updateData.sendJitterMaxMs ?? 5000,
      },
      update: updateData,
      include: { defaultFromNumber: true },
    });
    
    res.json({
      ...settings,
      quietHoursStartFormatted: minutesToTimeString(settings.quietHoursStart),
      quietHoursEndFormatted: minutesToTimeString(settings.quietHoursEnd),
    });
  } catch (error: any) {
    console.error('Error updating tenant settings:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:tenantId/numbers', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const numbers = await prisma.tenantNumber.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    
    res.json(numbers);
  } catch (error: any) {
    console.error('Error fetching tenant numbers:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/numbers', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { phoneNumber, label, isDefault } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ error: 'phoneNumber is required' });
    }
    
    if (isDefault) {
      await prisma.tenantNumber.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      });
    }
    
    const number = await prisma.tenantNumber.create({
      data: {
        tenantId,
        phoneNumber,
        label,
        isDefault: isDefault || false,
      },
    });
    
    res.status(201).json(number);
  } catch (error: any) {
    console.error('Error creating tenant number:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
