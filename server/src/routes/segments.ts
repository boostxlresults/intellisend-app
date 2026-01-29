import { Router } from 'express';
import { prisma } from '../index';

const router = Router();

interface TagFilter {
  mode: 'ALL' | 'ANY' | 'NONE';
  tagIds: string[];
}

async function getContactsByTagFilter(
  tenantId: string,
  filter: TagFilter
): Promise<string[]> {
  if (!filter.tagIds || filter.tagIds.length === 0) {
    const allContacts = await prisma.contact.findMany({
      where: { tenantId },
      select: { id: true },
    });
    return allContacts.map(c => c.id);
  }

  if (filter.mode === 'ANY') {
    const contacts = await prisma.contact.findMany({
      where: {
        tenantId,
        tags: {
          some: { tagId: { in: filter.tagIds } },
        },
      },
      select: { id: true },
    });
    return contacts.map(c => c.id);
  }

  if (filter.mode === 'NONE') {
    const contacts = await prisma.contact.findMany({
      where: {
        tenantId,
        NOT: {
          tags: {
            some: { tagId: { in: filter.tagIds } },
          },
        },
      },
      select: { id: true },
    });
    return contacts.map(c => c.id);
  }

  const contacts = await prisma.contact.findMany({
    where: { tenantId },
    include: {
      tags: { select: { tagId: true } },
    },
  });

  return contacts
    .filter(c => {
      const contactTagIds = c.tags.map(t => t.tagId);
      return filter.tagIds.every(tid => contactTagIds.includes(tid));
    })
    .map(c => c.id);
}

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
    const { name, type, contactIds, tagFilter, excludedTagIds } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    
    let memberContactIds = contactIds || [];
    
    if (tagFilter && tagFilter.tagIds && tagFilter.tagIds.length > 0) {
      memberContactIds = await getContactsByTagFilter(tenantId, tagFilter);
    }
    
    if (excludedTagIds && excludedTagIds.length > 0 && memberContactIds.length > 0) {
      const contactsWithExcludedTags = await prisma.contactTag.findMany({
        where: {
          contactId: { in: memberContactIds },
          tagId: { in: excludedTagIds },
        },
        select: { contactId: true },
      });
      const excludedContactIds = new Set(contactsWithExcludedTags.map(ct => ct.contactId));
      memberContactIds = memberContactIds.filter((id: string) => !excludedContactIds.has(id));
    }
    
    const segment = await prisma.segment.create({
      data: {
        tenantId,
        name,
        type: type || 'STATIC',
        definitionJson: tagFilter ? JSON.stringify(tagFilter) : null,
        excludedTagIds: excludedTagIds || [],
        members: memberContactIds.length > 0 ? {
          create: memberContactIds.map((contactId: string) => ({ contactId })),
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

router.post('/:tenantId/segments/preview', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { tagFilter } = req.body;
    
    if (!tagFilter) {
      return res.status(400).json({ error: 'tagFilter is required' });
    }
    
    const contactIds = await getContactsByTagFilter(tenantId, tagFilter);
    
    const contacts = await prisma.contact.findMany({
      where: { id: { in: contactIds.slice(0, 100) } },
      include: {
        tags: { include: { tag: true } },
      },
    });
    
    res.json({
      totalCount: contactIds.length,
      preview: contacts.map(c => ({
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
        tags: c.tags.map(ct => ct.tag.name),
      })),
    });
  } catch (error: any) {
    console.error('Error previewing segment:', error);
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

router.delete('/:tenantId/segments/:segmentId', async (req, res) => {
  try {
    const { tenantId, segmentId } = req.params;
    
    const segment = await prisma.segment.findFirst({
      where: { id: segmentId, tenantId },
    });
    
    if (!segment) {
      return res.status(404).json({ error: 'Segment not found' });
    }
    
    await prisma.segment.delete({
      where: { id: segmentId },
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting segment:', error);
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
    
    let filteredContactIds = contactIds;
    const excludedTagIds: string[] = (segment as any).excludedTagIds || [];
    
    if (excludedTagIds.length > 0 && contactIds.length > 0) {
      const contactsWithExcludedTags = await prisma.contactTag.findMany({
        where: {
          contactId: { in: contactIds },
          tagId: { in: excludedTagIds },
        },
        select: { contactId: true },
      });
      const excludedContactIds = new Set(contactsWithExcludedTags.map(ct => ct.contactId));
      filteredContactIds = contactIds.filter((id: string) => !excludedContactIds.has(id));
    }
    
    const results = await Promise.all(
      filteredContactIds.map(async (contactId: string) => {
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
    
    const skipped = contactIds.length - filteredContactIds.length;
    res.json({ results, skippedByExclusion: skipped });
  } catch (error: any) {
    console.error('Error adding segment members:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
