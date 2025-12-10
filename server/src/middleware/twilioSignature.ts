import { Request, Response, NextFunction } from 'express';
import Twilio from 'twilio';

const authToken = process.env.TWILIO_AUTH_TOKEN;

export function validateTwilioSignature(req: Request, res: Response, next: NextFunction) {
  if (!authToken) {
    console.warn('TWILIO_AUTH_TOKEN not configured - skipping signature validation (dev mode)');
    return next();
  }

  const twilioSignature = req.headers['x-twilio-signature'] as string;
  
  if (!twilioSignature) {
    console.warn('Missing X-Twilio-Signature header');
    return res.status(403).json({ error: 'Forbidden: Missing Twilio signature' });
  }

  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['host'];
  const url = `${protocol}://${host}${req.originalUrl}`;

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
