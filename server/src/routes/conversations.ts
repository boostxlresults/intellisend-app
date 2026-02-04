import { Router } from 'express';
import { prisma } from '../index';
import { sendSmsForTenant } from '../twilio/twilioClient';
import { suggestRepliesForInboundMessage } from '../ai/aiEngine';
import { getTenantSendContext, isWithinQuietHours } from '../services/tenantSettings';

const router = Router();

router.get('/:tenantId/conversations', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { status, search } = req.query;
    
    const where: any = { tenantId };
    
    if (status) {
      where.status = status;
    }
    
    if (search) {
      where.contact = {
        OR: [
          { phone: { contains: search as string } },
          { firstName: { contains: search as string, mode: 'insensitive' } },
          { lastName: { contains: search as string, mode: 'insensitive' } },
        ],
      };
    }
    
    const conversations = await prisma.conversation.findMany({
      where,
      include: {
        contact: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: [
        { needsAttention: 'desc' },
        { lastMessageAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });
    
    res.json(conversations);
  } catch (error: any) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/conversations', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { contactId } = req.body;
    
    if (!contactId) {
      return res.status(400).json({ error: 'contactId is required' });
    }
    
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, tenantId },
    });
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    let conversation = await prisma.conversation.findFirst({
      where: { tenantId, contactId, status: 'OPEN' },
    });
    
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          tenantId,
          contactId,
          status: 'OPEN',
          lastMessageAt: new Date(),
        },
      });
    }
    
    const fullConversation = await prisma.conversation.findUnique({
      where: { id: conversation.id },
      include: {
        contact: true,
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    
    res.status(201).json(fullConversation);
  } catch (error: any) {
    console.error('Error creating conversation:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:tenantId/conversations/:conversationId', async (req, res) => {
  try {
    const { tenantId, conversationId } = req.params;
    
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: {
        contact: {
          include: { tags: true },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    if (conversation.needsAttention) {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { needsAttention: false },
      });
      conversation.needsAttention = false;
    }
    
    res.json(conversation);
  } catch (error: any) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/conversations/:conversationId/messages', async (req, res) => {
  try {
    const { tenantId, conversationId } = req.params;
    const { body, fromNumber, imageUrl, mediaUrl } = req.body;
    const mediaUrlToUse = imageUrl || mediaUrl;
    
    if (!body) {
      return res.status(400).json({ error: 'body is required' });
    }
    
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { contact: true },
    });
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    const suppression = await prisma.suppression.findUnique({
      where: {
        tenantId_phone: {
          tenantId,
          phone: conversation.contact.phone,
        },
      },
    });
    
    if (suppression) {
      console.log(`BLOCKED: Attempted to send to suppressed contact ${conversation.contact.phone} (reason: ${suppression.reason})`);
      return res.status(403).json({
        error: `Cannot send to this contact - they have opted out (${suppression.reason})`,
        suppressed: true,
      });
    }
    
    const sendContext = await getTenantSendContext(tenantId);
    
    if (!sendContext) {
      return res.status(400).json({ error: 'No phone number configured for tenant' });
    }
    
    if (isWithinQuietHours(new Date(), sendContext.timezone, sendContext.quietHoursStart, sendContext.quietHoursEnd)) {
      return res.status(400).json({
        error: 'Cannot send SMS during quiet hours for this tenant.',
        quietHours: true,
      });
    }
    
    const senderNumber = fromNumber || sendContext.fromNumber;
    
    const smsResult = await sendSmsForTenant({
      tenantId,
      fromNumber: senderNumber,
      toNumber: conversation.contact.phone,
      body,
      mediaUrl: mediaUrlToUse || undefined,
      skipRateLimitCheck: true,
    });
    
    const message = await prisma.message.create({
      data: {
        conversationId,
        tenantId,
        contactId: conversation.contactId,
        direction: 'OUTBOUND',
        channel: 'SMS',
        body,
        mediaUrl: mediaUrlToUse || undefined,
        fromNumber: senderNumber,
        toNumber: conversation.contact.phone,
        twilioMessageSid: smsResult.messageSid,
        status: smsResult.success ? 'sent' : 'failed',
        errorCode: smsResult.error,
      },
    });
    
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { 
        lastMessageAt: new Date(),
        needsAttention: false,
      },
    });
    
    await prisma.contact.update({
      where: { id: conversation.contactId },
      data: { lastContactedAt: new Date() },
    });
    
    if (!smsResult.success) {
      console.error(`SMS send failed to ${conversation.contact.phone}: ${smsResult.error}`);
      return res.status(422).json({
        error: smsResult.error || 'Failed to send SMS',
        message,
        smsResult,
        smsFailed: true,
      });
    }
    
    res.status(201).json({
      message,
      smsResult,
    });
  } catch (error: any) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/conversations/:conversationId/suggest', async (req, res) => {
  try {
    const { tenantId, conversationId } = req.params;
    const { personaId } = req.body;
    
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: {
        messages: {
          where: { direction: 'INBOUND' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    const lastMessage = conversation.messages[0];
    if (!lastMessage) {
      return res.json({ suggestions: [] });
    }
    
    const suggestions = await suggestRepliesForInboundMessage({
      tenantId,
      personaId,
      contactId: conversation.contactId,
      conversationId,
      lastUserMessage: lastMessage.body,
    });
    
    res.json({ suggestions });
  } catch (error: any) {
    console.error('Error suggesting replies:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/conversations/:conversationId/ai-suggestions', async (req, res) => {
  try {
    const { tenantId, conversationId } = req.params;
    const { contactId, personaId, lastUserMessage } = req.body;
    
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    let messageToUse = lastUserMessage;
    if (!messageToUse) {
      const lastInbound = await prisma.message.findFirst({
        where: { conversationId, direction: 'INBOUND' },
        orderBy: { createdAt: 'desc' },
      });
      messageToUse = lastInbound?.body || '';
    }
    
    if (!messageToUse) {
      return res.json({ suggestions: [] });
    }
    
    const suggestions = await suggestRepliesForInboundMessage({
      tenantId,
      personaId,
      contactId: contactId || conversation.contactId,
      conversationId,
      lastUserMessage: messageToUse,
    });
    
    res.json({ suggestions });
  } catch (error: any) {
    console.error('Error getting AI suggestions:', error);
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:tenantId/conversations/:conversationId', async (req, res) => {
  try {
    const { tenantId, conversationId } = req.params;
    const { status, aiAgentEnabled } = req.body;
    
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    const updateData: any = {};
    if (status !== undefined) updateData.status = status;
    if (aiAgentEnabled !== undefined) updateData.aiAgentEnabled = aiAgentEnabled;
    
    const updated = await prisma.conversation.update({
      where: { id: conversationId },
      data: updateData,
      include: { contact: true },
    });
    
    res.json(updated);
  } catch (error: any) {
    console.error('Error updating conversation:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
