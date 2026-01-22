import OpenAI from 'openai';
import { prisma } from '../../index';
import { classifyIntent, CustomerIntent } from './intentClassifier';
import { searchServiceTitanCustomer, createServiceTitanCustomer, createServiceTitanJob, getServiceTitanAvailability, formatSlotsForSMS, AvailabilitySlot } from './serviceTitanSearch';
import { createBookingFromInboundSms, CreateBookingFromInboundSmsOptions } from '../serviceTitanClient';
import { buildConversationSummary } from '../conversationSummary';
import { getActivePersonaForTenant, getKnowledgeSnippetsForTenant } from '../../ai/aiEngine';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface AIAgentResponse {
  shouldRespond: boolean;
  responseText?: string;
  newState: string;
  outcome?: string;
  stCustomerId?: string;
  stLocationId?: string;
  stJobId?: string;
  stBookingId?: string;
}

export async function handleInboundMessage(
  conversationId: string,
  tenantId: string,
  contactId: string,
  messageBody: string
): Promise<AIAgentResponse | null> {
  const config = await prisma.aIAgentConfig.findUnique({
    where: { tenantId },
  });

  if (!config || !config.enabled || !config.autoRespond) {
    return null;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
  });

  if (!tenant || !contact) {
    return null;
  }

  let session = await prisma.aIAgentSession.findUnique({
    where: { conversationId },
    include: { offerContext: true },
  });

  if (!session) {
    session = await prisma.aIAgentSession.create({
      data: {
        conversationId,
        tenantId,
        contactId,
        state: 'INBOUND_RECEIVED',
        confirmedName: `${contact.firstName} ${contact.lastName}`.trim() || undefined,
      },
      include: { offerContext: true },
    });
  }

  await prisma.aIAgentSession.update({
    where: { id: session.id },
    data: { messageCount: session.messageCount + 1 },
  });

  if (session.messageCount >= config.maxMessagesPerSession) {
    return await handoffToCSR(session, tenant, contact, 'Max messages reached');
  }

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  const conversationHistory = messages.map(m => ({
    role: m.direction === 'OUTBOUND' ? 'business' as const : 'customer' as const,
    body: m.body,
  }));

  const offerContext = session.offerContext ? {
    offerType: session.offerContext.offerType,
    offerName: session.offerContext.offerName,
    price: session.offerContext.price || undefined,
  } : undefined;

  const classification = await classifyIntent(messageBody, conversationHistory, offerContext);

  await prisma.aIAgentSession.update({
    where: { id: session.id },
    data: { lastIntent: classification.intent },
  });

  if (classification.extractedData.address) {
    await prisma.aIAgentSession.update({
      where: { id: session.id },
      data: { confirmedAddress: classification.extractedData.address },
    });
    session.confirmedAddress = classification.extractedData.address;
  }
  if (classification.extractedData.email) {
    await prisma.aIAgentSession.update({
      where: { id: session.id },
      data: { confirmedEmail: classification.extractedData.email },
    });
    session.confirmedEmail = classification.extractedData.email;
  }
  if (classification.extractedData.preferredTime) {
    await prisma.aIAgentSession.update({
      where: { id: session.id },
      data: { preferredTimeSlot: classification.extractedData.preferredTime },
    });
    session.preferredTimeSlot = classification.extractedData.preferredTime;
  }

  if (session.state === 'PROPOSING_TIMES' && session.availableSlots) {
    return await handleTimeSlotSelection(session, config, tenant, contact, conversationHistory);
  }

  switch (classification.intent) {
    case 'OPT_OUT':
      return {
        shouldRespond: false,
        newState: 'COMPLETED',
        outcome: 'OPT_OUT',
      };

    case 'NOT_INTERESTED':
      const notInterestedResponse = await generateResponse(
        tenant,
        contact,
        session,
        'Customer declined. Send a brief, polite acknowledgment thanking them for their time.',
        conversationHistory
      );
      await updateSessionState(session.id, 'COMPLETED', 'NOT_INTERESTED');
      return {
        shouldRespond: true,
        responseText: notInterestedResponse,
        newState: 'COMPLETED',
        outcome: 'NOT_INTERESTED',
      };

    case 'NOT_NOW':
      const notNowResponse = await generateResponse(
        tenant,
        contact,
        session,
        'Customer wants to delay. Acknowledge politely and let them know they can reply anytime when ready.',
        conversationHistory
      );
      await updateSessionState(session.id, 'COMPLETED', 'NOT_INTERESTED');
      return {
        shouldRespond: true,
        responseText: notNowResponse,
        newState: 'COMPLETED',
        outcome: 'NOT_INTERESTED',
      };

    case 'INFO_REQUEST':
      const infoResponse = await generateResponse(
        tenant,
        contact,
        session,
        `Customer asked a question: "${classification.extractedData.question || messageBody}". Answer helpfully and briefly, then gently ask if they'd like to schedule.`,
        conversationHistory
      );
      await updateSessionState(session.id, 'QUALIFYING', 'PENDING');
      return {
        shouldRespond: true,
        responseText: infoResponse,
        newState: 'QUALIFYING',
      };

    case 'BOOK_YES':
    case 'INTERESTED':
      return await handleBookingIntent(
        session,
        config,
        tenant,
        contact,
        classification.intent,
        conversationHistory
      );

    case 'RESCHEDULE':
      return await handoffToCSR(session, tenant, contact, 'Customer wants to reschedule');

    case 'WRONG_NUMBER':
      const wrongNumberResponse = "We apologize for the confusion! We'll update our records. Have a great day!";
      await updateSessionState(session.id, 'COMPLETED', 'NOT_INTERESTED');
      return {
        shouldRespond: true,
        responseText: wrongNumberResponse,
        newState: 'COMPLETED',
        outcome: 'NOT_INTERESTED',
      };

    default:
      const clarifyResponse = await generateResponse(
        tenant,
        contact,
        session,
        'Customer response was unclear. Ask a simple yes/no question about whether they want to schedule an appointment.',
        conversationHistory
      );
      await updateSessionState(session.id, 'QUALIFYING', 'PENDING');
      return {
        shouldRespond: true,
        responseText: clarifyResponse,
        newState: 'QUALIFYING',
      };
  }
}

