import { Router } from 'express';
import OpenAI from 'openai';
import { prisma } from '../index';
import { normalizePhone } from '../utils/phoneNormalize';
import { checkSuppression } from '../twilio/twilioClient';

/**
 * speedToLead.ts
 *
 * Outbound-FIRST entry point for the AI SMS agent.
 *
 * SpeedToLead360 fires one POST per brand-new inbound lead:
 *   POST /api/webhooks/speed-to-lead/first-touch
 *   Header: X-STL360-Key: <shared secret>   (case-insensitive: x-stl360-key)
 *   Body:   { tenantId, stl360LeadId, lead: { firstName, lastName, phone,
 *             email, source, serviceType, description, city, state, zip } }
 *
 * We upsert the Contact, open/reuse a Conversation, create an AIAgentSession
 * seeded in state OFFER_SENT (the previously-defined-but-unused outbound-first
 * state), generate a warm lead-source-aware first-touch SMS, and enqueue it on
 * the SAME OutboundMessageQueue the rest of the app uses. A later inbound reply
 * flows into the existing handleInboundMessage() agent unchanged (it reuses the
 * OFFER_SENT session and runs the intent switch).
 *
 * Contract: this endpoint NEVER returns 5xx to STL360. Any internal failure is
 * caught and returned as 200 { success:false, error }. Only auth/validation
 * problems return non-200 (401/400/404/503).
 */

const router = Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface FirstTouchLead {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  source?: string;
  serviceType?: string;
  description?: string;
  city?: string;
  state?: string;
  zip?: string;
}

/**
 * Resolve the tenant's default outbound from-number.
 * Prefers TenantSettings.defaultFromNumber, then an explicit isDefault number,
 * then any number the tenant owns.
 */
async function resolveFromNumber(tenantId: string): Promise<string | null> {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    include: { defaultFromNumber: true },
  });
  if (settings?.defaultFromNumber?.phoneNumber) {
    return settings.defaultFromNumber.phoneNumber;
  }

  const defaultNumber = await prisma.tenantNumber.findFirst({
    where: { tenantId, isDefault: true },
  });
  if (defaultNumber?.phoneNumber) {
    return defaultNumber.phoneNumber;
  }

  const anyNumber = await prisma.tenantNumber.findFirst({
    where: { tenantId },
  });
  return anyNumber?.phoneNumber || null;
}

/**
 * Build the first-touch opener. Prefers an OpenAI-generated, lead-source-aware
 * message; falls back to a clean template when no API key is configured or the
 * call fails. Never invents prices. Always returns something sendable.
 */
async function generateFirstTouchMessage(params: {
  firstName: string;
  botName: string;
  companyName: string;
  serviceType?: string;
  source?: string;
  description?: string;
}): Promise<string> {
  const { firstName, botName, companyName, serviceType, source, description } = params;

  const serviceLabel = serviceType && serviceType.trim() ? serviceType.trim() : 'service';
  const placeholderNames = ['there', 'lead', 'unknown', 'customer', 'contact'];
  const greetName =
    firstName && firstName.trim() && !placeholderNames.includes(firstName.trim().toLowerCase())
      ? firstName.trim()
      : 'there';

  // Clean template fallback (also used when OpenAI is unavailable / errors).
  const template =
    `Hi ${greetName}, this is ${botName} with ${companyName}. ` +
    `Thanks for reaching out about ${serviceLabel === 'service' ? 'your service request' : serviceLabel}! ` +
    `I'd love to help get you taken care of — what day works best for you?`;

  if (!process.env.OPENAI_API_KEY) {
    return template.substring(0, 300);
  }

  try {
    const contextLine = [
      source ? `They came in via ${source}.` : '',
      description ? `Their note: "${description.substring(0, 160)}".` : '',
    ]
      .filter(Boolean)
      .join(' ');

    const prompt =
      `Write a warm, friendly first-touch SMS to ${greetName}, who just requested ` +
      `${serviceLabel} from ${companyName}. Introduce yourself as ${botName} from ${companyName}. ` +
      `${contextLine} ` +
      `Keep it under 160 characters, sound human (not scripted), never mention being an AI, ` +
      `do NOT invent or quote any prices, and end with a simple question to start the conversation. ` +
      `Do NOT include "Reply STOP" — that is added automatically. Write ONLY the SMS text.`;

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 100,
    });

    const text = response.choices[0]?.message?.content?.trim();
    return (text && text.length > 0 ? text : template).substring(0, 300);
  } catch (error) {
    console.error('[STL360 FirstTouch] OpenAI generation failed, using template:', error);
    return template.substring(0, 300);
  }
}

