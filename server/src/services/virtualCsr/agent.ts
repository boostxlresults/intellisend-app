import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../../index';
import { normalizePhone } from '../../utils/phoneNormalize';
import { sendSmsForTenant } from '../../twilio/twilioClient';
import { buildSystemPrompt } from './prompt';
import {
  AgentMode, BookableJobType, ToolContext, executeApprovedAction, hydrateKnown, runTool, toolDefinitions,
} from './tools';

/**
 * Virtual CSR: a Claude agent that answers inbound texts, looks customers up
 * in ServiceTitan, checks real capacity and books unassigned jobs.
 *
 * Modes (AIAgentConfig.agentMode):
 *   shadow      - drafts every reply and every ServiceTitan change; a CSR
 *                 approves, edits or rejects each one in the inbox. Default.
 *   supervised  - sends replies and books on its own; creating new accounts
 *                 waits for a CSR.
 *   autonomous  - acts on its own within the tool policy.
 */

const MODEL = process.env.VIRTUAL_CSR_MODEL || 'claude-sonnet-5-5';
const MAX_STEPS = 12;
const HISTORY_MESSAGES = 40;

let anthropic: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

export function isVirtualCsrConfig(config: { enabled: boolean; agentEngine?: string | null } | null): boolean {
  return !!config && config.enabled && config.agentEngine === 'claude';
}

function parseJobTypes(raw: unknown): BookableJobType[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((j: any, i: number) => ({
      key: String(j.key || `job_type_${i + 1}`).replace(/[^a-z0-9_]/gi, '_').toLowerCase(),
      label: String(j.label || ''),
      jobTypeId: Number(j.jobTypeId),
      businessUnitId: Number(j.businessUnitId),
      whenToUse: String(j.whenToUse || ''),
    }))
    .filter((j) => j.label && Number.isFinite(j.jobTypeId) && Number.isFinite(j.businessUnitId));
}

export async function buildToolContext(conversationId: string, turnId: string, modeOverride?: AgentMode): Promise<ToolContext> {
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { contact: true },
  });
  const [config, settings] = await Promise.all([
    prisma.aIAgentConfig.findUnique({ where: { tenantId: conversation.tenantId } }),
    prisma.tenantSettings.findUnique({ where: { tenantId: conversation.tenantId } }),
  ]);
  return {
    tenantId: conversation.tenantId,
    conversationId,
    contactId: conversation.contactId,
    contactPhone: conversation.contact.phone,
    turnId,
    mode: modeOverride ?? ((config?.agentMode as AgentMode) || 'shadow'),
    timezone: settings?.timezone || 'America/Phoenix',
    campaignId: config?.defaultCampaignId ? Number(config.defaultCampaignId) : null,
    jobTypes: parseJobTypes(config?.bookableJobTypes),
    known: await hydrateKnown(conversationId),
    emergencyAlertPhone: config?.emergencyAlertPhone || null,
  };
}

function transcript(messages: Array<{ direction: string; body: string; createdAt: Date; isAiGenerated: boolean }>, tz: string, company: string): string {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return messages
    .map((m) => `[${fmt.format(m.createdAt)}] ${m.direction === 'INBOUND' ? 'Customer' : company}: ${m.body}`)
    .join('\n');
}

async function sendEmergencyAlert(tenantId: string, alertPhone: string, conversationId: string, contactName: string, reason: string) {
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId }, include: { defaultFromNumber: true } });
  const from = settings?.defaultFromNumber?.phoneNumber;
  if (!from) {
    console.error('[Virtual CSR] Emergency alert not sent: no default from number');
    return;
  }
  const url = `${(process.env.FRONTEND_URL || '').split(',')[0]}/conversations/${conversationId}`;
  await sendSmsForTenant({
    tenantId,
    fromNumber: from,
    toNumber: normalizePhone(alertPhone),
    body: `EMERGENCY text from ${contactName}: ${reason.slice(0, 200)} ${url}`,
    skipOptOutFooter: true,
    skipRateLimitCheck: true,
  }).catch((err) => console.error('[Virtual CSR] Emergency alert failed:', err));
}

async function queueReply(tenantId: string, conversationId: string, contactId: string, phone: string, text: string, delaySeconds: number) {
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId }, include: { defaultFromNumber: true } });
  const fromNumber = settings?.defaultFromNumber?.phoneNumber;
  if (!fromNumber) throw new Error('No default from number configured');
  await prisma.outboundMessageQueue.create({
    data: {
      tenantId, conversationId, contactId,
      phone: normalizePhone(phone), body: text, fromNumber,
      status: 'PENDING',
      processAfter: new Date(Date.now() + delaySeconds * 1000),
    },
  });
}

// ---------------------------------------------------------------- debounce

const timers = new Map<string, NodeJS.Timeout>();

/**
 * Customers often send several texts in a row. Wait for a quiet moment, then
 * answer everything at once.
 */
