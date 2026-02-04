import { Router } from 'express';
import multer from 'multer';
import Papa from 'papaparse';
import { prisma } from '../index';
import { upsertTagsForContact } from './tags';

const router = Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit for large CSV imports
});

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
      const searchTerm = (search as string).trim();
      const searchWords = searchTerm.split(/\s+/).filter(w => w.length > 0);
      
      if (searchWords.length > 1) {
        // Multi-word search: ALL words must match somewhere (firstName, lastName, phone, email, or tag)
        where.AND = searchWords.map(word => ({
          OR: [
            { firstName: { contains: word, mode: 'insensitive' } },
            { lastName: { contains: word, mode: 'insensitive' } },
            { phone: { contains: word } },
            { email: { contains: word, mode: 'insensitive' } },
            { tags: { some: { tag: { name: { contains: word, mode: 'insensitive' } } } } },
          ],
        }));
      } else {
        // Single word search: match any field
        where.OR = [
          { firstName: { contains: searchTerm, mode: 'insensitive' } },
          { lastName: { contains: searchTerm, mode: 'insensitive' } },
          { phone: { contains: searchTerm } },
          { email: { contains: searchTerm, mode: 'insensitive' } },
          { tags: { some: { tag: { name: { contains: searchTerm, mode: 'insensitive' } } } } },
        ];
      }
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

