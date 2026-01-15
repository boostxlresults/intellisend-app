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

router.post('/:tenantId/campaigns/:campaignId/compliance', async (req, res) => {
  try {
    const { tenantId, campaignId } = req.params;
    const { 
      consentVerified, 
      optOutIncluded, 
      quietHoursOk, 
      contentReviewed, 
      notes 
    } = req.body;
    
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
    });
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const allChecked = consentVerified && optOutIncluded && quietHoursOk && contentReviewed;
    
    const updated = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        complianceCheckedAt: new Date(),
        complianceCheckedBy: (req as any).session?.userId || 'unknown',
        complianceConsentVerified: consentVerified || false,
        complianceOptOutIncluded: optOutIncluded || false,
        complianceQuietHoursOk: quietHoursOk || false,
        complianceContentReviewed: contentReviewed || false,
        complianceNotes: notes,
        status: allChecked ? 'DRAFT' : campaign.status,
      },
      include: {
        segment: true,
        steps: true,
      },
    });
    
    res.json(updated);
  } catch (error: any) {
    console.error('Error updating compliance:', error);
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

    if (!campaign.complianceConsentVerified || 
        !campaign.complianceOptOutIncluded || 
        !campaign.complianceQuietHoursOk || 
        !campaign.complianceContentReviewed) {
      return res.status(400).json({ 
        error: 'Campaign must pass compliance checklist before scheduling. Please complete the compliance review first.',
        complianceRequired: true,
      });
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

router.get('/:tenantId/campaigns/:campaignId/variants', async (req, res) => {
  try {
    const { tenantId, campaignId } = req.params;
    
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
    });
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    const variants = await prisma.campaignVariant.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'asc' },
    });
    
    res.json(variants);
  } catch (error: any) {
    console.error('Error fetching variants:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/campaigns/:campaignId/variants', async (req, res) => {
  try {
    const { tenantId, campaignId } = req.params;
    const { name, bodyTemplate, splitPercent, mediaUrl } = req.body;
    
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
    });
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    if (!name || !bodyTemplate) {
      return res.status(400).json({ error: 'name and bodyTemplate are required' });
    }
    
    const existingVariants = await prisma.campaignVariant.findMany({
      where: { campaignId },
    });
    
    const totalPercent = existingVariants.reduce((sum, v) => sum + v.splitPercent, 0);
    const newPercent = splitPercent || Math.floor((100 - totalPercent) / 2);
    
    if (totalPercent + newPercent > 100) {
      return res.status(400).json({ error: 'Total split percentage cannot exceed 100%' });
    }
    
    const variant = await prisma.campaignVariant.create({
      data: {
        campaignId,
        name,
        bodyTemplate,
        splitPercent: newPercent,
        mediaUrl,
      },
    });
    
    res.status(201).json(variant);
  } catch (error: any) {
    console.error('Error creating variant:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:tenantId/campaigns/:campaignId/variants/:variantId', async (req, res) => {
  try {
    const { tenantId, campaignId, variantId } = req.params;
    const { name, bodyTemplate, splitPercent, mediaUrl } = req.body;
    
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
    });
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    const variant = await prisma.campaignVariant.update({
      where: { id: variantId },
      data: {
        name,
        bodyTemplate,
        splitPercent,
        mediaUrl,
      },
    });
    
    res.json(variant);
  } catch (error: any) {
    console.error('Error updating variant:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:tenantId/campaigns/:campaignId/variants/:variantId', async (req, res) => {
  try {
    const { tenantId, campaignId, variantId } = req.params;
    
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
    });
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    await prisma.campaignVariant.delete({
      where: { id: variantId },
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting variant:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:tenantId/campaigns/:campaignId/ab-results', async (req, res) => {
  try {
    const { tenantId, campaignId } = req.params;
    
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
      include: { variants: true },
    });
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    const results = await Promise.all(
      campaign.variants.map(async (variant) => {
        const messages = await prisma.message.findMany({
          where: { campaignId, variantId: variant.id },
        });
        
        const sent = messages.length;
        const delivered = messages.filter(m => m.status === 'delivered').length;
        const failed = messages.filter(m => m.status === 'failed').length;
        
        const events = await prisma.messageEvent.findMany({
          where: { campaignId },
        });
        
        const clicks = await prisma.linkClick.count({
          where: {
            trackedLink: { campaignId },
          },
        });
        
        return {
          variantId: variant.id,
          variantName: variant.name,
          sent,
          delivered,
          failed,
          deliveryRate: sent > 0 ? (delivered / sent * 100).toFixed(1) : '0',
          clicks,
          clickRate: sent > 0 ? (clicks / sent * 100).toFixed(1) : '0',
        };
      })
    );
    
    res.json(results);
  } catch (error: any) {
    console.error('Error fetching A/B results:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