async function handleBookingIntent(
  session: any,
  config: any,
  tenant: any,
  contact: any,
  intent: CustomerIntent,
  conversationHistory: Array<{ role: 'customer' | 'business'; body: string }>
): Promise<AIAgentResponse> {
  
  if (session.state === 'PROPOSING_TIMES' && session.availableSlots) {
    return await handleTimeSlotSelection(session, config, tenant, contact, conversationHistory);
  }
  
  await updateSessionState(session.id, 'MATCHING_ST_RECORDS', 'PENDING');
  
  const stSearch = await searchServiceTitanCustomer(
    session.tenantId,
    contact.phone,
    session.confirmedEmail,
    session.confirmedAddress
  );

  if (stSearch.found && stSearch.exactMatch) {
    const customer = stSearch.customers[0];
    const location = stSearch.locations.find(l => l.id === stSearch.exactMatch?.locationId) || stSearch.locations[0];
    
    await prisma.aIAgentSession.update({
      where: { id: session.id },
      data: {
        stCustomerId: String(customer.id),
        stLocationId: location ? String(location.id) : undefined,
        confirmedName: customer.name,
      },
    });
    
    const needsAddressConfirmation = !session.confirmedAddress || 
      (session.state !== 'PROPOSING_TIMES' && session.state !== 'BOOKING_JOB');
    
    if (location && needsAddressConfirmation) {
      const addressStr = location.address 
        ? `${location.address.street}, ${location.address.city}`
        : 'your address on file';
      
      await prisma.aIAgentSession.update({
        where: { id: session.id },
        data: { confirmedAddress: location?.address?.street },
      });
      
      const confirmAddressResponse = await generateResponse(
        tenant, contact, session,
        `Great news - found their account! Ask them to confirm if "${addressStr}" is still their correct service address for this visit, or if they need service at a different location. Just need a quick yes or the new address.`,
        conversationHistory
      );
      
      await updateSessionState(session.id, 'QUALIFYING', 'PENDING');
      return {
        shouldRespond: true,
        responseText: confirmAddressResponse,
        newState: 'QUALIFYING',
      };
    }
    
    return await proposeAvailableTimes(session, config, tenant, contact, conversationHistory);
    
  } else {
    if (!session.confirmedAddress) {
      const askAddressResponse = await generateResponse(
        tenant, contact, session,
        "Customer is new to our system. Ask for their full service address including street, city, state, and zip so we can set them up and schedule service.",
        conversationHistory
      );
      await updateSessionState(session.id, 'QUALIFYING', 'PENDING');
      return {
        shouldRespond: true,
        responseText: askAddressResponse,
        newState: 'QUALIFYING',
      };
    }
    
    await updateSessionState(session.id, 'CREATING_ST_CUSTOMER', 'PENDING');
    
    const addressParts = parseAddress(session.confirmedAddress || '');
    const createResult = await createServiceTitanCustomer(session.tenantId, {
      name: session.confirmedName || `${contact.firstName} ${contact.lastName}`.trim() || 'Customer',
      phone: contact.phone,
      email: session.confirmedEmail,
      address: addressParts,
    });

    if (createResult) {
      await prisma.aIAgentSession.update({
        where: { id: session.id },
        data: {
          stCustomerId: String(createResult.customerId),
          stLocationId: String(createResult.locationId),
        },
      });
    }
    
    return await proposeAvailableTimes(session, config, tenant, contact, conversationHistory);
  }
}

