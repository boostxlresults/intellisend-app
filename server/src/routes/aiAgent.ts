import { Router, Request, Response } from 'express';
import { prisma } from '../index';
import { handleInboundMessage } from '../services/aiAgent/conversationHandler';
import { classifyIntent } from '../services/aiAgent/intentClassifier';

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

// ========== AI TEST CONSOLE ENDPOINTS ==========

router.post('/tenants/:tenantId/ai-agent/test/start', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const { contactId, customerName, customerPhone, mockFirstName, mockLastName, mockPhone } = req.body;

    const nameParts = (customerName || '').trim().split(/\s+/);
    const resolvedFirstName = mockFirstName || nameParts[0] || 'Test';
    const resolvedLastName = mockLastName || nameParts.slice(1).join(' ') || 'Customer';
    const resolvedPhone = mockPhone || customerPhone || `+1555${Date.now().toString().slice(-7)}`;

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    let contact;
    if (contactId) {
      contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId } });
      if (!contact) return res.status(404).json({ error: 'Contact not found' });
    } else {
      contact = await prisma.contact.create({
        data: {
          tenantId,
          firstName: resolvedFirstName,
          lastName: resolvedLastName,
          phone: resolvedPhone,
        },
      });
    }

    const conversation = await prisma.conversation.create({
      data: {
        tenantId,
        contactId: contact.id,
        phoneNumber: contact.phone,
        isTestConversation: true,
      },
    });

    const config = await prisma.aIAgentConfig.findUnique({ where: { tenantId } });

    res.json({
      testSessionId: conversation.id,
      contact: {
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
      },
      conversationId: conversation.id,
      aiEnabled: config?.enabled ?? false,
      autoRespond: config?.autoRespond ?? false,
    });
  } catch (error: any) {
    console.error('Error starting AI test session:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/tenants/:tenantId/ai-agent/test/message', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const { conversationId, message } = req.body;

    if (!conversationId || !message) {
      return res.status(400).json({ error: 'conversationId and message are required' });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });
    if (!conversation) return res.status(404).json({ error: 'Test conversation not found' });

    await prisma.message.create({
      data: {
        tenantId,
        conversationId,
        contactId: conversation.contactId,
        direction: 'INBOUND',
        body: message,
        fromNumber: conversation.phoneNumber || 'test',
        toNumber: 'test-console',
        status: 'received',
      },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    const startTime = Date.now();
    const aiResponse = await handleInboundMessage(
      conversationId,
      tenantId,
      conversation.contactId,
      message
    );
    const processingTime = Date.now() - startTime;

    if (aiResponse?.shouldRespond && aiResponse.responseText) {
      await prisma.message.create({
        data: {
          tenantId,
          conversationId,
          contactId: conversation.contactId,
          direction: 'OUTBOUND',
          body: aiResponse.responseText,
          fromNumber: 'ai-agent',
          toNumber: conversation.phoneNumber || 'test',
          status: 'test-mode',
        },
      });
    }

    const session = await prisma.aIAgentSession.findUnique({
      where: { conversationId },
    });

    res.json({
      aiResponse: aiResponse ? {
        shouldRespond: aiResponse.shouldRespond,
        responseText: aiResponse.responseText || null,
        newState: aiResponse.newState,
        outcome: aiResponse.outcome || null,
        stCustomerId: aiResponse.stCustomerId || null,
        stLocationId: aiResponse.stLocationId || null,
        stJobId: aiResponse.stJobId || null,
      } : null,
      session: session ? {
        id: session.id,
        state: session.state,
        outcome: session.outcome,
        messageCount: session.messageCount,
        lastIntent: session.lastIntent,
        stExistingCustomer: session.stExistingCustomer,
        stAddressOnFile: session.stAddressOnFile,
        stEnterpriseContext: session.stEnterpriseContext,
        stIsMember: session.stIsMember,
      } : null,
      processingTimeMs: processingTime,
    });
  } catch (error: any) {
    console.error('Error in AI test message:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/tenants/:tenantId/ai-agent/test/reset', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const { conversationId } = req.body;

    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId is required' });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    const session = await prisma.aIAgentSession.findUnique({
      where: { conversationId },
    });

    if (session) {
      await prisma.aIAgentSession.update({
        where: { id: session.id },
        data: {
          state: 'INBOUND_RECEIVED',
          outcome: 'PENDING',
          messageCount: 0,
          lastIntent: null,
          stContextChecked: false,
          stExistingCustomer: false,
          stAddressOnFile: null,
          stCityOnFile: null,
          stStateOnFile: null,
          stEnterpriseContext: null,
          stIsMember: false,
          stLastServiceDate: null,
        },
      });
    }

    await prisma.message.deleteMany({ where: { conversationId } });

    res.json({ success: true, message: 'Test session reset' });
  } catch (error: any) {
    console.error('Error resetting AI test session:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/tenants/:tenantId/ai-agent/test/history/:conversationId', async (req: Request, res: Response) => {
  try {
    const { tenantId, conversationId } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        contact: true,
      },
    });

    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    const session = await prisma.aIAgentSession.findUnique({
      where: { conversationId },
    });

    res.json({
      messages: conversation.messages,
      contact: conversation.contact,
      session,
    });
  } catch (error: any) {
    console.error('Error getting test history:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== AUTOMATED TEST SCENARIOS ==========

interface TestScenarioStep {
  customerMessage: string;
  expectedIntent?: string;
  expectedState?: string;
  expectedOutcome?: string;
  description: string;
}

interface TestScenario {
  name: string;
  description: string;
  steps: TestScenarioStep[];
}

const TEST_SCENARIOS: TestScenario[] = [
  {
    name: 'Opt-Out Detection',
    description: 'Customer sends STOP keyword - should immediately opt out',
    steps: [
      { customerMessage: 'STOP', expectedIntent: 'OPT_OUT', description: 'STOP keyword should trigger opt-out' },
    ],
  },
  {
    name: 'Opt-Out Variations',
    description: 'Various opt-out keywords should all be detected',
    steps: [
      { customerMessage: 'UNSUBSCRIBE', expectedIntent: 'OPT_OUT', description: 'UNSUBSCRIBE should trigger opt-out' },
    ],
  },
  {
    name: 'Customer Interest',
    description: 'Customer expresses soft interest (curious, not committing)',
    steps: [
      { customerMessage: 'That sounds interesting, tell me more about your AC service', expectedIntent: 'INTERESTED', description: 'Curious but not committing — should detect INTERESTED' },
    ],
  },
  {
    name: 'Strong Interest with Yes',
    description: 'Customer says yes they want service — correctly classified as BOOK_YES',
    steps: [
      { customerMessage: 'Yes I am interested in getting my AC serviced', expectedIntent: 'BOOK_YES', description: '"Yes I am interested in getting X" = booking intent, not soft interest' },
    ],
  },
  {
    name: 'Booking Request',
    description: 'Customer wants to book an appointment',
    steps: [
      { customerMessage: 'I would like to schedule an appointment for Thursday', expectedIntent: 'BOOK_YES', description: 'Should detect booking intent' },
    ],
  },
  {
    name: 'Not Interested',
    description: 'Customer declines service',
    steps: [
      { customerMessage: 'No thanks, I am not interested', expectedIntent: 'NOT_INTERESTED', description: 'Should detect decline' },
    ],
  },
  {
    name: 'Info Request',
    description: 'Customer asks a question',
    steps: [
      { customerMessage: 'How much does a tune-up cost?', expectedIntent: 'INFO_REQUEST', description: 'Should detect information request' },
    ],
  },
  {
    name: 'Wrong Number',
    description: 'Customer says wrong number',
    steps: [
      { customerMessage: 'Wrong number, I never signed up for this', expectedIntent: 'WRONG_NUMBER', description: 'Should detect wrong number' },
    ],
  },
  {
    name: 'Call Me Request',
    description: 'Customer wants a phone call',
    steps: [
      { customerMessage: 'Can someone call me please?', expectedIntent: 'CALL_ME', description: 'Should detect call request' },
    ],
  },
  {
    name: 'Multi-Turn: Interest to Booking',
    description: 'Full flow from interest through booking attempt',
    steps: [
      { customerMessage: 'Yeah I could use some help with my plumbing', expectedIntent: 'INTERESTED', description: 'Initial interest' },
      { customerMessage: 'Yes I would like to book an appointment', expectedIntent: 'BOOK_YES', description: 'Booking after interest' },
    ],
  },
  {
    name: 'Graceful Handling of Nonsense',
    description: 'Random or unclear messages should be handled gracefully',
    steps: [
      { customerMessage: 'asdfghjkl 🤷', expectedIntent: 'UNCLEAR', description: 'Should handle nonsense gracefully' },
    ],
  },
  {
    name: 'Not Now / Maybe Later',
    description: 'Customer says not right now but maybe later',
    steps: [
      { customerMessage: 'Not right now, maybe in a few months', expectedIntent: 'NOT_NOW', description: 'Should detect "not now" intent' },
    ],
  },
];

router.get('/tenants/:tenantId/ai-agent/test/scenarios', async (_req: Request, res: Response) => {
  res.json(TEST_SCENARIOS.map((s, i) => ({
    id: i,
    name: s.name,
    description: s.description,
    stepCount: s.steps.length,
  })));
});

router.post('/tenants/:tenantId/ai-agent/test/run-scenario', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const { scenarioId } = req.body;

    const scenario = TEST_SCENARIOS[scenarioId];
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const contact = await prisma.contact.create({
      data: {
        tenantId,
        firstName: 'AutoTest',
        lastName: scenario.name.replace(/\s+/g, ''),
        phone: `+1555${Date.now().toString().slice(-7)}`,
      },
    });

    const conversation = await prisma.conversation.create({
      data: {
        tenantId,
        contactId: contact.id,
        phoneNumber: contact.phone,
        isTestConversation: true,
      },
    });

    const results: Array<{
      step: number;
      description: string;
      customerMessage: string;
      expectedIntent?: string;
      actualIntent?: string;
      expectedState?: string;
      actualState?: string;
      aiResponse?: string;
      passed: boolean;
      processingTimeMs: number;
      failReason?: string;
    }> = [];

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];

      await prisma.message.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          contactId: contact.id,
          direction: 'INBOUND',
          body: step.customerMessage,
          fromNumber: contact.phone,
          toNumber: 'test-console',
          status: 'received',
        },
      });

      const startTime = Date.now();
      const aiResponse = await handleInboundMessage(
        conversation.id,
        tenantId,
        contact.id,
        step.customerMessage
      );
      const processingTime = Date.now() - startTime;

      if (aiResponse?.shouldRespond && aiResponse.responseText) {
        await prisma.message.create({
          data: {
            tenantId,
            conversationId: conversation.id,
            contactId: contact.id,
            direction: 'OUTBOUND',
            body: aiResponse.responseText,
            fromNumber: 'ai-agent',
            toNumber: contact.phone,
            status: 'test-mode',
          },
        });
      }

      const session = await prisma.aIAgentSession.findUnique({
        where: { conversationId: conversation.id },
      });

      const actualIntent = session?.lastIntent || (aiResponse?.outcome === 'OPT_OUT' ? 'OPT_OUT' : null);
      let passed = true;
      let failReason: string | undefined;

      if (step.expectedIntent && actualIntent !== step.expectedIntent) {
        passed = false;
        failReason = `Expected intent "${step.expectedIntent}" but got "${actualIntent}"`;
      }
      if (step.expectedState && session?.state !== step.expectedState) {
        passed = false;
        failReason = (failReason ? failReason + '; ' : '') + `Expected state "${step.expectedState}" but got "${session?.state}"`;
      }

      results.push({
        step: i + 1,
        description: step.description,
        customerMessage: step.customerMessage,
        expectedIntent: step.expectedIntent,
        actualIntent: actualIntent || undefined,
        expectedState: step.expectedState,
        actualState: session?.state,
        aiResponse: aiResponse?.responseText,
        passed,
        processingTimeMs: processingTime,
        failReason,
      });
    }

    await prisma.message.deleteMany({ where: { conversationId: conversation.id } });
    if (await prisma.aIAgentSession.findUnique({ where: { conversationId: conversation.id } })) {
      await prisma.aIAgentSession.delete({ where: { conversationId: conversation.id } });
    }
    await prisma.conversation.delete({ where: { id: conversation.id } });
    await prisma.contact.delete({ where: { id: contact.id } });

    const totalPassed = results.filter(r => r.passed).length;
    const totalFailed = results.filter(r => !r.passed).length;

    res.json({
      scenario: scenario.name,
      description: scenario.description,
      totalSteps: results.length,
      passed: totalPassed,
      failed: totalFailed,
      allPassed: totalFailed === 0,
      results,
    });
  } catch (error: any) {
    console.error('Error running AI test scenario:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/tenants/:tenantId/ai-agent/test/run-all-scenarios', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const allResults: Array<{
      scenarioId: number;
      name: string;
      allPassed: boolean;
      passed: number;
      failed: number;
      results: any[];
    }> = [];

    for (let scenarioId = 0; scenarioId < TEST_SCENARIOS.length; scenarioId++) {
      const scenario = TEST_SCENARIOS[scenarioId];

      const contact = await prisma.contact.create({
        data: {
          tenantId,
          firstName: 'AutoTest',
          lastName: `S${scenarioId}`,
          phone: `+1555${Date.now().toString().slice(-7)}`,
        },
      });

      const conversation = await prisma.conversation.create({
        data: {
          tenantId,
          contactId: contact.id,
          phoneNumber: contact.phone,
          isTestConversation: true,
        },
      });

      const stepResults: any[] = [];

      for (const step of scenario.steps) {
        await prisma.message.create({
          data: {
            tenantId,
            conversationId: conversation.id,
            contactId: contact.id,
            direction: 'INBOUND',
            body: step.customerMessage,
            fromNumber: contact.phone,
            toNumber: 'test-console',
            status: 'received',
          },
        });

        const startTime = Date.now();
        const aiResponse = await handleInboundMessage(
          conversation.id, tenantId, contact.id, step.customerMessage
        );
        const processingTime = Date.now() - startTime;

        if (aiResponse?.shouldRespond && aiResponse.responseText) {
          await prisma.message.create({
            data: {
              tenantId,
              conversationId: conversation.id,
              contactId: contact.id,
              direction: 'OUTBOUND',
              body: aiResponse.responseText,
              fromNumber: 'ai-agent',
              toNumber: contact.phone,
              status: 'test-mode',
            },
          });
        }

        const session = await prisma.aIAgentSession.findUnique({
          where: { conversationId: conversation.id },
        });

        const actualIntent = session?.lastIntent || (aiResponse?.outcome === 'OPT_OUT' ? 'OPT_OUT' : null);
        let passed = true;
        let failReason: string | undefined;

        if (step.expectedIntent && actualIntent !== step.expectedIntent) {
          passed = false;
          failReason = `Expected "${step.expectedIntent}" got "${actualIntent}"`;
        }

        stepResults.push({
          description: step.description,
          customerMessage: step.customerMessage,
          expectedIntent: step.expectedIntent,
          actualIntent,
          aiResponse: aiResponse?.responseText,
          passed,
          processingTimeMs: processingTime,
          failReason,
        });
      }

      // Cleanup
      await prisma.message.deleteMany({ where: { conversationId: conversation.id } });
      const sess = await prisma.aIAgentSession.findUnique({ where: { conversationId: conversation.id } });
      if (sess) await prisma.aIAgentSession.delete({ where: { conversationId: conversation.id } });
      await prisma.conversation.delete({ where: { id: conversation.id } });
      await prisma.contact.delete({ where: { id: contact.id } });

      const totalPassed = stepResults.filter((r: any) => r.passed).length;
      const totalFailed = stepResults.filter((r: any) => !r.passed).length;

      allResults.push({
        scenarioId,
        name: scenario.name,
        allPassed: totalFailed === 0,
        passed: totalPassed,
        failed: totalFailed,
        results: stepResults,
      });

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const totalScenarios = allResults.length;
    const scenariosPassed = allResults.filter(r => r.allPassed).length;

    res.json({
      totalScenarios,
      scenariosPassed,
      scenariosFailed: totalScenarios - scenariosPassed,
      allPassed: scenariosPassed === totalScenarios,
      scenarios: allResults,
    });
  } catch (error: any) {
    console.error('Error running all AI test scenarios:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