export function scheduleVirtualCsrTurn(conversationId: string, delaySeconds: number) {
  const existing = timers.get(conversationId);
  if (existing) clearTimeout(existing);
  const wait = Math.min(Math.max(delaySeconds, 5), 120) * 1000;
  timers.set(conversationId, setTimeout(() => {
    timers.delete(conversationId);
    runVirtualCsrTurn(conversationId).catch((err) => console.error('[Virtual CSR] Turn crashed:', err));
  }, wait));
}

// ---------------------------------------------------------------- the turn

export async function runVirtualCsrTurn(conversationId: string): Promise<string | null> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { contact: true, tenant: true },
  });
  if (!conversation) return null;
  const { tenantId, contact, tenant } = conversation;

  const config = await prisma.aIAgentConfig.findUnique({ where: { tenantId } });
  if (!isVirtualCsrConfig(config)) return null;
  if (!conversation.aiAgentEnabled || contact.aiAgentEnabled === false) return null;

  const suppressed = await prisma.suppression.findUnique({
    where: { tenantId_phone: { tenantId, phone: normalizePhone(contact.phone) } },
  });
  if (suppressed) return null;

  const history = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_MESSAGES,
    select: { direction: true, body: true, createdAt: true, isAiGenerated: true },
  });
  history.reverse();
  const last = history[history.length - 1];
  if (!last || last.direction !== 'INBOUND') return null; // nothing new to answer

  // Only one live draft per conversation: a newer customer text replaces it.
  await prisma.csrAgentTurn.updateMany({
    where: { conversationId, status: 'DRAFT' },
    data: { status: 'SUPERSEDED' },
  });
  await prisma.csrAgentAction.updateMany({
    where: { conversationId, status: 'PROPOSED', turn: { status: 'SUPERSEDED' } },
    data: { status: 'REJECTED', error: 'Superseded by a newer customer message' },
  });

  const mode = (config!.agentMode as AgentMode) || 'shadow';
  const turn = await prisma.csrAgentTurn.create({
    data: { tenantId, conversationId, contactId: contact.id, mode, status: 'RUNNING', model: MODEL },
  });

  const ctx = await buildToolContext(conversationId, turn.id, mode);
  const [kbArticles, segmentTags] = await Promise.all([
    prisma.knowledgeBaseArticle.findMany({ where: { tenantId }, orderBy: { updatedAt: 'desc' }, select: { title: true, topic: true, content: true } }),
    prisma.contactTag.findMany({
      where: { contactId: contact.id, tag: { isSystem: true, name: { startsWith: 'ST ' } } },
      select: { tag: { select: { name: true } } },
    }),
  ]);

  const system = buildSystemPrompt({
    companyName: tenant.publicName || tenant.name,
    botName: config!.botName || 'Alex',
    timezone: ctx.timezone,
    now: new Date(),
    csrInstructions: config!.csrInstructions,
    jobTypes: ctx.jobTypes,
    kbArticles,
    contactFirstName: contact.firstName,
    contactSegments: segmentTags.map((t) => t.tag.name),
  });

  const messages: Anthropic.MessageParam[] = [{
    role: 'user',
    content: `Here is the text conversation so far. Respond to the customer's latest message(s).\n\n${transcript(history, ctx.timezone, tenant.publicName || tenant.name)}`,
  }];
  const tools = toolDefinitions(ctx.jobTypes);

  let inputTokens = 0;
  let outputTokens = 0;
  let seq = 0;
  let reply: string | null = null;
  let noReply = false;
  let handedOff = false;
  let handoffUrgency: string | null = null;
  let handoffReason = '';

  try {
    for (let step = 0; step < MAX_STEPS && reply === null && !noReply; step++) {
      const res = await client().messages.create({
        model: MODEL,
        max_tokens: 1500,
        system,
        tools,
        messages,
      });
      inputTokens += res.usage.input_tokens;
      outputTokens += res.usage.output_tokens;
      messages.push({ role: 'assistant', content: res.content });

      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (toolUses.length === 0) {
        // The model answered in plain text instead of calling send_reply.
        const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
        if (text) reply = text;
        else noReply = true;
        break;
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const { outcome, modelResult } = await runTool(use.name, use.input as any, ctx, ++seq);
        if (use.name === 'hand_off_to_human' && outcome.status === 'EXECUTED') {
          handedOff = true;
          handoffUrgency = String((use.input as any)?.urgency || 'normal');
          handoffReason = String((use.input as any)?.reason || '');
        }
        if (outcome.endsTurn?.kind === 'reply') reply = outcome.endsTurn.text;
        if (outcome.endsTurn?.kind === 'no_reply') noReply = true;
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: JSON.stringify(modelResult),
          is_error: outcome.status === 'FAILED' || outcome.status === 'BLOCKED',
        });
      }
      messages.push({ role: 'user', content: results });
    }

    if (handedOff) {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { needsAttention: true, aiAgentEnabled: false },
      });
      if (handoffUrgency === 'emergency' && ctx.emergencyAlertPhone) {
        await sendEmergencyAlert(tenantId, ctx.emergencyAlertPhone, conversationId, `${contact.firstName} ${contact.lastName}`.trim(), handoffReason);
      }
    }

    let status: string;
    if (reply === null) {
      status = handedOff ? 'HANDED_OFF' : 'NO_REPLY';
    } else if (mode === 'shadow') {
      status = 'DRAFT';
      await prisma.conversation.update({ where: { id: conversationId }, data: { needsAttention: true } });
    } else {
      await queueReply(tenantId, conversationId, contact.id, contact.phone, withFooter(reply), config!.responseDelaySeconds ?? 0);
      status = handedOff ? 'HANDED_OFF' : 'SENT';
    }

    await prisma.csrAgentTurn.update({
      where: { id: turn.id },
      data: { status, replyText: reply, finalText: status === 'SENT' || status === 'HANDED_OFF' ? reply : null, inputTokens, outputTokens },
    });
    return turn.id;
  } catch (err: any) {
    console.error(`[Virtual CSR] Turn ${turn.id} failed:`, err);
    await prisma.csrAgentTurn.update({
      where: { id: turn.id },
      data: { status: 'ERROR', error: String(err.message).slice(0, 2000), inputTokens, outputTokens },
    });
    // Never leave a customer hanging because the agent broke.
    await prisma.conversation.update({ where: { id: conversationId }, data: { needsAttention: true } });
    return turn.id;
  }
}

