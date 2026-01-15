import { Router } from 'express';
import { PrismaClient, ConsentSource } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

router.get('/:tenantId/consent', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { contactId, phone, limit = '50', offset = '0' } = req.query;

    const where: Record<string, unknown> = { tenantId };
    if (contactId) where.contactId = contactId;
    if (phone) where.phone = phone;

    const records = await prisma.consentRecord.findMany({
      where,
      orderBy: { givenAt: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string),
    });

    res.json(records);
  } catch (error) {
    console.error('Error fetching consent records:', error);
    res.status(500).json({ error: 'Failed to fetch consent records' });
  }
});

router.post('/:tenantId/consent', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { contactId, phone, consentSource, sourceDetails, consentText, ipAddress, userAgent } = req.body;

    if (!contactId || !phone || !consentSource) {
      return res.status(400).json({ error: 'contactId, phone, and consentSource are required' });
    }

    const validSources: ConsentSource[] = ['IMPORT', 'WEB_FORM', 'SMS_KEYWORD', 'MANUAL', 'API'];
    if (!validSources.includes(consentSource)) {
      return res.status(400).json({ error: 'Invalid consent source' });
    }

    const record = await prisma.consentRecord.create({
      data: {
        tenantId,
        contactId,
        phone,
        consentSource: consentSource as ConsentSource,
        sourceDetails,
        consentText,
        ipAddress,
        userAgent,
        consentGiven: true,
        givenAt: new Date(),
      },
    });

    await prisma.contact.update({
      where: { id: contactId },
      data: {
        consentSource: consentSource,
        consentTimestamp: new Date(),
      },
    });

    res.status(201).json(record);
  } catch (error) {
    console.error('Error creating consent record:', error);
    res.status(500).json({ error: 'Failed to create consent record' });
  }
});

router.post('/:tenantId/consent/:recordId/revoke', async (req, res) => {
  try {
    const { tenantId, recordId } = req.params;

    const record = await prisma.consentRecord.update({
      where: { id: recordId },
      data: {
        consentGiven: false,
        revokedAt: new Date(),
      },
    });

    if (record.contactId) {
      await prisma.contact.update({
        where: { id: record.contactId },
        data: {
          consentTimestamp: null,
        },
      });
    }

    res.json(record);
  } catch (error) {
    console.error('Error revoking consent:', error);
    res.status(500).json({ error: 'Failed to revoke consent' });
  }
});

router.get('/:tenantId/consent/stats', async (req, res) => {
  try {
    const { tenantId } = req.params;

    const [totalConsented, totalRevoked, recentConsents] = await Promise.all([
      prisma.consentRecord.count({
        where: { tenantId, consentGiven: true },
      }),
      prisma.consentRecord.count({
        where: { tenantId, consentGiven: false },
      }),
      prisma.consentRecord.count({
        where: {
          tenantId,
          consentGiven: true,
          givenAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    const bySource = await prisma.consentRecord.groupBy({
      by: ['consentSource'],
      where: { tenantId, consentGiven: true },
      _count: true,
    });

    res.json({
      totalConsented,
      totalRevoked,
      recentConsents,
      bySource: bySource.map(s => ({ source: s.consentSource, count: s._count })),
    });
  } catch (error) {
    console.error('Error fetching consent stats:', error);
    res.status(500).json({ error: 'Failed to fetch consent stats' });
  }
});

export default router;
