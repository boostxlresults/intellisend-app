import { Router } from 'express';
import { prisma } from '../index';

const router = Router();

router.get('/:tenantId/segments', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const segments = await prisma.segment.findMany({
      where: { tenantId },
      include: {
        _count: {
          select: { members: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    
    res.json(segments);
  } catch (error: any) {
    console.error('Error fetching segments:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/segments', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { name, type, contactIds, definitionJson } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    
    const segment = await prisma.segment.create({
      data: {
        tenantId,
        name,
        type: type || 'STATIC',
        definitionJson: definitionJson ? JSON.stringify(definitionJson) : null,
        members: contactIds ? {
          create: contactIds.map((contactId: string) => ({ contactId })),
        } : undefined,
      },
      include: {
        _count: {
          select: { members: true },
        },
      },
    });
    
    res.status(201).json(segment);
  } catch (error: any) {
    console.error('Error creating segment:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:tenantId/segments/:segmentId', async (req, res) => {
  try {
    const { tenantId, segmentId } = req.params;
    
    const segment = await prisma.segment.findFirst({
      where: { id: segmentId, tenantId },
      include: {
        members: {
          include: {
            contact: {
              include: { tags: true },
            },
          },
        },
      },
    });
    
    if (!segment) {
      return res.status(404).json({ error: 'Segment not found' });
    }
    
    res.json(segment);
  } catch (error: any) {
    console.error('Error fetching segment:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/segments/:segmentId/members', async (req, res) => {
  try {
    const { tenantId, segmentId } = req.params;
    const { contactIds } = req.body;
    
    const segment = await prisma.segment.findFirst({
      where: { id: segmentId, tenantId },
    });
    
    if (!segment) {
      return res.status(404).json({ error: 'Segment not found' });
    }
    
    if (!Array.isArray(contactIds)) {
      return res.status(400).json({ error: 'contactIds must be an array' });
    }
    
    const results = await Promise.all(
      contactIds.map(async (contactId: string) => {
        try {
          await prisma.segmentMember.create({
            data: { segmentId, contactId },
          });
          return { success: true, contactId };
        } catch (err: any) {
          return { success: false, contactId, error: err.message };
        }
      })
    );
    
    res.json({ results });
  } catch (error: any) {
    console.error('Error adding segment members:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
