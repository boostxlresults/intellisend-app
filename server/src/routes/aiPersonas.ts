import { Router } from 'express';
import { prisma } from '../index';

const router = Router();

router.get('/:tenantId/ai-personas', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const personas = await prisma.aiPersona.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    
    res.json(personas);
  } catch (error: any) {
    console.error('Error fetching AI personas:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/ai-personas', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { name, description, systemPrompt, canAutoReply } = req.body;
    
    if (!name || !systemPrompt) {
      return res.status(400).json({ error: 'name and systemPrompt are required' });
    }
    
    const persona = await prisma.aiPersona.create({
      data: {
        tenantId,
        name,
        description,
        systemPrompt,
        canAutoReply: canAutoReply || false,
      },
    });
    
    res.status(201).json(persona);
  } catch (error: any) {
    console.error('Error creating AI persona:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:tenantId/ai-personas/:personaId', async (req, res) => {
  try {
    const { tenantId, personaId } = req.params;
    
    const persona = await prisma.aiPersona.findFirst({
      where: { id: personaId, tenantId },
    });
    
    if (!persona) {
      return res.status(404).json({ error: 'AI persona not found' });
    }
    
    res.json(persona);
  } catch (error: any) {
    console.error('Error fetching AI persona:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:tenantId/ai-personas/:personaId', async (req, res) => {
  try {
    const { tenantId, personaId } = req.params;
    const { name, description, systemPrompt, canAutoReply } = req.body;
    
    const persona = await prisma.aiPersona.findFirst({
      where: { id: personaId, tenantId },
    });
    
    if (!persona) {
      return res.status(404).json({ error: 'AI persona not found' });
    }
    
    const updated = await prisma.aiPersona.update({
      where: { id: personaId },
      data: {
        name,
        description,
        systemPrompt,
        canAutoReply,
      },
    });
    
    res.json(updated);
  } catch (error: any) {
    console.error('Error updating AI persona:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:tenantId/ai-personas/:personaId', async (req, res) => {
  try {
    const { tenantId, personaId } = req.params;
    
    const persona = await prisma.aiPersona.findFirst({
      where: { id: personaId, tenantId },
    });
    
    if (!persona) {
      return res.status(404).json({ error: 'AI persona not found' });
    }
    
    await prisma.aiPersona.delete({
      where: { id: personaId },
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting AI persona:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
