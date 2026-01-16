import { Request, Response, NextFunction } from 'express';
import Twilio from 'twilio';
import { prisma } from '../index';
import { getGlobalAuthToken } from '../twilio/twilioClient';

export async function validateTwilioSignature(req: Request, res: Response, next: NextFunction) {
  const twilioSignature = req.headers['x-twilio-signature'] as string;
  
  if (!twilioSignature) {
    console.warn('Missing X-Twilio-Signature header');
    return res.status(403).json({ error: 'Forbidden: Missing Twilio signature' });
  }

  // Use REPLIT_DEV_DOMAIN for the public URL, fallback to forwarded headers
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const replitDomain = process.env.REPLIT_DEV_DOMAIN;
  const host = replitDomain || req.headers['x-forwarded-host'] || req.headers['host'];
  const url = `${protocol}://${host}${req.originalUrl}`;
  
  console.log(`Twilio signature validation URL: ${url}`);

  const toNumber = req.body?.To;
  let authToken: string | undefined;

  if (toNumber) {
    const tenantNumber = await prisma.tenantNumber.findFirst({
      where: { phoneNumber: toNumber },
      include: { tenant: { include: { integration: true } } },
    });

    if (tenantNumber?.tenant?.integration?.twilioAuthToken) {
      authToken = tenantNumber.tenant.integration.twilioAuthToken;
    }
  }

  if (!authToken) {
    authToken = getGlobalAuthToken();
  }

  if (!authToken) {
    console.warn('No Twilio auth token available - skipping signature validation (dev mode)');
    return next();
  }

  const isValid = Twilio.validateRequest(
    authToken,
    twilioSignature,
    url,
    req.body
  );

  if (!isValid) {
    console.warn(`Invalid Twilio signature for ${url}`);
    return res.status(403).json({ error: 'Forbidden: Invalid Twilio signature' });
  }

  next();
}