async function proposeAvailableTimes(
  session: any,
  config: any,
  tenant: any,
  contact: any,
  conversationHistory: Array<{ role: 'customer' | 'business'; body: string }>
): Promise<AIAgentResponse> {
  const slots = await getServiceTitanAvailability(session.tenantId, {
    businessUnitId: config.defaultBusinessUnitId,
    maxSlots: 4,
    daysAhead: 7,
  });
  
  if (slots.length === 0) {
    return await handoffToCSR(session, tenant, contact, 'No available time slots found');
  }
  
  const slotsJson = JSON.stringify(slots);
  await prisma.aIAgentSession.update({
    where: { id: session.id },
    data: { 
      availableSlots: slotsJson,
      state: 'PROPOSING_TIMES',
    },
  });
  
  const slotOptions = formatSlotsForSMS(slots, 3);
  const proposeResponse = `Great! I have a technician available:\n${slotOptions}\n\nWhich works best for you? Reply with 1, 2, or 3.`;
  
  return {
    shouldRespond: true,
    responseText: proposeResponse,
    newState: 'PROPOSING_TIMES',
  };
}

async function handleTimeSlotSelection(
  session: any,
  config: any,
  tenant: any,
  contact: any,
  conversationHistory: Array<{ role: 'customer' | 'business'; body: string }>
): Promise<AIAgentResponse> {
  const lastMessage = conversationHistory[conversationHistory.length - 1]?.body || '';
  
  const slotMatch = lastMessage.match(/\b([1-4])\b/);
  if (!slotMatch) {
    return {
      shouldRespond: true,
      responseText: "Please reply with 1, 2, or 3 to select your preferred time slot.",
      newState: 'PROPOSING_TIMES',
    };
  }
  
  const selectedIndex = parseInt(slotMatch[1]) - 1;
  const slots: AvailabilitySlot[] = JSON.parse(session.availableSlots || '[]');
  
  if (selectedIndex < 0 || selectedIndex >= slots.length) {
    return {
      shouldRespond: true,
      responseText: "Please reply with a valid option number (1, 2, or 3).",
      newState: 'PROPOSING_TIMES',
    };
  }
  
  const selectedSlot = slots[selectedIndex];
  
  await prisma.aIAgentSession.update({
    where: { id: session.id },
    data: { 
      selectedSlotIndex: selectedIndex + 1,
      preferredTimeSlot: selectedSlot.displayText,
    },
  });
  
  if (!config.defaultJobTypeId || !config.defaultBusinessUnitId) {
    return await handoffToCSR(session, tenant, contact, `Customer selected ${selectedSlot.displayText}`);
  }
  
  await updateSessionState(session.id, 'BOOKING_JOB', 'PENDING');
  
  const customerId = parseInt(session.stCustomerId || '0');
  const locationId = parseInt(session.stLocationId || '0');
  
  if (!customerId || !locationId) {
    return await handoffToCSR(session, tenant, contact, `Customer selected ${selectedSlot.displayText} - needs customer setup`);
  }
  
  const startDateTime = new Date(`${selectedSlot.date}T${selectedSlot.startTime}:00`);
  const endDateTime = new Date(`${selectedSlot.date}T${selectedSlot.endTime}:00`);
  
  const jobResult = await createServiceTitanJob(session.tenantId, {
    customerId,
    locationId,
    jobTypeId: config.defaultJobTypeId!,
    businessUnitId: config.defaultBusinessUnitId!,
    summary: session.offerContext?.offerName || 'Service appointment booked via SMS AI Agent',
    preferredTime: selectedSlot.displayText,
    campaignId: config.defaultCampaignId,
    selectedSlot: selectedSlot,
  });

  if (!jobResult) {
    return await handoffToCSR(session, tenant, contact, `Customer selected ${selectedSlot.displayText} - job creation failed`);
  }

  await prisma.aIAgentSession.update({
    where: { id: session.id },
    data: {
      stJobId: String(jobResult.jobId),
      stAppointmentId: String(jobResult.appointmentId),
    },
  });

  await updateSessionState(session.id, 'CONFIRMED', 'FULL_BOOKING');

  const confirmResponse = await generateResponse(
    tenant, contact, session,
    `Appointment successfully booked for ${selectedSlot.displayText}! Confirm the booking and let them know a technician will arrive during that window. Thank them for choosing us.`,
    conversationHistory
  );

  return {
    shouldRespond: true,
    responseText: confirmResponse,
    newState: 'CONFIRMED',
    outcome: 'FULL_BOOKING',
    stCustomerId: String(customerId),
    stLocationId: String(locationId),
    stJobId: String(jobResult.jobId),
  };
}

