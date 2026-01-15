import express from 'express';
import { prisma } from '../index';

const router = express.Router();

router.get('/:tenantId/branding', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    let branding = await prisma.tenantBranding.findUnique({
      where: { tenantId },
    });
    
    if (!branding) {
      branding = {
        id: '',
        tenantId,
        logoUrl: null,
        faviconUrl: null,
        primaryColor: '#3B82F6',
        secondaryColor: '#1E40AF',
        companyName: null,
        supportEmail: null,
        customDomain: null,
        customCss: null,
        footerText: null,
        hideIntelliSend: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
    
    res.json(branding);
  } catch (error: any) {
    console.error('Error fetching branding:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/branding', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const {
      logoUrl,
      faviconUrl,
      primaryColor,
      secondaryColor,
      companyName,
      supportEmail,
      customDomain,
      customCss,
      footerText,
      hideIntelliSend,
    } = req.body;
    
    const branding = await prisma.tenantBranding.upsert({
      where: { tenantId },
      create: {
        tenantId,
        logoUrl,
        faviconUrl,
        primaryColor: primaryColor || '#3B82F6',
        secondaryColor: secondaryColor || '#1E40AF',
        companyName,
        supportEmail,
        customDomain,
        customCss,
        footerText,
        hideIntelliSend: hideIntelliSend || false,
      },
      update: {
        logoUrl,
        faviconUrl,
        primaryColor,
        secondaryColor,
        companyName,
        supportEmail,
        customDomain,
        customCss,
        footerText,
        hideIntelliSend,
      },
    });
    
    res.json(branding);
  } catch (error: any) {
    console.error('Error saving branding:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/branding/upload-logo', async (req, res) => {
  res.status(501).json({ error: 'Logo upload requires object storage integration' });
});

router.get('/branding/by-domain/:domain', async (req, res) => {
  try {
    const { domain } = req.params;
    
    const branding = await prisma.tenantBranding.findFirst({
      where: { customDomain: domain },
    });
    
    if (!branding) {
      return res.status(404).json({ error: 'Branding not found for domain' });
    }
    
    res.json(branding);
  } catch (error: any) {
    console.error('Error fetching branding by domain:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
