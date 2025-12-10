import { Router } from 'express';
import { prisma } from '../index';

const router = Router();

router.get('/:tenantId/contacts', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { tag, search, page = '1', limit = '50' } = req.query;
    
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;
    
    const where: any = { tenantId };
    
    if (tag) {
      where.tags = {
        some: { tag: tag as string },
      };
    }
    
    if (search) {
      where.OR = [
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { phone: { contains: search as string } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ];
    }
    
    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        include: { tags: true },
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.contact.count({ where }),
    ]);
    
    res.json({
      contacts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/contacts', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const {
      firstName,
      lastName,
      phone,
      email,
      address,
      city,
      state,
      zip,
      leadSource,
      customerType,
      consentSource,
      tags,
    } = req.body;
    
    if (!firstName || !lastName || !phone) {
      return res.status(400).json({ error: 'firstName, lastName, and phone are required' });
    }
    
    const contact = await prisma.contact.create({
      data: {
        tenantId,
        firstName,
        lastName,
        phone,
        email,
        address,
        city,
        state,
        zip,
        leadSource,
        customerType: customerType || 'LEAD',
        consentSource,
        consentTimestamp: consentSource ? new Date() : null,
        tags: tags ? {
          create: tags.map((tag: string) => ({ tag })),
        } : undefined,
      },
      include: { tags: true },
    });
    
    res.status(201).json(contact);
  } catch (error: any) {
    console.error('Error creating contact:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/contacts/import', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { contacts } = req.body;
    
    if (!Array.isArray(contacts)) {
      return res.status(400).json({ error: 'contacts must be an array' });
    }
    
    const results = await Promise.all(
      contacts.map(async (c: any) => {
        try {
          const contact = await prisma.contact.create({
            data: {
              tenantId,
              firstName: c.firstName,
              lastName: c.lastName,
              phone: c.phone,
              email: c.email,
              address: c.address,
              city: c.city,
              state: c.state,
              zip: c.zip,
              leadSource: c.leadSource,
              customerType: c.customerType || 'LEAD',
              consentSource: c.consentSource,
              consentTimestamp: c.consentSource ? new Date() : null,
              tags: c.tags ? {
                create: c.tags.map((tag: string) => ({ tag })),
              } : undefined,
            },
          });
          return { success: true, contact };
        } catch (err: any) {
          return { success: false, error: err.message, input: c };
        }
      })
    );
    
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    
    res.json({
      imported: successful,
      failed,
      results,
    });
  } catch (error: any) {
    console.error('Error importing contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:tenantId/contacts/:contactId', async (req, res) => {
  try {
    const { tenantId, contactId } = req.params;
    
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, tenantId },
      include: {
        tags: true,
        conversations: {
          orderBy: { lastMessageAt: 'desc' },
          take: 5,
        },
      },
    });
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    res.json(contact);
  } catch (error: any) {
    console.error('Error fetching contact:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/contacts/:contactId/tags', async (req, res) => {
  try {
    const { tenantId, contactId } = req.params;
    const { tag } = req.body;
    
    if (!tag) {
      return res.status(400).json({ error: 'tag is required' });
    }
    
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, tenantId },
    });
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    const existingTag = await prisma.contactTag.findFirst({
      where: { contactId, tag },
    });
    
    if (existingTag) {
      return res.status(400).json({ error: 'Tag already exists' });
    }
    
    const newTag = await prisma.contactTag.create({
      data: { contactId, tag },
    });
    
    res.status(201).json(newTag);
  } catch (error: any) {
    console.error('Error adding tag:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:tenantId/contacts/:contactId/tags/:tag', async (req, res) => {
  try {
    const { tenantId, contactId, tag } = req.params;
    
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, tenantId },
    });
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    await prisma.contactTag.deleteMany({
      where: { contactId, tag },
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error removing tag:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