async function processFullBooking(
  session: any,
  config: any,
  tenant: any,
  contact: any,
  stSearch: any,
  conversationHistory: Array<{ role: 'customer' | 'business'; body: string }>
): Promise<AIAgentResponse> {
  let customerId = stSearch.exactMatch?.customerId;
  let locationId = stSearch.exactMatch?.locationId;

  if (!customerId) {
    await updateSessionState(session.id, 'CREATING_ST_CUSTOMER', 'PENDING');
    
    const addressParts = parseAddress(session.confirmedAddress || '');
    const createResult = await createServiceTitanCustomer(session.tenantId, {
      name: session.confirmedName || `${contact.firstName} ${contact.lastName}`.trim() || 'Customer',
      phone: contact.phone,
      email: session.confirmedEmail,
      address: addressParts,
    });

    if (!createResult) {
      return await handoffToCSR(session, tenant, contact, 'Failed to create customer in ServiceTitan');
    }

    customerId = createResult.customerId;
    locationId = createResult.locationId;

    await prisma.aIAgentSession.update({
      where: { id: session.id },
      data: {
        stCustomerId: String(customerId),
        stLocationId: String(locationId),
      },
    });
  }

  await updateSessionState(session.id, 'BOOKING_JOB', 'PENDING');

  const jobResult = await createServiceTitanJob(session.tenantId, {
    customerId: customerId!,
    locationId: locationId!,
    jobTypeId: config.defaultJobTypeId!,
    businessUnitId: config.defaultBusinessUnitId!,
    summary: session.offerContext?.offerName || 'Service appointment booked via SMS',
    preferredTime: session.preferredTimeSlot,
    campaignId: config.defaultCampaignId,
  });

  if (!jobResult) {
    return await handoffToCSR(session, tenant, contact, 'Failed to create job in ServiceTitan');
  }

  await prisma.aIAgentSession.update({
    where: { id: session.id },
    data: {
      stJobId: String(jobResult.jobId),
      stAppointmentId: String(jobResult.appointmentId),
    },
  });

  await updateSessionState(session.id, 'CONFIRMED', 'FULL_BOOKING');

  const confirmResponse = await generateResponse(
    tenant,
    contact,
    session,
    `Appointment successfully booked! Confirm the booking with the customer. Mention we'll see them soon and a technician will arrive during the scheduled window. Keep it brief and friendly.`,
    conversationHistory
  );

  return {
    shouldRespond: true,
    responseText: confirmResponse,
    newState: 'CONFIRMED',
    outcome: 'FULL_BOOKING',
    stCustomerId: String(customerId),
    stLocationId: String(locationId),
    stJobId: String(jobResult.jobId),
  };
}

async function processCSRBooking(
  session: any,
  tenant: any,
  contact: any,
  stSearch: any,
  conversationHistory: Array<{ role: 'customer' | 'business'; body: string }>
): Promise<AIAgentResponse> {
  await updateSessionState(session.id, 'HANDOFF_TO_CSR', 'PENDING');

  const conversationSummary = await buildConversationSummary(session.conversationId, 50);

  try {
    const booking = await createBookingFromInboundSms({
      tenantId: session.tenantId,
      contact: {
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        email: session.confirmedEmail,
      },
      conversationId: session.conversationId,
      toNumber: contact.phone,
      lastInboundMessage: `[AI Agent - Warm Lead] ${session.offerContext?.offerName || 'Customer interested'}`,
      conversationSummary: conversationSummary,
    });

    if (booking?.bookingId) {
      await prisma.aIAgentSession.update({
        where: { id: session.id },
        data: { stBookingId: String(booking.bookingId) },
      });

      await prisma.conversation.update({
        where: { id: session.conversationId },
        data: { 
          serviceTitanBookingId: String(booking.bookingId),
          serviceTitanBookingCreatedAt: new Date(),
        },
      });
    }
  } catch (error) {
    console.error('Failed to create ST booking:', error);
  }

  await updateSessionState(session.id, 'HANDOFF_TO_CSR', 'CSR_BOOKING');

  const handoffResponse = await generateResponse(
    tenant,
    contact,
    session,
    'Customer is interested but we need to connect them with our team. Let them know someone will reach out shortly to finalize their appointment. Be warm and appreciative.',
    conversationHistory
  );

  return {
    shouldRespond: true,
    responseText: handoffResponse,
    newState: 'HANDOFF_TO_CSR',
    outcome: 'CSR_BOOKING',
  };
}

