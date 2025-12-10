import { Router } from 'express';
import { prisma } from '../index';
import { generateImprovedMessage } from '../ai/aiEngine';

const router = Router();

router.get('/:tenantId/campaigns', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const campaigns = await prisma.campaign.findMany({
      where: { tenantId },
      include: {
        segment: true,
        steps: {
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    
    res.json(campaigns);
  } catch (error: any) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/campaigns', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { name, description, type, segmentId, steps } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    
    const campaign = await prisma.campaign.create({
      data: {
        tenantId,
        name,
        description,
        type: type || 'BLAST',
        segmentId,
        steps: steps ? {
          create: steps.map((step: any, index: number) => ({
            order: index + 1,
            delayMinutes: step.delayMinutes || 0,
            bodyTemplate: step.bodyTemplate,
            useAiAssist: step.useAiAssist || false,
          })),
        } : undefined,
      },
      include: {
        segment: true,
        steps: {
          orderBy: { order: 'asc' },
        },
      },
    });
    
    res.status(201).json(campaign);
  } catch (error: any) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:tenantId/campaigns/:campaignId', async (req, res) => {
  try {
    const { tenantId, campaignId } = req.params;
    
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
      include: {
        segment: {
          include: {
            members: {
              include: { contact: true },
            },
          },
        },
        steps: {
          orderBy: { order: 'asc' },
        },
      },
    });
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    res.json(campaign);
  } catch (error: any) {
    console.error('Error fetching campaign:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/campaigns/:campaignId/schedule', async (req, res) => {
  try {
    const { tenantId, campaignId } = req.params;
    const { startAt } = req.body;
    
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
    });
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    const updated = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: 'SCHEDULED',
        startAt: startAt ? new Date(startAt) : new Date(),
      },
      include: {
        segment: true,
        steps: true,
      },
    });
    
    res.json(updated);
  } catch (error: any) {
    console.error('Error scheduling campaign:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/campaigns/ai-improve', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { text, goal, personaId } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }
    
    const validGoals = ['higher_reply_rate', 'more_compliant', 'shorter', 'friendlier'];
    const goalValue = validGoals.includes(goal) ? goal : 'higher_reply_rate';
    
    const result = await generateImprovedMessage({
      tenantId,
      personaId,
      originalText: text,
      goal: goalValue,
    });
    
    res.json(result);
  } catch (error: any) {
    console.error('Error improving message:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/ai/preview-message', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { text, goal } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }
    
    const validGoals = ['higher_reply_rate', 'more_compliant', 'shorter', 'friendlier'];
    const goalValue = validGoals.includes(goal) ? goal : undefined;
    
    const result = await generateImprovedMessage({
      tenantId,
      originalText: text,
      goal: goalValue,
    });
    
    res.json(result);
  } catch (error: any) {
    console.error('Error previewing message:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