// Get contacts by tags (for segment creation - returns IDs and count only)
router.post('/:tenantId/contacts/by-tags', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { tagNames } = req.body as { tagNames: string[] };
    
    if (!tagNames || tagNames.length === 0) {
      return res.json({ contacts: [], total: 0 });
    }
    
    const contacts = await prisma.contact.findMany({
      where: {
        tenantId,
        tags: {
          some: {
            tag: { name: { in: tagNames } },
          },
        },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        tags: {
          include: { tag: true },
        },
      },
    });
    
    const formattedContacts = contacts.map(c => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      tags: c.tags.map(ct => ({ id: ct.tagId, name: ct.tag.name, color: ct.tag.color })),
    }));
    
    res.json({ contacts: formattedContacts, total: contacts.length });
  } catch (error: any) {
    console.error('Error fetching contacts by tags:', error);
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
      
      contactsData = parseResult.data.map((row: any) => {
        let firstName = row.firstname || row.first || '';
        let lastName = row.lastname || row.last || '';
        
        // Auto-split "Name" column into firstName/lastName if no separate name columns exist
        if (!firstName && !lastName && row.name) {
          const nameParts = row.name.trim().split(/\s+/);
          if (nameParts.length === 1) {
            firstName = nameParts[0];
            lastName = '';
          } else if (nameParts.length === 2) {
            firstName = nameParts[0];
            lastName = nameParts[1];
          } else {
            // For 3+ parts, first word is firstName, rest is lastName
            firstName = nameParts[0];
            lastName = nameParts.slice(1).join(' ');
          }
        }
        
        return {
          phone: row.phone || row.phonenumber || '',
          firstName: firstName || 'Unknown',
          lastName: lastName || 'Contact',
          email: row.email || undefined,
          address: row.address || undefined,
          city: row.city || undefined,
          state: row.state || undefined,
          zip: row.zip || row.zipcode || undefined,
          tags: row.tags ? row.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [],
        };
      });
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
    
    // Filter out contacts without phone numbers
    const validContacts: typeof contactsData = [];
    for (const c of contactsData) {
      if (!c.phone) {
        failed++;
        errors.push({ phone: 'unknown', error: 'Phone number is required' });
      } else {
        validContacts.push(c);
      }
    }
    
    // Process in batches of 500 for efficiency
    const BATCH_SIZE = 500;
    const batches = [];
    for (let i = 0; i < validContacts.length; i += BATCH_SIZE) {
      batches.push(validContacts.slice(i, i + BATCH_SIZE));
    }
    
    console.log(`[Import] Processing ${validContacts.length} contacts in ${batches.length} batches of ${BATCH_SIZE}`);
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`[Import] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} contacts)`);
      
      try {
        // Get all phones in this batch
        const batchPhones = batch.map(c => c.phone);
        
        // Find existing contacts in one query
        const existingContacts = await prisma.contact.findMany({
          where: { tenantId, phone: { in: batchPhones } },
          select: { id: true, phone: true, firstName: true, lastName: true, email: true, address: true, city: true, state: true, zip: true },
        });
        
        const existingByPhone = new Map(existingContacts.map(c => [c.phone, c]));
        
        // Separate new vs existing
        const toCreate: any[] = [];
        const toUpdate: { id: string; data: any; tags: string[] }[] = [];
        
        for (const c of batch) {
          const allTags = [...(c.tags || []), ...globalTags];
          
          // Auto-add ZIP code as a tag for geo-targeting
          if (c.zip) {
            const zipTag = c.zip.toString().trim().substring(0, 5);
            if (zipTag && /^\d{5}$/.test(zipTag)) {
              allTags.push(zipTag);
            }
          }
          
          const uniqueTags = [...new Set(allTags)].filter(Boolean);
          const existing = existingByPhone.get(c.phone);
          
          if (existing) {
            toUpdate.push({
              id: existing.id,
              data: {
                firstName: c.firstName || existing.firstName,
                lastName: c.lastName || existing.lastName,
                email: c.email || existing.email,
                address: c.address || existing.address,
                city: c.city || existing.city,
                state: c.state || existing.state,
                zip: c.zip || existing.zip,
              },
              tags: uniqueTags,
            });
          } else {
            toCreate.push({
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
              _tags: uniqueTags, // Temporary field for tag processing
            });
          }
        }
        
        // Batch create new contacts
        if (toCreate.length > 0) {
          const createData = toCreate.map(c => {
            const { _tags, ...contactData } = c;
            return contactData;
          });
          
          await prisma.contact.createMany({
            data: createData,
            skipDuplicates: true,
          });
          
          // Get the created contacts to apply tags
          const createdPhones = toCreate.map(c => c.phone);
          const createdContacts = await prisma.contact.findMany({
            where: { tenantId, phone: { in: createdPhones } },
            select: { id: true, phone: true },
          });
          
          const createdByPhone = new Map(createdContacts.map(c => [c.phone, c.id]));
          
          // Apply tags to new contacts
          for (const c of toCreate) {
            const contactId = createdByPhone.get(c.phone);
            if (contactId && c._tags.length > 0) {
              try {
                await upsertTagsForContact(tenantId, contactId, c._tags);
              } catch (tagErr) {
                // Tag errors are non-fatal
              }
            }
          }
          
          imported += toCreate.length;
        }
        
        // Batch update existing contacts
        for (const update of toUpdate) {
          try {
            await prisma.contact.update({
              where: { id: update.id },
              data: update.data,
            });
            
            if (update.tags.length > 0) {
              await upsertTagsForContact(tenantId, update.id, update.tags);
            }
            
            imported++;
          } catch (updateErr: any) {
            failed++;
            errors.push({ phone: 'update-error', error: updateErr.message });
          }
        }
        
      } catch (batchErr: any) {
        console.error(`[Import] Batch ${batchIndex + 1} failed:`, batchErr.message);
        failed += batch.length;
        errors.push({ phone: `batch-${batchIndex + 1}`, error: batchErr.message });
      }
    }
    
    console.log(`[Import] Complete: ${imported} imported, ${failed} failed`);
    
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
    const { aiAgentEnabled, firstName, lastName, phone, email, address, city, state, zip, customerType } = req.body;
    
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
    if (phone !== undefined) updateData.phone = phone;
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

