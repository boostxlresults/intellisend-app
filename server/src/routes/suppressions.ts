import { Router } from 'express';
import { prisma } from '../index';
import { normalizePhone } from '../utils/phoneNormalize';

const router = Router();

router.get('/:tenantId/suppressions', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const suppressions = await prisma.suppression.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    
    res.json(suppressions);
  } catch (error: any) {
    console.error('Error fetching suppressions:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/suppressions', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { phone: rawPhone, reason } = req.body;
    
    if (!rawPhone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    // Store the number in the same format used at send time, so it actually matches.
    const phone = normalizePhone(String(rawPhone));
    if (!/^\+\d{10,15}$/.test(phone)) {
      return res.status(400).json({ error: 'Enter a valid phone number, for example (520) 555-1234.' });
    }
    
    const existing = await prisma.suppression.findFirst({
      where: { tenantId, phone },
    });
    
    if (existing) {
      return res.status(400).json({ error: 'Phone already suppressed' });
    }
    
    const suppression = await prisma.suppression.create({
      data: {
        tenantId,
        phone,
        reason: reason || 'manual',
      },
    });
    
    res.status(201).json(suppression);
  } catch (error: any) {
    console.error('Error creating suppression:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:tenantId/suppressions/:suppressionId', async (req, res) => {
  try {
    const { tenantId, suppressionId } = req.params;
    
    const suppression = await prisma.suppression.findFirst({
      where: { id: suppressionId, tenantId },
    });
    
    if (!suppression) {
      return res.status(404).json({ error: 'Suppression not found' });
    }
    
    // A customer's own opt-out is permanent. Only entries a staff member added by
    // hand can be removed here.
    const customerOptOutReasons = ['STOP', 'NEGATIVE_SENTIMENT'];
    if (customerOptOutReasons.includes((suppression.reason || '').toUpperCase())) {
      return res.status(403).json({
        error: 'This customer opted out by text. Opt-outs are permanent and cannot be removed.',
      });
    }

    await prisma.suppression.delete({
      where: { id: suppressionId },
    });
    console.log(`Suppression ${suppressionId} (${suppression.phone}, reason: ${suppression.reason}) removed for tenant ${tenantId} by user ${(req as any).session?.userId ?? 'unknown'}`);
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting suppression:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
