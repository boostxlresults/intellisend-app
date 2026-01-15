import Twilio from 'twilio';
import { prisma } from '../index';
import { checkRateLimit } from '../services/rateLimiter';

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
  statusCallbackUrl?: string;
  skipOptOutFooter?: boolean;
  skipRateLimitCheck?: boolean;
  contactId?: string;
  campaignId?: string;
  messageId?: string;
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

export interface SendSmsResult {
  success: boolean;
  messageSid?: string;
  error?: string;
  suppressed?: boolean;
  rateLimited?: boolean;
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
    
    const messageOptions: any = {
      to: options.toNumber,
      body: messageBody,
      from: options.fromNumber,
    };

    if (config.messagingServiceSid) {
      messageOptions.messagingServiceSid = config.messagingServiceSid;
    }

    if (options.statusCallbackUrl) {
      messageOptions.statusCallback = options.statusCallbackUrl;
    }

    const message = await client.messages.create(messageOptions);

    console.log(`SMS sent successfully. SID: ${message.sid}, From: ${options.fromNumber}, To: ${options.toNumber}`);

    await logMessageEvent(options.tenantId, options.toNumber, 'SENT', {
      contactId: options.contactId,
      messageId: options.messageId,
      campaignId: options.campaignId,
    });

    return {
      success: true,
      messageSid: message.sid,
    };
  } catch (error: any) {
    console.error(`Failed to send SMS to ${options.toNumber}:`, error.message);
    
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
  const suppression = await prisma.suppression.findUnique({
    where: {
      tenantId_phone: {
        tenantId,
        phone,
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
