import { Router } from 'express';
import { prisma } from '../index';
import Twilio from 'twilio';

const router = Router();

router.get('/:tenantId/integrations', async (req, res) => {
  try {
    const { tenantId } = req.params;

    let integration = await prisma.tenantIntegration.findUnique({
      where: { tenantId },
    });

    if (!integration) {
      integration = await prisma.tenantIntegration.create({
        data: { tenantId },
      });
    }

    res.json({
      twilioConfigured: integration.twilioConfigured,
      twilioAccountSid: integration.twilioAccountSid ? '***' + integration.twilioAccountSid.slice(-4) : null,
      twilioMessagingServiceSid: integration.twilioMessagingServiceSid || null,
      twilioValidatedAt: integration.twilioValidatedAt,
    });
  } catch (error: any) {
    console.error('Error fetching integrations:', error);
    res.status(500).json({ error: 'Failed to fetch integrations' });
  }
});

router.post('/:tenantId/integrations/twilio', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { accountSid, authToken, messagingServiceSid } = req.body;

    if (!accountSid || !authToken) {
      res.status(400).json({ error: 'Account SID and Auth Token are required' });
      return;
    }

    try {
      const client = Twilio(accountSid, authToken);
      await client.api.accounts(accountSid).fetch();
    } catch (twilioError: any) {
      res.status(400).json({ error: 'Invalid Twilio credentials: ' + twilioError.message });
      return;
    }

    const integration = await prisma.tenantIntegration.upsert({
      where: { tenantId },
      create: {
        tenantId,
        twilioAccountSid: accountSid,
        twilioAuthToken: authToken,
        twilioMessagingServiceSid: messagingServiceSid || null,
        twilioConfigured: true,
        twilioValidatedAt: new Date(),
      },
      update: {
        twilioAccountSid: accountSid,
        twilioAuthToken: authToken,
        twilioMessagingServiceSid: messagingServiceSid || null,
        twilioConfigured: true,
        twilioValidatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      twilioConfigured: integration.twilioConfigured,
      twilioValidatedAt: integration.twilioValidatedAt,
    });
  } catch (error: any) {
    console.error('Error saving Twilio integration:', error);
    res.status(500).json({ error: 'Failed to save Twilio integration' });
  }
});

router.delete('/:tenantId/integrations/twilio', async (req, res) => {
  try {
    const { tenantId } = req.params;

    await prisma.tenantIntegration.update({
      where: { tenantId },
      data: {
        twilioAccountSid: null,
        twilioAuthToken: null,
        twilioMessagingServiceSid: null,
        twilioConfigured: false,
        twilioValidatedAt: null,
      },
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error removing Twilio integration:', error);
    res.status(500).json({ error: 'Failed to remove Twilio integration' });
  }
});

router.post('/:tenantId/integrations/twilio/test', async (req, res) => {
  try {
    const { tenantId } = req.params;

    const integration = await prisma.tenantIntegration.findUnique({
      where: { tenantId },
    });

    if (!integration?.twilioAccountSid || !integration?.twilioAuthToken) {
      res.status(400).json({ error: 'Twilio not configured for this tenant' });
      return;
    }

    try {
      const client = Twilio(integration.twilioAccountSid, integration.twilioAuthToken);
      const account = await client.api.accounts(integration.twilioAccountSid).fetch();
      
      res.json({
        success: true,
        accountName: account.friendlyName,
        status: account.status,
      });
    } catch (twilioError: any) {
      res.status(400).json({ 
        success: false, 
        error: 'Twilio validation failed: ' + twilioError.message 
      });
    }
  } catch (error: any) {
    console.error('Error testing Twilio integration:', error);
    res.status(500).json({ error: 'Failed to test Twilio integration' });
  }
});

export default router;
