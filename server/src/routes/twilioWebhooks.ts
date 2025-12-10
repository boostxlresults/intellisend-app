import { Router } from 'express';
import { prisma } from '../index';
import { validateTwilioSignature } from '../middleware/twilioSignature';
import { sendSmsForTenant } from '../twilio/twilioClient';

const router = Router();

const STOP_KEYWORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];

function isStopKeyword(body: string | undefined): boolean {
  if (!body) return false;
  const normalized = body.trim().toUpperCase();
  return STOP_KEYWORDS.includes(normalized);
}

router.post('/inbound', validateTwilioSignature, async (req, res) => {
  try {
    const { From, To, Body, MessageSid } = req.body;
    
    console.log(`Inbound SMS received: From=${From}, To=${To}, Body=${Body?.substring(0, 50)}...`);
    
    const tenantNumber = await prisma.tenantNumber.findFirst({
      where: { phoneNumber: To },
      include: { tenant: true },
    });
    
    if (!tenantNumber) {
      console.warn(`No tenant found for number: ${To}`);
      res.type('text/xml').send('<Response></Response>');
      return;
    }
    
    const tenantId = tenantNumber.tenantId;
    const tenant = tenantNumber.tenant;
    
    if (isStopKeyword(Body)) {
      await prisma.suppression.upsert({
        where: {
          tenantId_phone: {
            tenantId,
            phone: From,
          },
        },
        create: {
          tenantId,
          phone: From,
          reason: 'STOP',
        },
        update: {
          reason: 'STOP',
        },
      });
      
      console.log(`Contact ${From} opted out for tenant ${tenantId} (keyword: ${Body?.trim().toUpperCase()})`);
      
      const confirmationMessage = `You're unsubscribed from ${tenant.publicName} SMS. No more messages will be sent. Reply HELP for help.`;
      
      const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${confirmationMessage}</Message>
</Response>`;
      
      res.type('text/xml').send(twimlResponse);
      return;
    }
    
    let contact = await prisma.contact.findFirst({
      where: { tenantId, phone: From },
    });
    
    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          tenantId,
          firstName: 'Unknown',
          lastName: 'Contact',
          phone: From,
          consentSource: 'text_in',
          consentTimestamp: new Date(),
        },
      });
      console.log(`Created new contact for ${From}`);
    }
    
    let conversation = await prisma.conversation.findFirst({
      where: {
        tenantId,
        contactId: contact.id,
        status: 'OPEN',
      },
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
      console.log(`Created new conversation for contact ${contact.id}`);
    }
    
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        tenantId,
        contactId: contact.id,
        direction: 'INBOUND',
        channel: 'SMS',
        body: Body || '',
        fromNumber: From,
        toNumber: To,
        twilioMessageSid: MessageSid,
        status: 'received',
      },
    });
    
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });
    
    await prisma.contact.update({
      where: { id: contact.id },
      data: { lastRepliedAt: new Date() },
    });
    
    console.log(`Inbound message saved for conversation ${conversation.id}`);
    
    res.type('text/xml').send('<Response></Response>');
  } catch (error: any) {
    console.error('Error processing inbound SMS:', error);
    res.type('text/xml').send('<Response></Response>');
  }
});

router.post('/status', validateTwilioSignature, async (req, res) => {
  try {
    const { MessageSid, MessageStatus, ErrorCode } = req.body;
    
    console.log(`Status update: SID=${MessageSid}, Status=${MessageStatus}, Error=${ErrorCode || 'none'}`);
    
    const message = await prisma.message.findFirst({
      where: { twilioMessageSid: MessageSid },
    });
    
    if (!message) {
      console.warn(`No message found for SID: ${MessageSid}`);
      res.sendStatus(200);
      return;
    }
    
    await prisma.message.update({
      where: { id: message.id },
      data: {
        status: MessageStatus,
        errorCode: ErrorCode || null,
      },
    });
    
    console.log(`Updated message ${message.id} status to ${MessageStatus}`);
    
    res.sendStatus(200);
  } catch (error: any) {
    console.error('Error processing status callback:', error);
    res.sendStatus(200);
  }
});

export default router;
