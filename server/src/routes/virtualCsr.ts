import { Router } from 'express';
import { prisma } from '../index';
import { approveSingleAction, approveTurn, rejectTurn, runVirtualCsrTurn } from '../services/virtualCsr/agent';
import { listBookingSetup } from '../services/virtualCsr/stApi';

const router = Router();

const MODES = ['shadow', 'supervised', 'autonomous'];
const ENGINES = ['legacy', 'claude'];

function userIdOf(req: any): string {
  return (req.session as any)?.userId || 'unknown';
}

// ------------------------------------------------------------------ config

router.get('/:tenantId/virtual-csr/config', async (req, res) => {
  try {
    const config = await prisma.aIAgentConfig.findUnique({ where: { tenantId: req.params.tenantId } });
    res.json({
      configured: !!config,
      enabled: config?.enabled ?? false,
      agentEngine: config?.agentEngine ?? 'legacy',
      agentMode: config?.agentMode ?? 'shadow',
      botName: config?.botName ?? null,
      csrInstructions: config?.csrInstructions ?? '',
      bookableJobTypes: config?.bookableJobTypes ?? [],
      emergencyAlertPhone: config?.emergencyAlertPhone ?? '',
      defaultCampaignId: config?.defaultCampaignId ?? null,
      anthropicKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
      model: process.env.VIRTUAL_CSR_MODEL || 'claude-sonnet-5-5',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:tenantId/virtual-csr/config', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const b = req.body ?? {};
    const data: Record<string, unknown> = {};
    if (b.agentEngine !== undefined) {
      if (!ENGINES.includes(b.agentEngine)) return res.status(400).json({ error: 'agentEngine must be legacy or claude' });
      data.agentEngine = b.agentEngine;
    }
    if (b.agentMode !== undefined) {
      if (!MODES.includes(b.agentMode)) return res.status(400).json({ error: 'agentMode must be shadow, supervised or autonomous' });
      data.agentMode = b.agentMode;
    }
    if (b.csrInstructions !== undefined) data.csrInstructions = String(b.csrInstructions).slice(0, 20000);
    if (b.emergencyAlertPhone !== undefined) data.emergencyAlertPhone = String(b.emergencyAlertPhone).trim() || null;
    if (b.botName !== undefined) data.botName = String(b.botName).trim() || null;
    if (b.defaultCampaignId !== undefined) data.defaultCampaignId = b.defaultCampaignId ? String(b.defaultCampaignId) : null;
    if (b.bookableJobTypes !== undefined) {
      if (!Array.isArray(b.bookableJobTypes)) return res.status(400).json({ error: 'bookableJobTypes must be a list' });
      data.bookableJobTypes = b.bookableJobTypes.map((j: any) => ({
        key: String(j.key || j.label || '').replace(/[^a-z0-9_]/gi, '_').toLowerCase(),
        label: String(j.label || ''),
        jobTypeId: Number(j.jobTypeId),
        businessUnitId: Number(j.businessUnitId),
        whenToUse: String(j.whenToUse || ''),
      }));
    }
    const config = await prisma.aIAgentConfig.upsert({
      where: { tenantId },
      update: data,
      create: { tenantId, ...data },
    });
    res.json(config);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** ServiceTitan job types and business units, to pick what the agent may book. */
router.get('/:tenantId/virtual-csr/booking-setup', async (req, res) => {
  try {
    res.json(await listBookingSetup(req.params.tenantId));
  } catch (error: any) {
    res.status(502).json({ error: error.message });
  }
});

// ------------------------------------------------------------------ review

/** Drafts waiting for a CSR, newest first. */
router.get('/:tenantId/virtual-csr/drafts', async (req, res) => {
  try {
    const turns = await prisma.csrAgentTurn.findMany({
      where: { tenantId: req.params.tenantId, status: 'DRAFT' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { actions: { orderBy: { seq: 'asc' } } },
    });
    res.json(turns);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** Agent turns for one conversation, with every action, newest first. */
router.get('/:tenantId/virtual-csr/conversations/:conversationId/turns', async (req, res) => {
  try {
    const turns = await prisma.csrAgentTurn.findMany({
      where: { tenantId: req.params.tenantId, conversationId: req.params.conversationId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { actions: { orderBy: { seq: 'asc' } } },
    });
    res.json(turns);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** Run the agent now on a conversation (for example after rejecting a draft). */
router.post('/:tenantId/virtual-csr/conversations/:conversationId/run', async (req, res) => {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.conversationId, tenantId: req.params.tenantId },
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    const turnId = await runVirtualCsrTurn(conversation.id);
    res.json({ turnId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function turnForTenant(tenantId: string, turnId: string) {
  return prisma.csrAgentTurn.findFirst({ where: { id: turnId, tenantId } });
}

router.post('/:tenantId/virtual-csr/turns/:turnId/approve', async (req, res) => {
  try {
    if (!(await turnForTenant(req.params.tenantId, req.params.turnId))) return res.status(404).json({ error: 'Draft not found' });
    const { text, note } = req.body ?? {};
    const result = await approveTurn(req.params.turnId, userIdOf(req), typeof text === 'string' ? text : undefined, note);
    res.status(result.error ? 409 : 200).json(result);
  } catch (error: any) {
    res.status(409).json({ error: error.message });
  }
});

router.post('/:tenantId/virtual-csr/turns/:turnId/reject', async (req, res) => {
  try {
    if (!(await turnForTenant(req.params.tenantId, req.params.turnId))) return res.status(404).json({ error: 'Draft not found' });
    await rejectTurn(req.params.turnId, userIdOf(req), req.body?.note);
    res.json({ rejected: true });
  } catch (error: any) {
    res.status(409).json({ error: error.message });
  }
});

/** Supervised mode: approve one queued action, such as creating a new account. */
router.post('/:tenantId/virtual-csr/actions/:actionId/approve', async (req, res) => {
  try {
    const action = await prisma.csrAgentAction.findFirst({
      where: { id: req.params.actionId, tenantId: req.params.tenantId },
    });
    if (!action) return res.status(404).json({ error: 'Action not found' });
    const result = await approveSingleAction(action.id);
    res.status(result.ok ? 200 : 409).json(result);
  } catch (error: any) {
    res.status(409).json({ error: error.message });
  }
});

router.post('/:tenantId/virtual-csr/actions/:actionId/reject', async (req, res) => {
  try {
    const updated = await prisma.csrAgentAction.updateMany({
      where: { id: req.params.actionId, tenantId: req.params.tenantId, status: 'PROPOSED' },
      data: { status: 'REJECTED' },
    });
    if (updated.count === 0) return res.status(404).json({ error: 'No pending action found' });
    res.json({ rejected: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
