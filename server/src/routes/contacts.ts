import { Router } from 'express';
import multer from 'multer';
import Papa from 'papaparse';
import { prisma } from '../index';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

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

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_\s-]+/g, '');
}

router.post('/:tenantId/contacts/import', upload.single('file') as any, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const globalTags = req.body.globalTags
      ? (req.body.globalTags as string).split(',').map(t => t.trim()).filter(Boolean)
      : [];
    
    let contactsData: any[] = [];
    
    if (req.file) {
      const csvText = req.file.buffer.toString('utf-8');
      
      const parseResult = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header: string) => normalizeHeader(header),
      });
      
      if (parseResult.errors.length > 0) {
        const criticalErrors = parseResult.errors.filter(e => e.type === 'Delimiter' || e.type === 'Quotes');
        if (criticalErrors.length > 0) {
          return res.status(400).json({ 
            error: 'CSV parsing error', 
            details: criticalErrors.slice(0, 5).map(e => e.message) 
          });
        }
      }
      
      contactsData = parseResult.data.map((row: any) => ({
        phone: row.phone || row.phonenumber || '',
        firstName: row.firstname || row.first || 'Unknown',
        lastName: row.lastname || row.last || 'Contact',
        email: row.email || undefined,
        address: row.address || undefined,
        city: row.city || undefined,
        state: row.state || undefined,
        zip: row.zip || row.zipcode || undefined,
        tags: row.tags ? row.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [],
      }));
    } else if (req.body.contacts) {
      contactsData = Array.isArray(req.body.contacts) 
        ? req.body.contacts 
        : JSON.parse(req.body.contacts);
    } else {
      return res.status(400).json({ error: 'No contacts data provided. Use CSV file or JSON array.' });
    }
    
    let imported = 0;
    let failed = 0;
    const errors: { phone: string; error: string }[] = [];
    
    for (const c of contactsData) {
      if (!c.phone) {
        failed++;
        errors.push({ phone: 'unknown', error: 'Phone number is required' });
        continue;
      }
      
      try {
        const allTags = [...(c.tags || []), ...globalTags];
        const uniqueTags = [...new Set(allTags)];
        
        const existing = await prisma.contact.findFirst({
          where: { tenantId, phone: c.phone },
          include: { tags: true },
        });
        
        if (existing) {
          await prisma.contact.update({
            where: { id: existing.id },
            data: {
              firstName: c.firstName || existing.firstName,
              lastName: c.lastName || existing.lastName,
              email: c.email || existing.email,
              address: c.address || existing.address,
              city: c.city || existing.city,
              state: c.state || existing.state,
              zip: c.zip || existing.zip,
            },
          });
          
          const existingTagNames = existing.tags.map(t => t.tag);
          const newTags = uniqueTags.filter(t => !existingTagNames.includes(t));
          
          if (newTags.length > 0) {
            await prisma.contactTag.createMany({
              data: newTags.map(tag => ({ contactId: existing.id, tag })),
            });
          }
        } else {
          await prisma.contact.create({
            data: {
              tenantId,
              firstName: c.firstName || 'Unknown',
              lastName: c.lastName || 'Contact',
              phone: c.phone,
              email: c.email,
              address: c.address,
              city: c.city,
              state: c.state,
              zip: c.zip,
              leadSource: c.leadSource,
              customerType: c.customerType || 'LEAD',
              consentSource: c.consentSource || 'import',
              consentTimestamp: new Date(),
              tags: uniqueTags.length > 0 ? {
                create: uniqueTags.map(tag => ({ tag })),
              } : undefined,
            },
          });
        }
        
        imported++;
      } catch (err: any) {
        failed++;
        errors.push({ phone: c.phone, error: err.message });
      }
    }
    
    res.json({
      imported,
      failed,
      total: contactsData.length,
      errors: errors.slice(0, 10),
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