/** Same opt-out footer rule the legacy agent uses for its replies. */
function withFooter(text: string): string {
  const lower = text.toLowerCase();
  const hasOptOut = lower.includes('unsubscribe') || /\bstop\b/.test(lower);
  return hasOptOut ? text : `${text}\n\nReply STOP to unsubscribe.`;
}

// ---------------------------------------------------------------- review

/**
 * A CSR approves a shadow-mode draft: run each proposed ServiceTitan change in
 * order, and only if every one succeeds, send the (optionally edited) reply.
 */
export async function approveTurn(turnId: string, userId: string, editedText?: string, reviewNote?: string) {
  const turn = await prisma.csrAgentTurn.findUnique({
    where: { id: turnId },
    include: { actions: { orderBy: { seq: 'asc' } } },
  });
  if (!turn || turn.status !== 'DRAFT') throw new Error('This draft is no longer waiting for review');

  const ctx = await buildToolContext(turn.conversationId, turn.id);
  const failures: string[] = [];
  for (const a of turn.actions.filter((x) => x.status === 'PROPOSED')) {
    const r = await executeApprovedAction(a.id, ctx);
    if (!r.ok) {
      failures.push(`${a.tool}: ${r.error}`);
      break;
    }
  }

  if (failures.length > 0) {
    await prisma.csrAgentTurn.update({
      where: { id: turnId },
      data: { status: 'FAILED', error: failures.join('; '), decidedBy: userId, decidedAt: new Date(), reviewNote },
    });
    return { sent: false, error: failures.join('; ') };
  }

  const text = (editedText ?? turn.replyText ?? '').trim();
  if (text) {
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: turn.contactId } });
    await queueReply(turn.tenantId, turn.conversationId, turn.contactId, contact.phone, withFooter(text), 0);
  }
  await prisma.csrAgentTurn.update({
    where: { id: turnId },
    data: { status: 'SENT', finalText: text || null, decidedBy: userId, decidedAt: new Date(), reviewNote },
  });
  await prisma.conversation.update({ where: { id: turn.conversationId }, data: { needsAttention: false } });
  return { sent: !!text };
}

/** A CSR rejects a draft. Nothing is sent and no proposed change runs. */
export async function rejectTurn(turnId: string, userId: string, reviewNote?: string) {
  const turn = await prisma.csrAgentTurn.findUnique({ where: { id: turnId } });
  if (!turn || turn.status !== 'DRAFT') throw new Error('This draft is no longer waiting for review');
  await prisma.csrAgentAction.updateMany({ where: { turnId, status: 'PROPOSED' }, data: { status: 'REJECTED' } });
  await prisma.csrAgentTurn.update({
    where: { id: turnId },
    data: { status: 'REJECTED', decidedBy: userId, decidedAt: new Date(), reviewNote },
  });
}

/**
 * Supervised mode: approve a single proposed action (for example creating an
 * account) that the agent queued while the conversation carried on.
 */
export async function approveSingleAction(actionId: string) {
  const action = await prisma.csrAgentAction.findUniqueOrThrow({ where: { id: actionId } });
  const ctx = await buildToolContext(action.conversationId, action.turnId);
  return executeApprovedAction(actionId, ctx);
}
