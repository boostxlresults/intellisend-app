import Twilio from 'twilio';
import { prisma } from '../index';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

let twilioClient: Twilio.Twilio | null = null;

function getClient(): Twilio.Twilio {
  if (!twilioClient) {
    if (!accountSid || !authToken) {
      throw new Error('Twilio credentials not configured');
    }
    twilioClient = Twilio(accountSid, authToken);
  }
  return twilioClient;
}

export interface SendSmsOptions {
  tenantId: string;
  fromNumber: string;
  toNumber: string;
  body: string;
  statusCallbackUrl?: string;
  skipOptOutFooter?: boolean;
}

const OPT_OUT_FOOTER = '\n\nReply STOP to unsubscribe.';

export interface SendSmsResult {
  success: boolean;
  messageSid?: string;
  error?: string;
  suppressed?: boolean;
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
      return {
        success: false,
        suppressed: true,
        error: `Phone number ${options.toNumber} is suppressed: ${suppression.reason}`,
      };
    }

    const client = getClient();
    
    const messageBody = options.skipOptOutFooter 
      ? options.body 
      : options.body + OPT_OUT_FOOTER;
    
    const messageOptions: any = {
      to: options.toNumber,
      body: messageBody,
      from: options.fromNumber,
    };

    if (messagingServiceSid) {
      messageOptions.messagingServiceSid = messagingServiceSid;
    }

    if (options.statusCallbackUrl) {
      messageOptions.statusCallback = options.statusCallbackUrl;
    }

    const message = await client.messages.create(messageOptions);

    console.log(`SMS sent successfully. SID: ${message.sid}, From: ${options.fromNumber}, To: ${options.toNumber}`);

    return {
      success: true,
      messageSid: message.sid,
    };
  } catch (error: any) {
    console.error(`Failed to send SMS to ${options.toNumber}:`, error.message);
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

export function isTwilioConfigured(): boolean {
  return !!(accountSid && authToken);
}

export function getAuthToken(): string | undefined {
  return authToken;
}
