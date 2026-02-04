import { Router, Request, Response } from 'express';
import { prisma } from '../index';

const router = Router();

router.get('/tenants/:tenantId/ai-agent/config', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;

    let config = await prisma.aIAgentConfig.findUnique({
      where: { tenantId },
    });

    if (!config) {
      config = await prisma.aIAgentConfig.create({
        data: {
          tenantId,
          enabled: false,
        },
      });
    }

    res.json(config);
  } catch (error: any) {
    console.error('Error getting AI agent config:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/tenants/:tenantId/ai-agent/config', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const {
      enabled,
      autoRespond,
      maxMessagesPerSession,
      qualificationThreshold,
      defaultBusinessUnitId,
      defaultJobTypeId,
      defaultCampaignId,
      responseDelaySeconds,
    } = req.body;

    const config = await prisma.aIAgentConfig.upsert({
      where: { tenantId },
      update: {
        enabled: enabled ?? undefined,
        autoRespond: autoRespond ?? undefined,
        maxMessagesPerSession: maxMessagesPerSession ?? undefined,
        qualificationThreshold: qualificationThreshold ?? undefined,
        defaultBusinessUnitId: defaultBusinessUnitId ?? undefined,
        defaultJobTypeId: defaultJobTypeId ?? undefined,
        defaultCampaignId: defaultCampaignId ?? undefined,
        responseDelaySeconds: responseDelaySeconds ?? undefined,
      },
      create: {
        tenantId,
        enabled: enabled ?? false,
        autoRespond: autoRespond ?? true,
        maxMessagesPerSession: maxMessagesPerSession ?? 50,
        qualificationThreshold: qualificationThreshold ?? 80,
        defaultBusinessUnitId,
        defaultJobTypeId,
        defaultCampaignId,
        responseDelaySeconds: responseDelaySeconds ?? 30,
      },
    });

    res.json(config);
  } catch (error: any) {
    console.error('Error saving AI agent config:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/tenants/:tenantId/ai-agent/sessions', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const { state, limit = '20' } = req.query;

    const whereClause: any = { tenantId };
    if (state) {
      whereClause.state = state;
    }

    const sessions = await prisma.aIAgentSession.findMany({
      where: whereClause,
      orderBy: { updatedAt: 'desc' },
      take: parseInt(limit as string),
      include: {
        conversation: {
          include: {
            contact: true,
          },
        },
        offerContext: true,
      },
    });

    res.json(sessions);
  } catch (error: any) {
    console.error('Error getting AI agent sessions:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/tenants/:tenantId/ai-agent/sessions/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    const session = await prisma.aIAgentSession.findUnique({
      where: { id: sessionId },
      include: {
        conversation: {
          include: {
            contact: true,
            messages: {
              orderBy: { createdAt: 'asc' },
              take: 50,
            },
          },
        },
        offerContext: true,
      },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(session);
  } catch (error: any) {
    console.error('Error getting AI agent session:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/tenants/:tenantId/ai-agent/sessions/:sessionId/handoff', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    const session = await prisma.aIAgentSession.update({
      where: { id: sessionId },
      data: {
        state: 'HANDOFF_TO_CSR',
        outcome: 'NEEDS_HUMAN',
      },
    });

    res.json({ success: true, session });
  } catch (error: any) {
    console.error('Error handing off session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Reset AI session to allow fresh conversation
router.post('/tenants/:tenantId/ai-agent/sessions/:sessionId/reset', async (req: Request, res: Response) => {
  try {
    const { tenantId, sessionId } = req.params;

    const existingSession = await prisma.aIAgentSession.findUnique({
      where: { id: sessionId },
    });

    if (!existingSession) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (existingSession.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Session does not belong to this tenant' });
    }

    const session = await prisma.aIAgentSession.update({
      where: { id: sessionId },
      data: {
        state: 'INBOUND_RECEIVED',
        outcome: 'PENDING',
        messageCount: 0,
      },
    });

    console.log(`[AI Agent] Session ${sessionId} reset by CSR`);
    res.json({ success: true, session });
  } catch (error: any) {
    console.error('Error resetting session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Reset AI session by conversation ID
router.post('/tenants/:tenantId/conversations/:conversationId/ai-session/reset', async (req: Request, res: Response) => {
  try {
    const { tenantId, conversationId } = req.params;

    const session = await prisma.aIAgentSession.findUnique({
      where: { conversationId },
    });

    if (!session) {
      return res.status(404).json({ error: 'No AI session found for this conversation' });
    }

    if (session.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Session does not belong to this tenant' });
    }

    const updated = await prisma.aIAgentSession.update({
      where: { id: session.id },
      data: {
        state: 'INBOUND_RECEIVED',
        outcome: 'PENDING',
        messageCount: 0,
      },
    });

    console.log(`[AI Agent] Session for conversation ${conversationId} reset by CSR`);
    res.json({ success: true, session: updated });
  } catch (error: any) {
    console.error('Error resetting session:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/tenants/:tenantId/offer-contexts', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;

    const offers = await prisma.offerContext.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        campaign: {
          select: { name: true },
        },
      },
    });

    res.json(offers);
  } catch (error: any) {
    console.error('Error getting offer contexts:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/tenants/:tenantId/offer-contexts', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const {
      campaignId,
      campaignStepId,
      offerType,
      offerName,
      price,
      description,
      businessUnitHint,
      jobTypeHint,
      terms,
      expiresAt,
    } = req.body;

    const offer = await prisma.offerContext.create({
      data: {
        tenantId,
        campaignId,
        campaignStepId,
        offerType,
        offerName,
        price,
        description,
        businessUnitHint,
        jobTypeHint,
        terms,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      },
    });

    res.json(offer);
  } catch (error: any) {
    console.error('Error creating offer context:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
