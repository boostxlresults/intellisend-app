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
}

export async function sendSmsForTenant(options: SendSmsOptions): Promise<{
  success: boolean;
  messageSid?: string;
  error?: string;
}> {
  try {
    const tenantNumber = await prisma.tenantNumber.findFirst({
      where: {
        tenantId: options.tenantId,
        phoneNumber: options.fromNumber,
      },
    });

    if (!tenantNumber) {
      return {
        success: false,
        error: `Phone number ${options.fromNumber} does not belong to tenant ${options.tenantId}`,
      };
    }

    const suppression = await prisma.suppression.findFirst({
      where: {
        tenantId: options.tenantId,
        phone: options.toNumber,
      },
    });

    if (suppression) {
      return {
        success: false,
        error: `Phone number ${options.toNumber} is suppressed: ${suppression.reason}`,
      };
    }

    const client = getClient();
    
    const messageOptions: any = {
      to: options.toNumber,
      body: options.body,
      from: options.fromNumber,
    };

    if (messagingServiceSid) {
      messageOptions.messagingServiceSid = messagingServiceSid;
    }

    if (options.statusCallbackUrl) {
      messageOptions.statusCallback = options.statusCallbackUrl;
    }

    const message = await client.messages.create(messageOptions);

    console.log(`SMS sent successfully. SID: ${message.sid}`);

    return {
      success: true,
      messageSid: message.sid,
    };
  } catch (error: any) {
    console.error('Failed to send SMS:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

export function isTwilioConfigured(): boolean {
  return !!(accountSid && authToken);
}
