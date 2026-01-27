import { Router } from 'express';
import multer from 'multer';
import Papa from 'papaparse';
import { prisma } from '../index';
import { upsertTagsForContact } from './tags';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/:tenantId/contacts', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { tag, tagId, search, page = '1', limit = '50' } = req.query;
    
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;
    
    const where: any = { tenantId };
    
    if (tagId) {
      where.tags = {
        some: { tagId: tagId as string },
      };
    } else if (tag) {
      where.tags = {
        some: { 
          tag: { name: tag as string } 
        },
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
        include: { 
          tags: {
            include: { tag: true },
          },
        },
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.contact.count({ where }),
    ]);
    
    const formattedContacts = contacts.map(c => ({
      ...c,
      tags: c.tags.map(ct => ({
        id: ct.tagId,
        name: ct.tag.name,
        color: ct.tag.color,
      })),
    }));
    
    res.json({
      contacts: formattedContacts,
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
      },
    });
    
    if (tags && Array.isArray(tags) && tags.length > 0) {
      await upsertTagsForContact(tenantId, contact.id, tags);
    }
    
    const result = await prisma.contact.findUnique({
      where: { id: contact.id },
      include: { 
        tags: { include: { tag: true } },
      },
    });
    
    res.status(201).json(result);
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
        const uniqueTags = [...new Set(allTags)].filter(Boolean);
        
        const existing = await prisma.contact.findFirst({
          where: { tenantId, phone: c.phone },
        });
        
        let contactId: string;
        
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
          contactId = existing.id;
        } else {
          const newContact = await prisma.contact.create({
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
            },
          });
          contactId = newContact.id;
        }
        
        if (uniqueTags.length > 0) {
          await upsertTagsForContact(tenantId, contactId, uniqueTags);
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
        tags: {
          include: { tag: true },
        },
        conversations: {
          orderBy: { lastMessageAt: 'desc' },
          take: 5,
        },
      },
    });
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    const formattedContact = {
      ...contact,
      tags: contact.tags.map(ct => ({
        id: ct.tagId,
        name: ct.tag.name,
        color: ct.tag.color,
      })),
    };
    
    res.json(formattedContact);
  } catch (error: any) {
    console.error('Error fetching contact:', error);
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:tenantId/contacts/:contactId', async (req, res) => {
  try {
    const { tenantId, contactId } = req.params;
    const { aiAgentEnabled, firstName, lastName, email, address, city, state, zip, customerType } = req.body;
    
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, tenantId },
    });
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    const updateData: any = {};
    if (aiAgentEnabled !== undefined) updateData.aiAgentEnabled = aiAgentEnabled;
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (email !== undefined) updateData.email = email;
    if (address !== undefined) updateData.address = address;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (zip !== undefined) updateData.zip = zip;
    if (customerType !== undefined) updateData.customerType = customerType;
    
    const updated = await prisma.contact.update({
      where: { id: contactId },
      data: updateData,
      include: {
        tags: {
          include: { tag: true },
        },
      },
    });
    
    const formattedContact = {
      ...updated,
      tags: updated.tags.map(ct => ({
        id: ct.tagId,
        name: ct.tag.name,
        color: ct.tag.color,
      })),
    };
    
    res.json(formattedContact);
  } catch (error: any) {
    console.error('Error updating contact:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
