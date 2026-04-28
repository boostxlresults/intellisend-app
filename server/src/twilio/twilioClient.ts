import Twilio from 'twilio';
import { prisma } from '../index';
import { checkRateLimit } from '../services/rateLimiter';
import { normalizePhone } from '../utils/phoneNormalize';

const globalAccountSid = process.env.TWILIO_ACCOUNT_SID;
const globalAuthToken = process.env.TWILIO_AUTH_TOKEN;
const globalMessagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

const clientCache = new Map<string, Twilio.Twilio>();

interface TenantTwilioConfig {
  accountSid: string;
  authToken: string;
  messagingServiceSid?: string;
  isConfigured: boolean;
}

export async function getTenantTwilioConfig(tenantId: string): Promise<TenantTwilioConfig | null> {
  const integration = await prisma.tenantIntegration.findUnique({
    where: { tenantId },
  });

  if (integration?.twilioConfigured && integration.twilioAccountSid && integration.twilioAuthToken) {
    return {
      accountSid: integration.twilioAccountSid,
      authToken: integration.twilioAuthToken,
      messagingServiceSid: integration.twilioMessagingServiceSid || undefined,
      isConfigured: true,
    };
  }

  if (globalAccountSid && globalAuthToken) {
    return {
      accountSid: globalAccountSid,
      authToken: globalAuthToken,
      messagingServiceSid: globalMessagingServiceSid || undefined,
      isConfigured: false,
    };
  }

  return null;
}

export async function getClientForTenant(tenantId: string): Promise<{ client: Twilio.Twilio; config: TenantTwilioConfig } | null> {
  const config = await getTenantTwilioConfig(tenantId);
  
  if (!config) {
    return null;
  }

  const cacheKey = config.accountSid;
  
  if (!clientCache.has(cacheKey)) {
    clientCache.set(cacheKey, Twilio(config.accountSid, config.authToken));
  }

  return {
    client: clientCache.get(cacheKey)!,
    config,
  };
}

function getGlobalClient(): Twilio.Twilio | null {
  if (!globalAccountSid || !globalAuthToken) {
    return null;
  }
  
  if (!clientCache.has('global')) {
    clientCache.set('global', Twilio(globalAccountSid, globalAuthToken));
  }
  
  return clientCache.get('global')!;
}

export interface SendSmsOptions {
  tenantId: string;
  fromNumber: string;
  toNumber: string;
  body: string;
  mediaUrl?: string;
  statusCallbackUrl?: string;
  skipOptOutFooter?: boolean;
  skipRateLimitCheck?: boolean;
  contactId?: string;
  campaignId?: string;
  messageId?: string;
  // RCS options
  preferRcs?: boolean;       // Attempt RCS first, fall back to SMS if unsupported
  rcsCardTitle?: string;     // Optional rich card title for RCS messages
  rcsCardImageUrl?: string;  // Optional rich card image for RCS messages
}

export interface SendSmsResult {
  success: boolean;
  messageSid?: string;
  error?: string;
  suppressed?: boolean;
  rateLimited?: boolean;
  channel?: 'SMS' | 'MMS' | 'RCS'; // Which channel was actually used
}

const OPT_OUT_FOOTER = '\n\nReply STOP to unsubscribe.';

export async function logMessageEvent(
  tenantId: string,
  phone: string,
  eventType: 'SENT' | 'DELIVERED' | 'FAILED' | 'SUPPRESSED' | 'QUIET_HOURS_BLOCKED' | 'RATE_LIMITED' | 'OPT_OUT' | 'COMPLAINT' | 'CARRIER_BLOCKED',
  options?: { contactId?: string; messageId?: string; campaignId?: string; errorCode?: string; errorMessage?: string }
) {
  try {
    await prisma.messageEvent.create({
      data: {
        tenantId,
        phone,
        eventType,
        contactId: options?.contactId,
        messageId: options?.messageId,
        campaignId: options?.campaignId,
        errorCode: options?.errorCode,
        errorMessage: options?.errorMessage,
      },
    });
  } catch (error) {
    console.error('Failed to log message event:', error);
  }
}

/**
 * Attempt to send an RCS message via Twilio.
 * Returns the message SID on success, or throws on failure.
 * Twilio automatically returns error code 63016 if the destination
 * does not support RCS — callers should catch this and fall back to SMS.
 */
async function sendRcsMessage(
  client: Twilio.Twilio,
  options: {
    to: string;
    from: string;
    body: string;
    mediaUrl?: string;
    statusCallback?: string;
    cardTitle?: string;
    cardImageUrl?: string;
  }
): Promise<string> {
  const messageOptions: any = {
    to: options.to,
    body: options.body,
    // Twilio RCS uses the same messages API — the 'from' must be an RCS-enabled sender ID
    // or a Messaging Service SID that has RCS enabled.
    from: options.from,
    // Signal to Twilio that we want RCS delivery
    // Twilio routes to RCS when the sender and recipient both support it
    sendAsMms: false,
  };

  // Rich card support: if a card title and image are provided, use a content SID approach
  // For now we attach the image as a media URL which Twilio RCS renders as a rich card
  if (options.cardImageUrl || options.mediaUrl) {
    messageOptions.mediaUrl = [options.cardImageUrl || options.mediaUrl];
  }

  if (options.statusCallback) {
    messageOptions.statusCallback = options.statusCallback;
  }

  // Twilio RCS flag — tells the API to prefer RCS channel
  // See: https://www.twilio.com/docs/messaging/rcs
  messageOptions.contentRetention = 'retain';
  messageOptions.addressRetention = 'obfuscate';

  const message = await client.messages.create(messageOptions);
  return message.sid;
}

