import { Router } from 'express';
import { prisma } from '../index';

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
