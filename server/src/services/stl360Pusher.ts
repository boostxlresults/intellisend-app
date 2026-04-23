/**
 * stl360Pusher.ts
 *
 * Pushes a positive-sentiment lead from IntelliSend to SpeedToLead360
 * when the AI conversation handler detects a qualifying intent.
 *
 * Qualifying intents (all fire a push):
 *   BOOK_YES      — Customer ready to book
 *   INFO_REQUEST  — Customer asking about pricing, service, or availability
 *   CALL_ME       — Customer wants a call back
 *   INTERESTED    — Customer expressed general interest
 *   CONFIRM_YES   — Customer confirmed their identity/address
 *
 * The push is:
 *   - Fire-and-forget (non-blocking, never throws to the caller)
 *   - Idempotent (STL360 dedup service handles duplicate conversations)
 *   - Gated by stl360Enabled flag in TenantSettings
 */

import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface Stl360PushPayload {
  // Contact info
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;

  // Intent context
  intent: string;             // e.g. BOOK_YES, INFO_REQUEST, CALL_ME
  intentReasoning?: string;
  messageSnippet?: string;    // The customer's triggering message (truncated to 200 chars)
  serviceType?: string;

  // Routing metadata
  conversationId: string;
  campaignName?: string;
  intellisendContactId: string;
  intellisendTenantId: string;
}

/**
 * Push a positive-sentiment lead to SpeedToLead360.
 * This function is always safe to call — it catches all errors internally.
 */
export async function pushLeadToStl360(
  tenantId: string,
  payload: Stl360PushPayload,
): Promise<void> {
  try {
    // Load tenant STL360 config
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: {
        stl360Enabled: true,
        stl360ApiUrl: true,
        stl360TenantId: true,
      },
    });

    if (!settings?.stl360Enabled) {
      return; // Feature disabled for this tenant — silent no-op
    }

    if (!settings.stl360ApiUrl || !settings.stl360TenantId) {
      console.warn(`[STL360] Tenant ${tenantId} has stl360Enabled=true but missing stl360ApiUrl or stl360TenantId. Skipping push.`);
      return;
    }

    const endpoint = `${settings.stl360ApiUrl.replace(/\/$/, '')}/api/v1/webhooks/intellisend/${settings.stl360TenantId}`;

    // Build the conversation URL for the STL360 lead card
    const conversationUrl = `https://app.intellisend.net/conversations/${payload.conversationId}`;

    const body = {
      ...payload,
      conversationUrl,
    };

    await axios.post(endpoint, body, {
      timeout: 8000,
      headers: {
        'Content-Type': 'application/json',
        'X-Source': 'intellisend',
      },
    });

    console.log(`[STL360] Lead pushed successfully for tenant=${tenantId} intent=${payload.intent} conversationId=${payload.conversationId}`);
  } catch (error: any) {
    // Never block the conversation handler — log and continue
    console.error(`[STL360] Failed to push lead for tenant=${tenantId}:`, error?.message || error);
  }
}
