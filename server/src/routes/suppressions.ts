import { Router } from 'express';
import { prisma } from '../index';

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
    const { phone, reason } = req.body;
    
    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
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
    
    await prisma.suppression.delete({
      where: { id: suppressionId },
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting suppression:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
