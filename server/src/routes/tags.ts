import { Router } from 'express';
import { prisma } from '../index';

const router = Router({ mergeParams: true });

const SYSTEM_TAG_MESSAGE =
  'This tag is managed automatically by the ServiceTitan sync and cannot be changed by hand.';

router.get('/:tenantId/tags', async (req, res) => {
  try {
    const { tenantId } = req.params;

    const tags = await prisma.tag.findMany({
      where: { tenantId },
      include: {
        _count: {
          select: { contacts: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const result = tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      isSystem: tag.isSystem,
      contactCount: tag._count.contacts,
      createdAt: tag.createdAt,
    }));

    res.json(result);
  } catch (error: any) {
    console.error('Error fetching tags:', error);
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
});

router.post('/:tenantId/tags', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { name, color } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Tag name is required' });
    }

    const existingTag = await prisma.tag.findFirst({
      where: { tenantId, name: name.trim().toLowerCase() },
    });

    if (existingTag) {
      return res.status(400).json({ error: 'Tag already exists' });
    }

    const tag = await prisma.tag.create({
      data: {
        tenantId,
        name: name.trim().toLowerCase(),
        color: color || null,
      },
    });

    res.status(201).json(tag);
  } catch (error: any) {
    console.error('Error creating tag:', error);
    res.status(500).json({ error: 'Failed to create tag' });
  }
});

router.delete('/:tenantId/tags/:tagId', async (req, res) => {
  try {
    const { tenantId, tagId } = req.params;

    const tag = await prisma.tag.findFirst({ where: { id: tagId, tenantId } });
    if (!tag) {
      return res.status(404).json({ error: 'Tag not found' });
    }
    if (tag.isSystem) {
      return res.status(403).json({ error: SYSTEM_TAG_MESSAGE });
    }

    await prisma.tag.delete({
      where: { id: tagId },
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting tag:', error);
    res.status(500).json({ error: 'Failed to delete tag' });
  }
});

router.post('/:tenantId/contacts/:contactId/tags', async (req, res) => {
  try {
    const { tenantId, contactId } = req.params;
    const { tagIds, tagNames } = req.body;

    if (tagIds && Array.isArray(tagIds) && tagIds.length > 0) {
      const systemCount = await prisma.tag.count({ where: { id: { in: tagIds }, isSystem: true } });
      if (systemCount > 0) {
        return res.status(403).json({ error: SYSTEM_TAG_MESSAGE });
      }
    }

    if (tagIds && Array.isArray(tagIds)) {
      for (const tagId of tagIds) {
        await prisma.contactTag.upsert({
          where: {
            contactId_tagId: { contactId, tagId },
          },
          update: {},
          create: { contactId, tagId },
        });
      }
    }

    if (tagNames && Array.isArray(tagNames)) {
      for (const name of tagNames) {
        const normalizedName = name.trim().toLowerCase();

        let tag = await prisma.tag.findFirst({
          where: { tenantId, name: normalizedName },
        });

        if (!tag) {
          tag = await prisma.tag.create({
            data: { tenantId, name: normalizedName },
          });
        }
        if (tag.isSystem) continue;

        await prisma.contactTag.upsert({
          where: {
            contactId_tagId: { contactId, tagId: tag.id },
          },
          update: {},
          create: { contactId, tagId: tag.id },
        });
      }
    }

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      include: {
        tags: {
          include: { tag: true },
        },
      },
    });

    res.json(contact);
  } catch (error: any) {
    console.error('Error adding tags to contact:', error);
    res.status(500).json({ error: 'Failed to add tags' });
  }
});

router.delete('/:tenantId/contacts/:contactId/tags/:tagId', async (req, res) => {
  try {
    const { contactId, tagId } = req.params;

    const tag = await prisma.tag.findUnique({ where: { id: tagId } });
    if (tag?.isSystem) {
      return res.status(403).json({ error: SYSTEM_TAG_MESSAGE });
    }

    await prisma.contactTag.delete({
      where: {
        contactId_tagId: { contactId, tagId },
      },
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error removing tag from contact:', error);
    res.status(500).json({ error: 'Failed to remove tag' });
  }
});

export async function upsertTagsForContact(
  tenantId: string,
  contactId: string,
  tagNames: string[]
): Promise<void> {
  for (const name of tagNames) {
    const normalizedName = name.trim().toLowerCase();

    if (!normalizedName) continue;

    let tag = await prisma.tag.findFirst({
      where: { tenantId, name: normalizedName },
    });

    if (!tag) {
      tag = await prisma.tag.create({
        data: { tenantId, name: normalizedName },
      });
    }

    // System tags are owned by the ServiceTitan sync; never hand-apply them.
    if (tag.isSystem) continue;

    await prisma.contactTag.upsert({
      where: {
        contactId_tagId: { contactId, tagId: tag.id },
      },
      update: {},
      create: { contactId, tagId: tag.id },
    });
  }
}

export default router;