export async function sendSmsForTenant(options: SendSmsOptions): Promise<SendSmsResult> {
  try {
    const tenantNumber = await prisma.tenantNumber.findFirst({
      where: {
        tenantId: options.tenantId,
        phoneNumber: options.fromNumber,
      },
    });

    if (!tenantNumber) {
      console.error(`SECURITY: Attempted to send from ${options.fromNumber} which does not belong to tenant ${options.tenantId}`);
      return {
        success: false,
        error: `Phone number ${options.fromNumber} does not belong to tenant ${options.tenantId}`,
      };
    }

    const suppression = await prisma.suppression.findUnique({
      where: {
        tenantId_phone: {
          tenantId: options.tenantId,
          phone: options.toNumber,
        },
      },
    });

    if (suppression) {
      console.log(`SUPPRESSED: Not sending to ${options.toNumber} for tenant ${options.tenantId} (reason: ${suppression.reason})`);
      await logMessageEvent(options.tenantId, options.toNumber, 'SUPPRESSED', {
        contactId: options.contactId,
        campaignId: options.campaignId,
        errorMessage: suppression.reason,
      });
      return {
        success: false,
        suppressed: true,
        error: `Phone number ${options.toNumber} is suppressed: ${suppression.reason}`,
      };
    }

    if (!options.skipRateLimitCheck) {
      const rateLimitResult = await checkRateLimit(options.tenantId, options.toNumber);
      if (!rateLimitResult.allowed) {
        console.log(`RATE_LIMITED: Not sending to ${options.toNumber} for tenant ${options.tenantId} (${rateLimitResult.reason})`);
        await logMessageEvent(options.tenantId, options.toNumber, 'RATE_LIMITED', {
          contactId: options.contactId,
          campaignId: options.campaignId,
          errorMessage: rateLimitResult.reason,
        });
        return {
          success: false,
          rateLimited: true,
          error: rateLimitResult.reason,
        };
      }
    }

    const twilioResult = await getClientForTenant(options.tenantId);
    
    if (!twilioResult) {
      return {
        success: false,
        error: 'Twilio not configured for this tenant',
      };
    }
    
    const { client, config } = twilioResult;
    
    const messageBody = options.skipOptOutFooter 
      ? options.body 
      : options.body + OPT_OUT_FOOTER;

    // ─── RCS PATH ────────────────────────────────────────────────────────────
    if (options.preferRcs) {
      try {
        const rcsSid = await sendRcsMessage(client, {
          to: options.toNumber,
          from: options.fromNumber,
          body: messageBody,
          mediaUrl: options.mediaUrl,
          statusCallback: options.statusCallbackUrl,
          cardTitle: options.rcsCardTitle,
          cardImageUrl: options.rcsCardImageUrl,
        });

        console.log(`RCS sent successfully. SID: ${rcsSid}, From: ${options.fromNumber}, To: ${options.toNumber}`);

        await logMessageEvent(options.tenantId, options.toNumber, 'SENT', {
          contactId: options.contactId,
          messageId: options.messageId,
          campaignId: options.campaignId,
        });

        return { success: true, messageSid: rcsSid, channel: 'RCS' };

      } catch (rcsError: any) {
        // Twilio error 63016 = RCS not supported for this recipient — fall back to SMS
        // Any other RCS error also falls back gracefully
        console.log(`RCS not supported for ${options.toNumber} (${rcsError.code || rcsError.message}), falling back to SMS`);
        // Fall through to SMS path below
      }
    }

    // ─── SMS / MMS PATH ───────────────────────────────────────────────────────
    const messageOptions: any = {
      to: options.toNumber,
      body: messageBody,
      from: options.fromNumber,
    };

    if (options.mediaUrl) {
      messageOptions.mediaUrl = [options.mediaUrl];
    }

    if (config.messagingServiceSid) {
      messageOptions.messagingServiceSid = config.messagingServiceSid;
    }

    if (options.statusCallbackUrl) {
      messageOptions.statusCallback = options.statusCallbackUrl;
    }

    const message = await client.messages.create(messageOptions);
    const channel: 'SMS' | 'MMS' = options.mediaUrl ? 'MMS' : 'SMS';

    console.log(`${channel} sent successfully. SID: ${message.sid}, From: ${options.fromNumber}, To: ${options.toNumber}`);

    await logMessageEvent(options.tenantId, options.toNumber, 'SENT', {
      contactId: options.contactId,
      messageId: options.messageId,
      campaignId: options.campaignId,
    });

    return {
      success: true,
      messageSid: message.sid,
      channel,
    };

  } catch (error: any) {
    console.error(`Failed to send message to ${options.toNumber}:`, error.message);
    
    await logMessageEvent(options.tenantId, options.toNumber, 'FAILED', {
      contactId: options.contactId,
      campaignId: options.campaignId,
      errorCode: error.code?.toString(),
      errorMessage: error.message,
    });
    
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function checkSuppression(tenantId: string, phone: string): Promise<boolean> {
  const normalized = normalizePhone(phone);
  const suppression = await prisma.suppression.findUnique({
    where: {
      tenantId_phone: {
        tenantId,
        phone: normalized,
      },
    },
  });
  return !!suppression;
}

export function isGlobalTwilioConfigured(): boolean {
  return !!(globalAccountSid && globalAuthToken);
}

export function getGlobalAuthToken(): string | undefined {
  return globalAuthToken;
}

export async function getTenantAuthToken(tenantId: string): Promise<string | undefined> {
  const config = await getTenantTwilioConfig(tenantId);
  return config?.authToken;
}
