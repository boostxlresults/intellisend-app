import { Router } from 'express';
import { prisma } from '../index';
import { resolveContactIds, refreshSegmentMembers, TagFilter, TagMatchMode } from '../services/segmentResolver';

const router = Router();

function parseTagFilter(raw: any): TagFilter | null {
  if (!raw || !Array.isArray(raw.tagIds)) return null;
  const mode: TagMatchMode = ['ALL', 'ANY', 'NONE'].includes(raw.mode) ? raw.mode : 'ANY';
  return { mode, tagIds: raw.tagIds.filter((t: unknown) => typeof t === 'string' && t) };
}

async function assertTagsBelongToTenant(tenantId: string, tagIds: string[]): Promise<boolean> {
  if (tagIds.length === 0) return true;
  const count = await prisma.tag.count({ where: { tenantId, id: { in: tagIds } } });
  return count === new Set(tagIds).size;
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

/**
 * Create a segment.
 *
 * STATIC: a fixed list. Members come from `contactIds`, or from `tagFilter`
 *   evaluated once, right now.
 * DYNAMIC: a saved rule (`tagFilter` + `excludedTagIds`). Members are
 *   re-evaluated after every ServiceTitan sync and again right before any
 *   campaign that uses the segment sends.
 */
router.post('/:tenantId/segments', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { name, contactIds } = req.body;
    const type: 'STATIC' | 'DYNAMIC' = req.body.type === 'DYNAMIC' ? 'DYNAMIC' : 'STATIC';
    const tagFilter = parseTagFilter(req.body.tagFilter);
    const excludedTagIds: string[] = Array.isArray(req.body.excludedTagIds) ? req.body.excludedTagIds : [];
    
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (type === 'DYNAMIC' && (!tagFilter || tagFilter.tagIds.length === 0)) {
      return res.status(400).json({ error: 'A dynamic segment needs at least one tag in its filter' });
    }
    if (!(await assertTagsBelongToTenant(tenantId, [...(tagFilter?.tagIds ?? []), ...excludedTagIds]))) {
      return res.status(400).json({ error: 'One or more tags do not belong to this account' });
    }
    
    let memberContactIds: string[] = Array.isArray(contactIds) ? contactIds : [];
    
    if (tagFilter && tagFilter.tagIds.length > 0) {
      memberContactIds = await resolveContactIds(tenantId, tagFilter, excludedTagIds);
    } else if (excludedTagIds.length > 0 && memberContactIds.length > 0) {
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
        type,
        definitionJson: tagFilter ? JSON.stringify(tagFilter) : null,
        excludedTagIds,
      },
    });

    for (let i = 0; i < memberContactIds.length; i += 1000) {
      await prisma.segmentMember.createMany({
        data: memberContactIds.slice(i, i + 1000).map((contactId) => ({ segmentId: segment.id, contactId })),
        skipDuplicates: true,
      });
    }

    const created = await prisma.segment.findUnique({
      where: { id: segment.id },
      include: { _count: { select: { members: true } } },
    });
    
    res.status(201).json(created);
  } catch (error: any) {
    console.error('Error creating segment:', error);
    res.status(500).json({ error: error.message });
  }
});

/** Count and sample the contacts a tag filter would match, without saving anything. */
router.post('/:tenantId/segments/preview', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const tagFilter = parseTagFilter(req.body.tagFilter);
    const excludedTagIds: string[] = Array.isArray(req.body.excludedTagIds) ? req.body.excludedTagIds : [];
    
    if (!tagFilter) {
      return res.status(400).json({ error: 'tagFilter is required' });
    }
    
    const contactIds = await resolveContactIds(tenantId, tagFilter, excludedTagIds);
    
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
        tags: c.tags.map(ct => ({ id: ct.tagId, name: ct.tag.name, color: ct.tag.color })),
      })),
    });
  } catch (error: any) {
    console.error('Error previewing segment:', error);
    res.status(500).json({ error: error.message });
  }
});

/** Re-evaluate a dynamic segment now. */
router.post('/:tenantId/segments/:segmentId/refresh', async (req, res) => {
  try {
    const { tenantId, segmentId } = req.params;
    const segment = await prisma.segment.findFirst({ where: { id: segmentId, tenantId } });
    if (!segment) {
      return res.status(404).json({ error: 'Segment not found' });
    }
    const result = await refreshSegmentMembers(segmentId);
    res.json(result);
  } catch (error: any) {
    console.error('Error refreshing segment:', error);
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
    
    if (segment.type === 'DYNAMIC') {
      return res.status(400).json({ error: 'Members of a dynamic segment come from its tag rule and cannot be added by hand' });
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
