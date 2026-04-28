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
      notificationEmail,
      globalFreqCapDaily,
      globalFreqCapWeekly,
      stl360Enabled,
      stl360ApiUrl,
      stl360TenantId,
      rcsEnabled,
      rcsFallbackToSms,
      rcsBrandName,
      rcsBrandLogoUrl,
      rcsBrandColor,
      rcsBrandWebsite,
      rcsBrandDescription,
      rcsBrandContactEmail,
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
    
    if (notificationEmail !== undefined) {
      updateData.notificationEmail = notificationEmail || null;
    }

    if (globalFreqCapDaily !== undefined) {
      updateData.globalFreqCapDaily = Math.max(1, Math.min(20, parseInt(globalFreqCapDaily)));
    }

    if (globalFreqCapWeekly !== undefined) {
      updateData.globalFreqCapWeekly = Math.max(1, Math.min(50, parseInt(globalFreqCapWeekly)));
    }

    if (stl360Enabled !== undefined) {
      updateData.stl360Enabled = Boolean(stl360Enabled);
    }

    if (stl360ApiUrl !== undefined) {
      updateData.stl360ApiUrl = stl360ApiUrl || null;
    }

    if (stl360TenantId !== undefined) {
      updateData.stl360TenantId = stl360TenantId || null;
    }

    // RCS channel settings
    if (rcsEnabled !== undefined) {
      updateData.rcsEnabled = Boolean(rcsEnabled);
    }
    if (rcsFallbackToSms !== undefined) {
      updateData.rcsFallbackToSms = Boolean(rcsFallbackToSms);
    }
    // RCS brand profile fields
    if (rcsBrandName !== undefined) {
      updateData.rcsBrandName = rcsBrandName || null;
    }
    if (rcsBrandLogoUrl !== undefined) {
      updateData.rcsBrandLogoUrl = rcsBrandLogoUrl || null;
    }
    if (rcsBrandColor !== undefined) {
      const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
      updateData.rcsBrandColor = hexColorRegex.test(rcsBrandColor) ? rcsBrandColor : '#1a73e8';
    }
    if (rcsBrandWebsite !== undefined) {
      updateData.rcsBrandWebsite = rcsBrandWebsite || null;
    }
    if (rcsBrandDescription !== undefined) {
      updateData.rcsBrandDescription = rcsBrandDescription ? String(rcsBrandDescription).slice(0, 100) : null;
    }
    if (rcsBrandContactEmail !== undefined) {
      updateData.rcsBrandContactEmail = rcsBrandContactEmail || null;
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
        notificationEmail: updateData.notificationEmail,
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

router.delete('/:tenantId/numbers/:numberId', async (req, res) => {
  try {
    const { tenantId, numberId } = req.params;
    
    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId },
    });
    
    if (!number) {
      return res.status(404).json({ error: 'Number not found' });
    }
    
    await prisma.tenantNumber.delete({
      where: { id: numberId },
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting tenant number:', error);
    res.status(500).json({ error: error.message });
  }
});

// STL360 Test Connection endpoint
router.post('/:tenantId/settings/test-stl360', async (req, res) => {
  try {
    const { tenantId } = req.params;

    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: {
        stl360Enabled: true,
        stl360ApiUrl: true,
        stl360TenantId: true,
      },
    });

    if (!settings?.stl360ApiUrl || !settings?.stl360TenantId) {
      return res.status(400).json({
        success: false,
        error: 'STL360 API URL and Tenant ID must be configured before testing.',
      });
    }

    const endpoint = `${settings.stl360ApiUrl.replace(/\/$/, '')}/api/v1/webhooks/intellisend/${settings.stl360TenantId}`;

    const testPayload = {
      firstName: 'IntelliSend',
      lastName: 'TestLead',
      phone: '+15550000001',
      email: 'test@intellisend.net',
      intent: 'BOOK_YES',
      intentReasoning: 'This is a test lead fired from IntelliSend Settings to verify the STL360 connection.',
      messageSnippet: 'Yes I am interested in getting my AC serviced',
      serviceType: 'HVAC',
      conversationId: 'test-connection-' + Date.now(),
      conversationUrl: 'https://app.intellisend.net/conversations/test',
      campaignName: 'IntelliSend Connection Test',
      intellisendContactId: 'test-contact-id',
      intellisendTenantId: tenantId,
    };

    const axios = (await import('axios')).default;
    const response = await axios.post(endpoint, testPayload, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'X-Source': 'intellisend',
      },
    });

    res.json({
      success: true,
      message: `✓ Test lead successfully sent to SpeedToLead360! Check your STL360 leads list for "IntelliSend TestLead".`,
      endpoint,
      statusCode: response.status,
    });
  } catch (error: any) {
    const statusCode = error?.response?.status;
    const responseBody = error?.response?.data;
    res.status(500).json({
      success: false,
      error: error?.message || 'Unknown error',
      statusCode,
      responseBody,
      hint: statusCode === 404
        ? 'The STL360 webhook endpoint was not found. Verify the API URL and Tenant ID are correct.'
        : statusCode === 401 || statusCode === 403
        ? 'Authentication failed. Check that the Tenant ID matches a valid STL360 tenant.'
        : 'Check that the STL360 API URL is reachable and the Tenant ID is correct.',
    });
  }
});

export default router;
