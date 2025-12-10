import { Router } from 'express';
import { prisma } from '../index';

const router = Router();

router.get('/:tenantId/kb-articles', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { topic } = req.query;
    
    const where: any = { tenantId };
    if (topic) {
      where.topic = topic;
    }
    
    const articles = await prisma.knowledgeBaseArticle.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    
    res.json(articles);
  } catch (error: any) {
    console.error('Error fetching KB articles:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/kb-articles', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { title, topic, content, sourceType, sourceUrl } = req.body;
    
    if (!title || !topic || !content) {
      return res.status(400).json({ error: 'title, topic, and content are required' });
    }
    
    const article = await prisma.knowledgeBaseArticle.create({
      data: {
        tenantId,
        title,
        topic,
        content,
        sourceType: sourceType || 'manual',
        sourceUrl,
      },
    });
    
    res.status(201).json(article);
  } catch (error: any) {
    console.error('Error creating KB article:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:tenantId/kb-articles/:articleId', async (req, res) => {
  try {
    const { tenantId, articleId } = req.params;
    
    const article = await prisma.knowledgeBaseArticle.findFirst({
      where: { id: articleId, tenantId },
    });
    
    if (!article) {
      return res.status(404).json({ error: 'KB article not found' });
    }
    
    res.json(article);
  } catch (error: any) {
    console.error('Error fetching KB article:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:tenantId/kb-articles/:articleId', async (req, res) => {
  try {
    const { tenantId, articleId } = req.params;
    const { title, topic, content, sourceType, sourceUrl } = req.body;
    
    const article = await prisma.knowledgeBaseArticle.findFirst({
      where: { id: articleId, tenantId },
    });
    
    if (!article) {
      return res.status(404).json({ error: 'KB article not found' });
    }
    
    const updated = await prisma.knowledgeBaseArticle.update({
      where: { id: articleId },
      data: {
        title,
        topic,
        content,
        sourceType,
        sourceUrl,
      },
    });
    
    res.json(updated);
  } catch (error: any) {
    console.error('Error updating KB article:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:tenantId/kb-articles/:articleId', async (req, res) => {
  try {
    const { tenantId, articleId } = req.params;
    
    const article = await prisma.knowledgeBaseArticle.findFirst({
      where: { id: articleId, tenantId },
    });
    
    if (!article) {
      return res.status(404).json({ error: 'KB article not found' });
    }
    
    await prisma.knowledgeBaseArticle.delete({
      where: { id: articleId },
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting KB article:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