router.delete('/:tenantId/contacts/:contactId', async (req, res) => {
  try {
    const { tenantId, contactId } = req.params;
    
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, tenantId },
    });
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    await prisma.contact.delete({
      where: { id: contactId },
    });
    
    res.json({ success: true, message: 'Contact deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting contact:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:tenantId/contacts/bulk/by-tag/:tagId', async (req, res) => {
  try {
    const { tenantId, tagId } = req.params;
    
    const tag = await prisma.tag.findFirst({
      where: { id: tagId, tenantId },
    });
    
    if (!tag) {
      return res.status(404).json({ error: 'Tag not found' });
    }
    
    const contactsWithTag = await prisma.contactTag.findMany({
      where: { tagId },
      select: { contactId: true },
    });
    
    const contactIds = contactsWithTag.map(ct => ct.contactId);
    
    if (contactIds.length === 0) {
      return res.json({ success: true, deletedCount: 0 });
    }
    
    const result = await prisma.contact.deleteMany({
      where: {
        id: { in: contactIds },
        tenantId,
      },
    });
    
    res.json({ success: true, deletedCount: result.count, tagName: tag.name });
  } catch (error: any) {
    console.error('Error bulk deleting contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

// Contact Notes
router.get('/:tenantId/contacts/:contactId/notes', async (req, res) => {
  try {
    const { tenantId, contactId } = req.params;
    
    const notes = await prisma.contactNote.findMany({
      where: { tenantId, contactId },
      orderBy: { createdAt: 'desc' },
    });
    
    res.json(notes);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/contacts/:contactId/notes', async (req, res) => {
  try {
    const { tenantId, contactId } = req.params;
    const { content, createdBy } = req.body;
    
    if (!content?.trim()) {
      return res.status(400).json({ error: 'Note content is required' });
    }
    
    const note = await prisma.contactNote.create({
      data: {
        tenantId,
        contactId,
        content: content.trim(),
        createdBy,
      },
    });
    
    res.json(note);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:tenantId/contacts/:contactId/notes/:noteId', async (req, res) => {
  try {
    const { tenantId, contactId, noteId } = req.params;
    
    await prisma.contactNote.deleteMany({
      where: { id: noteId, tenantId, contactId },
    });
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Find duplicate contacts (same phone number)
router.get('/:tenantId/contacts/duplicates', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const duplicates = await prisma.$queryRaw`
      SELECT phone, COUNT(*)::int as count, 
             array_agg(id) as contact_ids,
             array_agg("firstName" || ' ' || "lastName") as names
      FROM "Contact"
      WHERE "tenantId" = ${tenantId}
      GROUP BY phone
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 100
    ` as any[];
    
    res.json(duplicates);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Merge duplicate contacts
router.post('/:tenantId/contacts/merge', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { keepContactId, mergeContactIds } = req.body;
    
    if (!keepContactId || !mergeContactIds?.length) {
      return res.status(400).json({ error: 'keepContactId and mergeContactIds are required' });
    }
    
    const keepContact = await prisma.contact.findFirst({
      where: { id: keepContactId, tenantId },
      include: { tags: true },
    });
    
    if (!keepContact) {
      return res.status(404).json({ error: 'Primary contact not found' });
    }
    
    const contactsToMerge = await prisma.contact.findMany({
      where: { id: { in: mergeContactIds }, tenantId },
      include: { tags: true },
    });
    
    // Collect all unique tag IDs from contacts being merged
    const existingTagIds = new Set(keepContact.tags.map(t => t.tagId));
    const newTagIds: string[] = [];
    
    for (const contact of contactsToMerge) {
      for (const ct of contact.tags) {
        if (!existingTagIds.has(ct.tagId)) {
          existingTagIds.add(ct.tagId);
          newTagIds.push(ct.tagId);
        }
      }
    }
    
    // Add missing tags to the keep contact
    if (newTagIds.length > 0) {
      await prisma.contactTag.createMany({
        data: newTagIds.map(tagId => ({
          contactId: keepContactId,
          tagId,
        })),
        skipDuplicates: true,
      });
    }
    
    // Move notes to the keep contact
    await prisma.contactNote.updateMany({
      where: { contactId: { in: mergeContactIds } },
      data: { contactId: keepContactId },
    });
    
    // Move conversations to the keep contact
    await prisma.conversation.updateMany({
      where: { contactId: { in: mergeContactIds }, tenantId },
      data: { contactId: keepContactId },
    });
    
    // Move messages to the keep contact
    await prisma.message.updateMany({
      where: { contactId: { in: mergeContactIds }, tenantId },
      data: { contactId: keepContactId },
    });
    
    // Delete the merged contacts
    await prisma.contact.deleteMany({
      where: { id: { in: mergeContactIds }, tenantId },
    });
    
    res.json({ 
      success: true, 
      mergedCount: contactsToMerge.length,
      tagsAdded: newTagIds.length,
    });
  } catch (error: any) {
    console.error('Error merging contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
