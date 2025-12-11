import { Router } from 'express';
import Twilio from 'twilio';

const router = Router();

router.get('/twilio', async (req, res) => {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

    const missingEnv: string[] = [];
    
    if (!accountSid) missingEnv.push('TWILIO_ACCOUNT_SID');
    if (!authToken) missingEnv.push('TWILIO_AUTH_TOKEN');
    if (!messagingServiceSid) missingEnv.push('TWILIO_MESSAGING_SERVICE_SID');

    if (missingEnv.length > 0) {
      return res.json({
        connected: false,
        missingEnv,
      });
    }

    const client = Twilio(accountSid, authToken);
    
    const account = await client.api.v2010.accounts(accountSid!).fetch();

    res.json({
      connected: true,
      accountName: account.friendlyName,
      accountStatus: account.status,
    });
  } catch (error: any) {
    console.error('Twilio health check failed:', error.message);
    res.json({
      connected: false,
      error: error.message,
    });
  }
});

export default router;
