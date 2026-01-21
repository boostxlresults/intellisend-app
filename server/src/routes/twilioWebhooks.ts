import { Router } from 'express';
import { prisma } from '../index';
import { validateTwilioSignature } from '../middleware/twilioSignature';
import { isStopKeyword, isOptInKeyword } from '../utils/smsKeywords';
import { logMessageEvent } from '../twilio/twilioClient';
import { sendReplyNotification } from '../services/emailNotifications';
import { handleInboundMessage } from '../services/aiAgent/conversationHandler';

const router = Router();

async function enqueueServiceTitanBookingJob(
  messageSid: string,
  conversationId: string,
  tenantId: string,
  contactId: string,
  toNumber: string,
  messageBody: string
): Promise<boolean> {
  try {
    await prisma.serviceTitanBookingJob.create({
      data: {
        messageSid,
        conversationId,
        tenantId,
        contactId,
        toNumber,
        messageBody,
        status: 'PENDING',
        nextRunAt: new Date(),
      },
    });
    console.log(`ServiceTitan booking job enqueued for MessageSid ${messageSid}`);
    return true;
  } catch (error: any) {
    if (error.code === 'P2002') {
      console.log(`ServiceTitan booking job already exists for MessageSid ${messageSid}`);
      return true;
    }
    console.error(`Failed to enqueue ServiceTitan booking job:`, error);
    throw error;
  }
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
    
    // Flag for opt-in processing (will apply tag after contact is found/created)
    const isOptIn = isOptInKeyword(Body);
    
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
    
    // Apply opt-in tag and consent if Y/YES reply detected
    if (isOptIn) {
      // Find or create "Opted In" tag for this tenant
      let optedInTag = await prisma.tag.findFirst({
        where: { tenantId, name: 'Opted In' },
      });
      
      if (!optedInTag) {
        optedInTag = await prisma.tag.create({
          data: {
            tenantId,
            name: 'Opted In',
            color: '#38a169', // Green color
          },
        });
      }
      
      // Add tag to contact (upsert to avoid duplicates)
      await prisma.contactTag.upsert({
        where: {
          contactId_tagId: {
            contactId: contact.id,
            tagId: optedInTag.id,
          },
        },
        create: {
          contactId: contact.id,
          tagId: optedInTag.id,
        },
        update: {},
      });
      
      // Update consent timestamp and source
      await prisma.contact.update({
        where: { id: contact.id },
        data: {
          consentSource: 'SMS_REPLY_Y',
          consentTimestamp: new Date(),
        },
      });
      
      // Remove from suppression list if they were suppressed
      await prisma.suppression.deleteMany({
        where: { tenantId, phone: From },
      });
      
      console.log(`Contact ${From} opted IN for tenant ${tenantId} - tagged as "Opted In"`);
    }
    
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { needsAttention: true },
    });
    
    const [tenantSettings, stConfig] = await Promise.all([
      prisma.tenantSettings.findUnique({
        where: { tenantId },
      }),
      prisma.serviceTitanConfig.findUnique({
        where: { tenantId },
      }),
    ]);
    
    if (tenantSettings?.notificationEmail) {
      const conversationMessages = await prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'asc' },
        select: {
          direction: true,
          body: true,
          createdAt: true,
          fromNumber: true,
        },
      });
      
      const frontendUrl = process.env.FRONTEND_URL || 'https://intellisend.net';
      const contactName = `${contact.firstName} ${contact.lastName}`.trim() || 'Unknown';
      
      sendReplyNotification({
        toEmail: tenantSettings.notificationEmail,
        tenantName: tenant.publicName,
        contactName,
        contactPhone: From,
        conversationId: conversation.id,
        conversationUrl: `${frontendUrl}/conversations/${conversation.id}`,
        messages: conversationMessages,
        serviceTitanEnabled: stConfig?.enabled || false,
      }).catch(err => console.error('[Email] Async notification error:', err));
    }
    
    const inboundMessageSid = MessageSid || '';
    
    // Create a ServiceTitan booking job for each inbound message (not just the first one)
    if (inboundMessageSid) {
      try {
        await enqueueServiceTitanBookingJob(
          inboundMessageSid,
          conversation.id,
          tenantId,
          contact.id,
          To,
          Body || ''
        );
      } catch (enqueueError) {
        console.error('Failed to enqueue ServiceTitan booking job, returning 500 for retry:', enqueueError);
        res.status(500).type('text/xml').send('<Response></Response>');
        return;
      }
    }
    
    console.log(`Inbound message saved for conversation ${conversation.id}`);
    
    // Process with AI agent if enabled (non-blocking)
    handleInboundMessage(
      conversation.id,
      tenantId,
      contact.id,
      Body || ''
    ).then(async (aiResponse) => {
      if (aiResponse && aiResponse.shouldRespond && aiResponse.responseText) {
        console.log(`[AI Agent] Response for conversation ${conversation.id}: ${aiResponse.newState}`);
        
        // Get the tenant's default from number
        const sendContext = await prisma.tenantSettings.findUnique({
          where: { tenantId },
          include: { defaultFromNumber: true },
        });
        
        const fromNumber = sendContext?.defaultFromNumber?.phoneNumber || To;
        
        // Add opt-out footer
        const messageWithFooter = `${aiResponse.responseText}\n\nReply STOP to unsubscribe.`;
        
        // Queue the AI response for sending
        await prisma.outboundMessageQueue.create({
          data: {
            tenantId,
            contactId: contact.id,
            phone: From,
            body: messageWithFooter,
            fromNumber,
            status: 'PENDING',
            processAfter: new Date(Date.now() + 30000), // 30 second delay to seem more human
          },
        });
        
        console.log(`[AI Agent] Queued response to ${From}`);
      }
    }).catch(err => {
      console.error('[AI Agent] Error processing inbound:', err);
    });
    
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
    
    if (MessageStatus === 'delivered') {
      await logMessageEvent(message.tenantId, message.toNumber, 'DELIVERED', {
        contactId: message.contactId,
        messageId: message.id,
        campaignId: message.campaignId || undefined,
      });
    } else if (MessageStatus === 'failed' || MessageStatus === 'undelivered') {
      await logMessageEvent(message.tenantId, message.toNumber, 'FAILED', {
        contactId: message.contactId,
        messageId: message.id,
        campaignId: message.campaignId || undefined,
        errorCode: ErrorCode,
        errorMessage: `Twilio status: ${MessageStatus}`,
      });
    }
    
    console.log(`Updated message ${message.id} status to ${MessageStatus}`);
    
    res.sendStatus(200);
  } catch (error: any) {
    console.error('Error processing status callback:', error);
    res.sendStatus(200);
  }
});

export default router;
