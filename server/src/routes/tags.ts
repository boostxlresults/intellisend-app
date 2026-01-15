import { Router } from 'express';
import { prisma } from '../index';

const router = Router({ mergeParams: true });

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
    const { tagId } = req.params;

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