router.post('/speed-to-lead/first-touch', async (req, res) => {
  // ----- 1. AUTH -----
  const providedKey = req.header('x-stl360-key');
  const expectedKey = process.env.STL360_WEBHOOK_KEY;

  if (!expectedKey) {
    // Fail safe: without a configured secret we cannot authenticate the caller.
    console.warn('[STL360 FirstTouch] STL360_WEBHOOK_KEY is not set — rejecting request (503).');
    return res.status(503).json({ success: false, error: 'webhook_not_configured' });
  }

  if (!providedKey || providedKey !== expectedKey) {
    console.warn('[STL360 FirstTouch] Rejected request: missing/invalid X-STL360-Key.');
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  // ----- 2. VALIDATE -----
  const { tenantId, stl360LeadId } = req.body || {};
  const lead: FirstTouchLead = (req.body && req.body.lead) || {};

  if (!tenantId || typeof tenantId !== 'string') {
    return res.status(400).json({ success: false, error: 'missing_tenantId' });
  }
  if (!lead.phone || typeof lead.phone !== 'string') {
    return res.status(400).json({ success: false, error: 'missing_lead_phone' });
  }

  const phone = normalizePhone(lead.phone);
  if (!phone) {
    return res.status(400).json({ success: false, error: 'invalid_lead_phone' });
  }

  // Everything past auth/validation is best-effort and must never 5xx to STL360.
  try {
    // ----- 3. RESOLVE TENANT -----
    // Resolve the Intellisend tenant flexibly so the integration never depends
    // on hardcoding an opaque Intellisend UUID:
    //   1) body.tenantId matches an Intellisend Tenant.id directly, OR
    //   2) a tenant whose TenantSettings.stl360TenantId == body.tenantId
    //      (i.e. STL360 sends its OWN tenant id), OR
    //   3) if this Intellisend instance has exactly one tenant, use it.
    let tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      const mapped = await prisma.tenantSettings.findFirst({
        where: { stl360TenantId: tenantId },
        select: { tenantId: true },
      });
      if (mapped) {
        tenant = await prisma.tenant.findUnique({ where: { id: mapped.tenantId } });
      }
    }
    if (!tenant) {
      const all = await prisma.tenant.findMany({ take: 2, select: { id: true } });
      if (all.length === 1) {
        tenant = await prisma.tenant.findUnique({ where: { id: all[0].id } });
      }
    }
    if (!tenant) {
      return res.status(404).json({ success: false, error: 'tenant_not_found' });
    }

    // ----- 4. COMPLIANCE (suppression / opt-out) -----
    const suppressed = await checkSuppression(tenantId, phone);
    if (suppressed) {
      console.log(`[STL360 FirstTouch] Skipping suppressed contact ${phone} for tenant ${tenantId}`);
      return res.status(200).json({ success: false, skipped: 'suppressed' });
    }

    // ----- 5. UPSERT CONTACT (fill empty fields only) -----
    let contact = await prisma.contact.findFirst({
      where: { tenantId, phone },
    });

    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          tenantId,
          firstName: (lead.firstName || '').trim() || 'Lead',
          lastName: (lead.lastName || '').trim() || '',
          phone,
          email: lead.email?.trim() || null,
          city: lead.city?.trim() || null,
          state: lead.state?.trim() || null,
          zip: lead.zip?.trim() || null,
          leadSource: lead.source?.trim() || 'speedtolead360',
          consentSource: 'lead_form',
          consentTimestamp: new Date(),
          lastContactedAt: new Date(),
        },
      });
      console.log(`[STL360 FirstTouch] Created contact ${contact.id} for ${phone}`);
    } else {
      // Fill only empty fields — never overwrite existing data.
      const fill: Record<string, any> = {};
      if ((!contact.firstName || contact.firstName === 'Lead' || contact.firstName === 'Unknown') && lead.firstName?.trim()) {
        fill.firstName = lead.firstName.trim();
      }
      if ((!contact.lastName || contact.lastName === 'Contact') && lead.lastName?.trim()) {
        fill.lastName = lead.lastName.trim();
      }
      if (!contact.email && lead.email?.trim()) fill.email = lead.email.trim();
      if (!contact.city && lead.city?.trim()) fill.city = lead.city.trim();
      if (!contact.state && lead.state?.trim()) fill.state = lead.state.trim();
      if (!contact.zip && lead.zip?.trim()) fill.zip = lead.zip.trim();
      if (!contact.leadSource && lead.source?.trim()) fill.leadSource = lead.source.trim();
      fill.lastContactedAt = new Date();

      contact = await prisma.contact.update({
        where: { id: contact.id },
        data: fill,
      });
    }

    // Record a ConsentRecord for the lead-form consent (TCPA audit trail).
    // ConsentRecord.consentSource is an enum — WEB_FORM is the closest match for a lead form.
    await prisma.consentRecord
      .create({
        data: {
          tenantId,
          contactId: contact.id,
          phone,
          consentSource: 'WEB_FORM',
          sourceDetails: `SpeedToLead360 first-touch (source: ${lead.source || 'unknown'}, stl360LeadId: ${stl360LeadId || 'n/a'})`,
          consentText: 'Lead submitted contact info via lead form; consent captured by SpeedToLead360.',
          consentGiven: true,
          givenAt: new Date(),
        },
      })
      .catch((err) => console.error('[STL360 FirstTouch] ConsentRecord create failed (non-blocking):', err));

    // ----- 6. CONVERSATION (reuse OPEN or create) -----
    let conversation = await prisma.conversation.findFirst({
      where: { tenantId, contactId: contact.id, status: 'OPEN' },
    });
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          tenantId,
          contactId: contact.id,
          status: 'OPEN',
          lastMessageAt: new Date(),
        },
      });
    }

    // ----- 7. AI SESSION seeded in OFFER_SENT (outbound-first) -----
    const existingSession = await prisma.aIAgentSession.findUnique({
      where: { conversationId: conversation.id },
    });

    const sessionSeed = {
      state: 'OFFER_SENT' as const,
      outcome: 'PENDING' as const,
      serviceType: lead.serviceType?.trim() || null,          // requested service
      specialInstructions: lead.description?.trim() || null,   // lead's note/description
      leadSource: lead.source?.trim() || null,                 // channel/source
      stl360LeadId: stl360LeadId || null,                      // for routing replies back to the STL360 card
      confirmedName: `${contact.firstName} ${contact.lastName}`.trim() || null,
      confirmedEmail: contact.email || null,
    };

    if (existingSession) {
      await prisma.aIAgentSession.update({
        where: { id: existingSession.id },
        data: sessionSeed,
      });
    } else {
      await prisma.aIAgentSession.create({
        data: {
          conversationId: conversation.id,
          tenantId,
          contactId: contact.id,
          ...sessionSeed,
        },
      });
    }

    // Audit note (human-visible) so the STL360 lead id is retrievable even without the session.
    await prisma.contactNote
      .create({
        data: {
          tenantId,
          contactId: contact.id,
          content: `[STL360 first-touch] stl360LeadId=${stl360LeadId || 'n/a'} source=${lead.source || 'n/a'} service=${lead.serviceType || 'n/a'}`,
          createdBy: 'speedtolead360',
        },
      })
      .catch((err) => console.error('[STL360 FirstTouch] ContactNote create failed (non-blocking):', err));

    // ----- 8. GENERATE first-touch message -----
    const agentConfig = await prisma.aIAgentConfig.findUnique({ where: { tenantId } });
    const botName = agentConfig?.botName?.trim() || 'our team';
    const companyName = tenant.publicName || tenant.name;

    if (!agentConfig?.enabled || !agentConfig?.autoRespond) {
      // First touch still sends (STL360 explicitly requested it), but two-way AI
      // replies will NOT auto-respond until the agent is enabled for this tenant.
      console.warn(
        `[STL360 FirstTouch] AI agent not fully enabled for tenant ${tenantId} ` +
          `(enabled=${agentConfig?.enabled}, autoRespond=${agentConfig?.autoRespond}). ` +
          `First-touch will send but inbound replies won't auto-respond.`
      );
    }

    const messageText = await generateFirstTouchMessage({
      firstName: contact.firstName,
      botName,
      companyName,
      serviceType: lead.serviceType,
      source: lead.source,
      description: lead.description,
    });

    // ----- 9. SEND via the shared OutboundMessageQueue (same path as twilioWebhooks) -----
    const fromNumber = await resolveFromNumber(tenantId);
    if (!fromNumber) {
      console.error(`[STL360 FirstTouch] No from-number configured for tenant ${tenantId}`);
      return res.status(200).json({
        success: false,
        error: 'no_from_number',
        conversationId: conversation.id,
        contactId: contact.id,
      });
    }

    // Append opt-out footer the same way twilioWebhooks does (idempotent check).
    const lowerText = messageText.toLowerCase();
    const hasOptOut =
      lowerText.includes('stop to unsubscribe') ||
      lowerText.includes('reply stop') ||
      lowerText.includes('text stop') ||
      lowerText.includes('unsubscribe') ||
      /\bstop\b/.test(lowerText);
    const messageWithFooter = hasOptOut ? messageText : `${messageText}\n\nReply STOP to unsubscribe.`;

    await prisma.outboundMessageQueue.create({
      data: {
        tenantId,
        contactId: contact.id,
        conversationId: conversation.id,
        phone,
        body: messageWithFooter,
        fromNumber,
        status: 'PENDING',
        processAfter: new Date(), // immediate send
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    await prisma.contact.update({
      where: { id: contact.id },
      data: { lastContactedAt: new Date() },
    });

    console.log(
      `[STL360 FirstTouch] Queued first-touch to ${phone} (tenant ${tenantId}, conversation ${conversation.id}, from ${fromNumber})`
    );

    // ----- 10. RESPOND -----
    return res.status(200).json({
      success: true,
      conversationId: conversation.id,
      contactId: contact.id,
    });
  } catch (error: any) {
    // Never 5xx — STL360 treats non-200 as failure, but a crash should not surface as 500.
    console.error('[STL360 FirstTouch] Unexpected error (returning 200 success:false):', {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
      tenantId,
    });
    return res.status(200).json({ success: false, error: error?.message || 'internal_error' });
  }
});

export default router;
