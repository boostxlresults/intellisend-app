import express from 'express';
import { prisma } from '../index';
import crypto from 'crypto';

const router = express.Router();

function generateShortCode(): string {
  return crypto.randomBytes(4).toString('base64url');
}

router.get('/:tenantId/links', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const links = await prisma.trackedLink.findMany({
      where: { tenantId },
      include: {
        _count: { select: { clicks: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    
    res.json(links);
  } catch (error: any) {
    console.error('Error fetching links:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/links', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { originalUrl, campaignId, sequenceId } = req.body;
    
    if (!originalUrl) {
      return res.status(400).json({ error: 'originalUrl is required' });
    }
    
    let shortCode = generateShortCode();
    let attempts = 0;
    
    while (attempts < 10) {
      const existing = await prisma.trackedLink.findUnique({
        where: { shortCode },
      });
      if (!existing) break;
      shortCode = generateShortCode();
      attempts++;
    }
    
    const link = await prisma.trackedLink.create({
      data: {
        tenantId,
        shortCode,
        originalUrl,
        campaignId,
        sequenceId,
      },
    });
    
    res.status(201).json(link);
  } catch (error: any) {
    console.error('Error creating link:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:tenantId/links/:linkId/analytics', async (req, res) => {
  try {
    const { tenantId, linkId } = req.params;
    
    const link = await prisma.trackedLink.findFirst({
      where: { id: linkId, tenantId },
      include: {
        clicks: {
          orderBy: { clickedAt: 'desc' },
          take: 100,
        },
        _count: { select: { clicks: true } },
      },
    });
    
    if (!link) {
      return res.status(404).json({ error: 'Link not found' });
    }
    
    const clicksByDay = await prisma.linkClick.groupBy({
      by: ['clickedAt'],
      where: { trackedLinkId: linkId },
      _count: true,
    });
    
    res.json({
      link,
      totalClicks: link._count.clicks,
      uniqueContacts: new Set(link.clicks.filter(c => c.contactId).map(c => c.contactId)).size,
    });
  } catch (error: any) {
    console.error('Error fetching link analytics:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:tenantId/links/:linkId', async (req, res) => {
  try {
    const { tenantId, linkId } = req.params;
    
    await prisma.trackedLink.deleteMany({
      where: { id: linkId, tenantId },
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting link:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/l/:shortCode', async (req, res) => {
  try {
    const { shortCode } = req.params;
    const { c: contactId, p: phone } = req.query;
    
    const link = await prisma.trackedLink.findUnique({
      where: { shortCode },
    });
    
    if (!link) {
      return res.status(404).send('Link not found');
    }
    
    await prisma.linkClick.create({
      data: {
        trackedLinkId: link.id,
        contactId: contactId as string || null,
        phone: phone as string || null,
        userAgent: req.headers['user-agent'] || null,
        ipAddress: req.ip || req.headers['x-forwarded-for']?.toString() || null,
      },
    });
    
    res.redirect(link.originalUrl);
  } catch (error: any) {
    console.error('Error tracking click:', error);
    res.redirect('/');
  }
});

export function processLinksInMessage(
  body: string,
  tenantId: string,
  baseUrl: string,
  options?: { contactId?: string; campaignId?: string; sequenceId?: string }
): Promise<string> {
  return new Promise(async (resolve) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = body.match(urlRegex);
    
    if (!urls) {
      return resolve(body);
    }
    
    let processedBody = body;
    
    for (const url of urls) {
      let shortCode = generateShortCode();
      let attempts = 0;
      
      while (attempts < 10) {
        const existing = await prisma.trackedLink.findUnique({
          where: { shortCode },
        });
        if (!existing) break;
        shortCode = generateShortCode();
        attempts++;
      }
      
      await prisma.trackedLink.create({
        data: {
          tenantId,
          shortCode,
          originalUrl: url,
          campaignId: options?.campaignId,
          sequenceId: options?.sequenceId,
        },
      });
      
      let shortUrl = `${baseUrl}/l/${shortCode}`;
      if (options?.contactId) {
        shortUrl += `?c=${options.contactId}`;
      }
      
      processedBody = processedBody.replace(url, shortUrl);
    }
    
    resolve(processedBody);
  });
}

export default router;