async function handoffToCSR(
  session: any,
  tenant: any,
  contact: any,
  reason: string
): Promise<AIAgentResponse> {
  await updateSessionState(session.id, 'HANDOFF_TO_CSR', 'NEEDS_HUMAN');

  const conversationSummary = await buildConversationSummary(session.conversationId, 50);

  try {
    await createBookingFromInboundSms({
      tenantId: session.tenantId,
      contact: {
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        email: session.confirmedEmail,
      },
      conversationId: session.conversationId,
      toNumber: contact.phone,
      lastInboundMessage: `[AI Agent - Needs Human] Reason: ${reason}`,
      conversationSummary: conversationSummary,
    });
  } catch (error) {
    console.error('Failed to create handoff booking:', error);
  }

  return {
    shouldRespond: true,
    responseText: `Thanks for your message! One of our team members will reach out to you shortly to assist.`,
    newState: 'HANDOFF_TO_CSR',
    outcome: 'NEEDS_HUMAN',
  };
}

async function generateResponse(
  tenant: any,
  contact: any,
  session: any,
  instruction: string,
  conversationHistory: Array<{ role: 'customer' | 'business'; body: string }>
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    return "Thanks for your message! We'll be in touch shortly.";
  }

  try {
    const persona = await getActivePersonaForTenant(tenant.id);
    const knowledgeArticles = await getKnowledgeSnippetsForTenant(tenant.id, 10);
    
    const historyText = conversationHistory
      .map(m => `${m.role === 'business' ? 'Business' : 'Customer'}: ${m.body}`)
      .join('\n');

    let knowledgeContext = '';
    if (knowledgeArticles.length > 0) {
      knowledgeContext = `\n\nKNOWLEDGE BASE (Use this information to answer questions accurately):\n${knowledgeArticles.map(a => `### ${a.title}\n${a.content}`).join('\n\n')}`;
    }

    const systemPrompt = `${persona.systemPrompt}

You are responding on behalf of ${tenant.publicName || tenant.name}.
${knowledgeContext}

RULES:
1. Keep response under 160 characters (SMS limit)
2. Be friendly and professional
3. Use the customer's first name if known
4. Never mention you're an AI
5. Don't include "Reply STOP to unsubscribe" - it's added automatically
6. End with a clear next step or question when appropriate
7. Use the knowledge base to provide accurate company-specific information`;

    const userPrompt = `CONTEXT:
- Customer Name: ${contact.firstName || 'Customer'}
- Company: ${tenant.publicName || tenant.name}
${session.offerContext ? `- Current Offer: ${session.offerContext.offerName} ${session.offerContext.price ? `at ${session.offerContext.price}` : ''}` : ''}

RECENT CONVERSATION:
${historyText}

INSTRUCTION: ${instruction}

Write ONLY the SMS message text, nothing else:`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 100,
    });

    const text = response.choices[0]?.message?.content?.trim() || '';
    return text.substring(0, 300);
  } catch (error) {
    console.error('Generate response error:', error);
    return "Thanks for your message! We'll be in touch shortly.";
  }
}

async function updateSessionState(sessionId: string, state: string, outcome: string): Promise<void> {
  await prisma.aIAgentSession.update({
    where: { id: sessionId },
    data: { 
      state: state as any,
      outcome: outcome as any,
    },
  });
}

function parseAddress(address: string): { street: string; city: string; state: string; zip: string } {
  const parts = address.split(',').map(p => p.trim());
  
  if (parts.length >= 3) {
    const stateZip = parts[parts.length - 1].split(' ');
    return {
      street: parts[0],
      city: parts[1] || '',
      state: stateZip[0] || 'AZ',
      zip: stateZip[1] || '',
    };
  }
  
  return {
    street: address,
    city: '',
    state: 'AZ',
    zip: '',
  };
}
