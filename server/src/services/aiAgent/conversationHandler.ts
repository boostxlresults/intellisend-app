import OpenAI from 'openai';
import { prisma } from '../../index';
import { classifyIntent, CustomerIntent } from './intentClassifier';
import { searchServiceTitanCustomer, searchByAddress, searchByName, createServiceTitanCustomer, createServiceTitanJob, getServiceTitanAvailability, formatSlotsForSMS, AvailabilitySlot, getEnterpriseCustomerContext, formatEnterpriseContextForAI, EnterpriseCustomerContext } from './serviceTitanSearch';
import { createBookingFromInboundSms, CreateBookingFromInboundSmsOptions } from '../serviceTitanClient';
import { buildConversationSummary } from '../conversationSummary';
import { getActivePersonaForTenant, getKnowledgeSnippetsForTenant } from '../../ai/aiEngine';
import { sendReplyNotification } from '../emailNotifications';

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
  try {
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

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!tenant || !contact || !conversation) {
      return null;
    }

    // Check if AI agent is disabled at contact or conversation level
    if ((contact as any).aiAgentEnabled === false || (conversation as any).aiAgentEnabled === false) {
      console.log(`[AI Agent] Disabled for contact ${contactId} or conversation ${conversationId}`);
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

  // Fetch ServiceTitan customer context for personalized responses (only once per conversation)
  if (!session.stContextChecked) {
    const stCustomerContext = await getServiceTitanCustomerContext(tenantId, contact);
    
    // Store the context on the session (mark as checked regardless of result)
    const updatedSession = await prisma.aIAgentSession.update({
      where: { id: session.id },
      data: {
        stContextChecked: true,
        stExistingCustomer: stCustomerContext?.isExistingCustomer || false,
        stAddressOnFile: stCustomerContext?.address || null,
        stCityOnFile: stCustomerContext?.city || null,
        stStateOnFile: stCustomerContext?.state || null,
        stEnterpriseContext: stCustomerContext?.enterpriseContext || null,
        stIsMember: stCustomerContext?.isMember || false,
        stLastServiceDate: stCustomerContext?.lastServiceDate || null,
        stLastServiceType: stCustomerContext?.lastServiceType || null,
        stPendingEstimateCount: stCustomerContext?.pendingEstimateCount || 0,
      },
      include: { offerContext: true },
    });
    // Refresh in-memory session for subsequent calls in this request
    session.stContextChecked = true;
    session.stExistingCustomer = updatedSession.stExistingCustomer;
    session.stAddressOnFile = updatedSession.stAddressOnFile;
    session.stCityOnFile = updatedSession.stCityOnFile;
    session.stStateOnFile = updatedSession.stStateOnFile;
    session.stEnterpriseContext = updatedSession.stEnterpriseContext;
    session.stIsMember = updatedSession.stIsMember;
    session.stLastServiceDate = updatedSession.stLastServiceDate;
    session.stLastServiceType = updatedSession.stLastServiceType;
    session.stPendingEstimateCount = updatedSession.stPendingEstimateCount;
  }

  console.log(`[AI Agent] Classifying intent for message: "${messageBody.substring(0, 50)}..."`);
  const classification = await classifyIntent(messageBody, conversationHistory, offerContext);
  console.log(`[AI Agent] Intent: ${classification.intent}, Extracted address: ${classification.extractedData.address || 'none'}`);

  await prisma.aIAgentSession.update({
    where: { id: session.id },
    data: { lastIntent: classification.intent },
  });

  if (classification.extractedData.address) {
    console.log(`[AI Agent] Saving extracted address: ${classification.extractedData.address}`);
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
  if (classification.extractedData.name) {
    await prisma.aIAgentSession.update({
      where: { id: session.id },
      data: { confirmedName: classification.extractedData.name },
    });
    session.confirmedName = classification.extractedData.name;
  }

  // Handle state-specific responses when user provides requested info
  if (session.state === 'AWAITING_NAME' && session.confirmedName) {
    // User provided their name - continue with booking flow
    return await handleBookingIntent(session, config, tenant, contact, 'BOOK_YES', conversationHistory);
  }
  
  // Fallback: If we're collecting address and OpenAI didn't extract it, but message looks like an address
  if (session.state === 'COLLECTING_ADDRESS' && !session.confirmedAddress) {
    const looksLikeAddress = /\d+.*(?:st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|way|ct|court|pl|place|cir|circle|trail|trl)/i.test(messageBody) ||
                             /\d{5}(?:-\d{4})?/.test(messageBody); // Has zip code
    if (looksLikeAddress) {
      console.log(`[AI Agent] Fallback address extraction: "${messageBody}"`);
      await prisma.aIAgentSession.update({
        where: { id: session.id },
        data: { confirmedAddress: messageBody.trim() },
      });
      session.confirmedAddress = messageBody.trim();
    }
  }
  
  if (session.state === 'COLLECTING_ADDRESS' && session.confirmedAddress) {
    // User provided their address - continue with booking flow
    console.log(`[AI Agent] State is COLLECTING_ADDRESS with address "${session.confirmedAddress}", calling handleBookingIntent`);
    return await handleBookingIntent(session, config, tenant, contact, 'BOOK_YES', conversationHistory);
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

    case 'CALL_ME':
      return await handleCallMeRequest(session, config, tenant, contact, conversationHistory);

    case 'CONFIRM_YES':
      return await handleIdentityConfirmation(session, config, tenant, contact, true, conversationHistory);

    case 'CONFIRM_NO':
      return await handleIdentityConfirmation(session, config, tenant, contact, false, conversationHistory);

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
  } catch (error) {
    console.error('[AI Agent] Critical error in handleInboundMessage:', error);
    return {
      shouldRespond: true,
      responseText: "Thanks for your message! One of our team members will reach out to you shortly.",
      newState: 'ERROR',
      outcome: 'NEEDS_HUMAN',
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
  console.log(`[AI Agent] handleBookingIntent started, session state: ${session.state}, address: ${session.confirmedAddress}`);
  
  try {
    if (session.state === 'PROPOSING_TIMES' && session.availableSlots) {
      return await handleTimeSlotSelection(session, config, tenant, contact, conversationHistory);
    }
    
    await updateSessionState(session.id, 'MATCHING_ST_RECORDS', 'PENDING');
  
  // STEP 1: Search by phone number first (most reliable)
  console.log(`[AI Agent] STEP 1: Searching ServiceTitan by phone: ${contact.phone}`);
  const phoneSearch = await searchServiceTitanCustomer(
    session.tenantId,
    contact.phone,
    session.confirmedEmail,
    session.confirmedAddress
  );

  console.log(`[AI Agent] Phone search result: found=${phoneSearch.found}, customers=${phoneSearch.customers.length}`);
  
  if (phoneSearch.found && phoneSearch.customers.length > 0) {
    // Found by phone - use first customer (phone is unique enough)
    const customer = phoneSearch.customers[0];
    const location = phoneSearch.locations.find(l => l.customerId === customer.id) || phoneSearch.locations[0];
    
    // If multiple customers found by phone, ask to confirm identity
    if (phoneSearch.customers.length > 1 && session.state !== 'AWAITING_IDENTITY_CONFIRM') {
      await prisma.aIAgentSession.update({
        where: { id: session.id },
        data: {
          pendingMatchCustomerId: String(customer.id),
          pendingMatchLocationId: location ? String(location.id) : undefined,
          pendingMatchName: customer.name,
          state: 'AWAITING_IDENTITY_CONFIRM',
        },
      });
      
      const confirmIdentityResponse = await generateResponse(
        tenant, contact, session,
        `I found an account for "${customer.name}" with this phone number. Is that you?`,
        conversationHistory
      );
      
      return {
        shouldRespond: true,
        responseText: confirmIdentityResponse,
        newState: 'AWAITING_IDENTITY_CONFIRM',
      };
    }
    
    console.log(`[AI Agent] Setting session customer from phone search: stCustomerId=${customer.id}, stLocationId=${location?.id}`);
    await prisma.aIAgentSession.update({
      where: { id: session.id },
      data: {
        stCustomerId: String(customer.id),
        stLocationId: location ? String(location.id) : undefined,
        confirmedName: customer.name,
      },
    });
    
    // Confirm address on file
    if (location && session.state !== 'AWAITING_ADDRESS_CONFIRM') {
      const addressStr = location.address 
        ? `${location.address.street}, ${location.address.city}`
        : 'your address on file';
      
      await prisma.aIAgentSession.update({
        where: { id: session.id },
        data: { 
          confirmedAddress: location?.address?.street,
          state: 'AWAITING_ADDRESS_CONFIRM',
        },
      });
      
      const confirmAddressResponse = await generateResponse(
        tenant, contact, session,
        `Great - I found your account! Just to confirm, is "${addressStr}" still the best address for today's service? Just reply yes or give me the correct address.`,
        conversationHistory
      );
      
      return {
        shouldRespond: true,
        responseText: confirmAddressResponse,
        newState: 'AWAITING_ADDRESS_CONFIRM',
      };
    }
    
    return await proposeAvailableTimes(session, config, tenant, contact, conversationHistory);
  }
  
  // STEP 2: No phone match - ask for address first
  if (!session.confirmedAddress) {
    const askAddressResponse = await generateResponse(
      tenant, contact, session,
      "I'd love to help get you scheduled! What's the address where you'd like the service? Please include street, city, and zip.",
      conversationHistory
    );
    
    await prisma.aIAgentSession.update({
      where: { id: session.id },
      data: { state: 'COLLECTING_ADDRESS' },
    });
    
    return {
      shouldRespond: true,
      responseText: askAddressResponse,
      newState: 'COLLECTING_ADDRESS',
    };
  }
  
  // STEP 3: We have an address - search by address to find potential duplicates
  console.log(`[AI Agent] STEP 3: Searching ServiceTitan by address: "${session.confirmedAddress}"`);
  const addressSearch = await searchByAddress(session.tenantId, session.confirmedAddress);
  console.log(`[AI Agent] Address search result: found=${addressSearch.found}, matches=${addressSearch.possibleMatches?.length || 0}`);
  
  if (addressSearch.found && addressSearch.possibleMatches && addressSearch.possibleMatches.length > 0) {
    // Found potential match by address - ask for identity confirmation
    const match = addressSearch.possibleMatches[0];
    
    await prisma.aIAgentSession.update({
      where: { id: session.id },
      data: {
        pendingMatchCustomerId: String(match.customerId),
        pendingMatchLocationId: match.locationId ? String(match.locationId) : undefined,
        pendingMatchName: match.customerName,
        state: 'AWAITING_IDENTITY_CONFIRM',
      },
    });
    
    const confirmIdentityResponse = await generateResponse(
      tenant, contact, session,
      `I found an account at that address under the name "${match.customerName}". Is that you? Just reply yes or no.`,
      conversationHistory
    );
    
    return {
      shouldRespond: true,
      responseText: confirmIdentityResponse,
      newState: 'AWAITING_IDENTITY_CONFIRM',
    };
  }
  
  // STEP 4: No address match - ask for name
  console.log(`[AI Agent] STEP 4: No address match, checking for name. Current confirmedName: "${session.confirmedName}"`);
  if (!session.confirmedName) {
    const contactName = `${contact.firstName} ${contact.lastName}`.trim();
    console.log(`[AI Agent] Contact name from record: "${contactName}"`);
    if (contactName && contactName !== 'Customer') {
      // We have a name from the contact record - use it
      session.confirmedName = contactName;
      await prisma.aIAgentSession.update({
        where: { id: session.id },
        data: { confirmedName: contactName },
      });
      console.log(`[AI Agent] Using contact name: "${contactName}"`);
    } else {
      // Ask for name
      const askNameResponse = await generateResponse(
        tenant, contact, session,
        "Almost there! What name should I put on the account?",
        conversationHistory
      );
      
      await prisma.aIAgentSession.update({
        where: { id: session.id },
        data: { state: 'AWAITING_NAME' },
      });
      
      return {
        shouldRespond: true,
        responseText: askNameResponse,
        newState: 'AWAITING_NAME',
      };
    }
  }
  
  // STEP 5: Search by name as final duplicate check
  console.log(`[AI Agent] STEP 5: Searching by name: "${session.confirmedName}"`);
  if (session.confirmedName) {
    const nameSearch = await searchByName(session.tenantId, session.confirmedName);
    console.log(`[AI Agent] Name search result: found=${nameSearch.found}, matches=${nameSearch.possibleMatches?.length || 0}`);
    
    if (nameSearch.found && nameSearch.possibleMatches && nameSearch.possibleMatches.length > 0) {
      // Found potential match by name - ask for confirmation
      const match = nameSearch.possibleMatches[0];
      
      if (match.address) {
        await prisma.aIAgentSession.update({
          where: { id: session.id },
          data: {
            pendingMatchCustomerId: String(match.customerId),
            pendingMatchLocationId: match.locationId ? String(match.locationId) : undefined,
            pendingMatchName: match.customerName,
            state: 'AWAITING_IDENTITY_CONFIRM',
          },
        });
        
        const confirmNameMatchResponse = await generateResponse(
          tenant, contact, session,
          `I found an account for "${match.customerName}" at ${match.address}. Is that you? Just reply yes or no.`,
          conversationHistory
        );
        
        return {
          shouldRespond: true,
          responseText: confirmNameMatchResponse,
          newState: 'AWAITING_IDENTITY_CONFIRM',
        };
      }
    }
  }
  
  // STEP 6: No matches found - create new customer
  console.log(`[AI Agent] STEP 6: No matches found, creating new ServiceTitan customer`);
  await updateSessionState(session.id, 'CREATING_ST_CUSTOMER', 'PENDING');
  
  const addressParts = parseAddress(session.confirmedAddress || '');
  console.log(`[AI Agent] Creating customer with name: "${session.confirmedName || contact.firstName}", phone: ${contact.phone}`);
  const createResult = await createServiceTitanCustomer(session.tenantId, {
    name: session.confirmedName || `${contact.firstName} ${contact.lastName}`.trim() || 'Customer',
    phone: contact.phone,
    email: session.confirmedEmail,
    address: addressParts,
  });

  console.log(`[AI Agent] Create customer result: ${createResult ? `customerId=${createResult.customerId}` : 'failed/null'}`);
  if (createResult) {
    console.log(`[AI Agent] Setting session customer from creation: stCustomerId=${createResult.customerId}, stLocationId=${createResult.locationId}`);
    await prisma.aIAgentSession.update({
      where: { id: session.id },
      data: {
        stCustomerId: String(createResult.customerId),
        stLocationId: String(createResult.locationId),
      },
    });
  } else {
    console.error(`[AI Agent] WARNING: Customer creation returned null - session will NOT have stCustomerId`);
  }
  
  console.log(`[AI Agent] Calling proposeAvailableTimes`);
  return await proposeAvailableTimes(session, config, tenant, contact, conversationHistory);
  } catch (error) {
    console.error('Error in handleBookingIntent:', error);
    return await handoffToCSR(session, tenant, contact, 'ServiceTitan API error during booking flow');
  }
}

async function proposeAvailableTimes(
  session: any,
  config: any,
  tenant: any,
  contact: any,
  conversationHistory: Array<{ role: 'customer' | 'business'; body: string }>
): Promise<AIAgentResponse> {
  console.log(`[AI Agent] proposeAvailableTimes: businessUnitId=${config?.defaultBusinessUnitId}`);
  try {
    const slots = await getServiceTitanAvailability(session.tenantId, {
      businessUnitId: config.defaultBusinessUnitId,
      maxSlots: 4,
      daysAhead: 7,
    });
    console.log(`[AI Agent] Got ${slots.length} availability slots`);
    
    if (slots.length === 0) {
      console.log(`[AI Agent] No slots available, handing off to CSR`);
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
  } catch (error) {
    console.error('Error in proposeAvailableTimes:', error);
    return await handoffToCSR(session, tenant, contact, 'Error fetching available time slots');
  }
}

async function handleTimeSlotSelection(
  session: any,
  config: any,
  tenant: any,
  contact: any,
  conversationHistory: Array<{ role: 'customer' | 'business'; body: string }>
): Promise<AIAgentResponse> {
  console.log(`[AI Agent] handleTimeSlotSelection: sessionId=${session.id}, stCustomerId=${session.stCustomerId}, stLocationId=${session.stLocationId}`);
  try {
    const lastMessage = conversationHistory[conversationHistory.length - 1]?.body || '';
    console.log(`[AI Agent] Last message for slot selection: "${lastMessage}"`);
    
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
  } catch (error) {
    console.error('Error in handleTimeSlotSelection:', error);
    return await handoffToCSR(session, tenant, contact, 'Error creating booking - please call customer');
  }
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

async function handleCallMeRequest(
  session: any,
  config: any,
  tenant: any,
  contact: any,
  conversationHistory: Array<{ role: 'customer' | 'business'; body: string }>
): Promise<AIAgentResponse> {
  await updateSessionState(session.id, 'HANDOFF_TO_CSR', 'CSR_BOOKING');

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
      lastInboundMessage: `[AI Agent - Customer Requested Callback] ${session.offerContext?.offerName || 'Interested customer'}`,
      conversationSummary: conversationSummary,
    });
  } catch (error) {
    console.error('Failed to create callback booking:', error);
  }

  const callbackResponse = await generateResponse(
    tenant, contact, session,
    'Customer specifically asked for someone to call them. Let them know warmly that someone from the team will give them a call shortly. Be friendly and appreciative of their interest.',
    conversationHistory
  );

  return {
    shouldRespond: true,
    responseText: callbackResponse,
    newState: 'HANDOFF_TO_CSR',
    outcome: 'CSR_BOOKING',
  };
}

async function handleIdentityConfirmation(
  session: any,
  config: any,
  tenant: any,
  contact: any,
  confirmed: boolean,
  conversationHistory: Array<{ role: 'customer' | 'business'; body: string }>
): Promise<AIAgentResponse> {
  if (confirmed) {
    if (session.state === 'AWAITING_ADDRESS_CONFIRM' || session.state === 'QUALIFYING') {
      return await proposeAvailableTimes(session, config, tenant, contact, conversationHistory);
    }
    
    if (session.state === 'AWAITING_IDENTITY_CONFIRM' && session.pendingMatchCustomerId) {
      await prisma.aIAgentSession.update({
        where: { id: session.id },
        data: {
          stCustomerId: String(session.pendingMatchCustomerId),
          stLocationId: session.pendingMatchLocationId ? String(session.pendingMatchLocationId) : undefined,
          confirmedName: session.pendingMatchName,
        },
      });
      
      return await proposeAvailableTimes(session, config, tenant, contact, conversationHistory);
    }
    
    return await handleBookingIntent(session, config, tenant, contact, 'BOOK_YES', conversationHistory);
  } else {
    if (session.state === 'AWAITING_ADDRESS_CONFIRM') {
      const askNewAddressResponse = await generateResponse(
        tenant, contact, session,
        "They said that's not their current address. Ask them nicely for the correct address where they'd like the service. Be friendly - maybe they moved or it's a different property.",
        conversationHistory
      );
      
      await prisma.aIAgentSession.update({
        where: { id: session.id },
        data: { confirmedAddress: null, state: 'COLLECTING_ADDRESS' },
      });
      
      return {
        shouldRespond: true,
        responseText: askNewAddressResponse,
        newState: 'COLLECTING_ADDRESS',
      };
    }
    
    if (session.state === 'AWAITING_IDENTITY_CONFIRM') {
      const askAddressResponse = await generateResponse(
        tenant, contact, session,
        "They said that's not them. Apologize for the mixup and ask for their full service address so we can set them up properly. Be friendly and understanding.",
        conversationHistory
      );
      
      await prisma.aIAgentSession.update({
        where: { id: session.id },
        data: { 
          pendingMatchCustomerId: null, 
          pendingMatchLocationId: null,
          pendingMatchName: null,
          state: 'COLLECTING_ADDRESS',
        },
      });
      
      return {
        shouldRespond: true,
        responseText: askAddressResponse,
        newState: 'COLLECTING_ADDRESS',
      };
    }
    
    return await handleBookingIntent(session, config, tenant, contact, 'BOOK_YES', conversationHistory);
  }
}

async function handoffToCSR(
  session: any,
  tenant: any,
  contact: any,
  reason: string
): Promise<AIAgentResponse> {
  await updateSessionState(session.id, 'HANDOFF_TO_CSR', 'NEEDS_HUMAN');

  const conversationSummary = await buildConversationSummary(session.conversationId, 50);
  let stBookingCreated = false;

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
    stBookingCreated = true;
  } catch (error) {
    console.error('Failed to create handoff booking:', error);
  }

  // Send email notification as backup (especially important if ST booking failed)
  const tenantSettings = await prisma.tenantSettings.findUnique({
    where: { tenantId: session.tenantId },
  });
  
  if (tenantSettings?.notificationEmail) {
    try {
      const messages = await prisma.message.findMany({
        where: { conversationId: session.conversationId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      const conversationUrl = `https://app.intellisend.net/conversations/${session.conversationId}`;
      
      await sendReplyNotification({
        toEmail: tenantSettings.notificationEmail,
        tenantName: tenant.name,
        contactName: `${contact.firstName} ${contact.lastName}`.trim() || 'Customer',
        contactPhone: contact.phone,
        conversationId: session.conversationId,
        conversationUrl,
        messages: messages.reverse().map((m: any) => ({
          direction: m.direction,
          body: m.body,
          createdAt: m.createdAt,
        })),
        serviceTitanEnabled: stBookingCreated,
      });
      console.log(`[AI Agent] Email notification sent to ${tenant.notificationEmail} for handoff (ST booking: ${stBookingCreated})`);
    } catch (emailError) {
      console.error('Failed to send handoff email notification:', emailError);
    }
  }

  return {
    shouldRespond: true,
    responseText: `Thanks for your message! One of our team members will reach out to you shortly to assist.`,
    newState: 'HANDOFF_TO_CSR',
    outcome: 'NEEDS_HUMAN',
  };
}

interface ServiceTitanCustomerContext {
  isExistingCustomer: boolean;
  address?: string;
  city?: string;
  state?: string;
  customerName?: string;
  stCustomerId?: number;
  enterpriseContext?: string;
  isMember?: boolean;
  lastServiceDate?: string;
  lastServiceType?: string;
  pendingEstimateCount?: number;
}

async function getServiceTitanCustomerContext(
  tenantId: string,
  contact: any
): Promise<ServiceTitanCustomerContext | null> {
  try {
    // Check if contact has "In ServiceTitan" tag
    const stTag = await prisma.tag.findFirst({
      where: {
        tenantId,
        name: 'In ServiceTitan',
      },
    });

    if (!stTag) {
      return null;
    }

    const hasTag = await prisma.contactTag.findFirst({
      where: {
        contactId: contact.id,
        tagId: stTag.id,
      },
    });

    if (!hasTag) {
      return null;
    }

    // Contact is tagged as "In ServiceTitan" - fetch their data
    console.log(`[AI Agent] Contact ${contact.id} has "In ServiceTitan" tag, fetching customer data...`);
    
    const searchResult = await searchServiceTitanCustomer(
      tenantId,
      contact.phone,
      contact.email,
      undefined
    );

    if (searchResult.found && searchResult.customers.length > 0) {
      const customer = searchResult.customers[0];
      const location = searchResult.locations.find(l => l.customerId === customer.id);
      
      console.log(`[AI Agent] Found ServiceTitan customer: ${customer.name}, address: ${location?.address?.street || 'none'}`);
      
      // Fetch enterprise context (job history, memberships, equipment, estimates, tags)
      let enterpriseContext: string | undefined;
      let isMember = false;
      let lastServiceDate: string | undefined;
      let lastServiceType: string | undefined;
      let pendingEstimateCount = 0;
      
      try {
        const enterpriseData = await getEnterpriseCustomerContext(tenantId, customer.id);
        if (enterpriseData) {
          enterpriseContext = formatEnterpriseContextForAI(enterpriseData);
          isMember = enterpriseData.isMember;
          lastServiceDate = enterpriseData.lastServiceDate;
          lastServiceType = enterpriseData.lastServiceType;
          pendingEstimateCount = enterpriseData.pendingEstimates.length;
          console.log(`[AI Agent] Enterprise context loaded: member=${isMember}, jobs=${enterpriseData.totalJobsCompleted}, estimates=${pendingEstimateCount}`);
        }
      } catch (err) {
        console.error('[AI Agent] Error fetching enterprise context:', err);
      }
      
      return {
        isExistingCustomer: true,
        address: location?.address?.street,
        city: location?.address?.city,
        state: location?.address?.state,
        customerName: customer.name,
        stCustomerId: customer.id,
        enterpriseContext,
        isMember,
        lastServiceDate,
        lastServiceType,
        pendingEstimateCount,
      };
    }

    // Tagged but couldn't find in ServiceTitan (might have been synced previously)
    return {
      isExistingCustomer: true,
      address: contact.address,
      city: contact.city,
      state: contact.state,
      customerName: `${contact.firstName} ${contact.lastName}`.trim(),
    };
  } catch (error) {
    console.error('[AI Agent] Error fetching ServiceTitan customer context:', error);
    return null;
  }
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

  // Read ServiceTitan context from session (cached from first message lookup)
  const stCustomerContext: ServiceTitanCustomerContext | null = session.stExistingCustomer
    ? {
        isExistingCustomer: true,
        address: session.stAddressOnFile || undefined,
        city: session.stCityOnFile || undefined,
        state: session.stStateOnFile || undefined,
        customerName: session.confirmedName || undefined,
        enterpriseContext: session.stEnterpriseContext || undefined,
        isMember: session.stIsMember || false,
        lastServiceDate: session.stLastServiceDate || undefined,
        lastServiceType: session.stLastServiceType || undefined,
        pendingEstimateCount: session.stPendingEstimateCount || 0,
      }
    : null;

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

PERSONALITY:
- Be warm, friendly, and conversational like texting with a helpful friend
- Use natural, casual language (contractions, simple words)
- Sound human and genuine, not robotic or scripted
- Show enthusiasm when appropriate ("Great!", "Awesome!", "Perfect!")
- Be empathetic and understanding

RULES:
1. Keep response under 160 characters (SMS limit)
2. Use the customer's first name when you have it
3. Never mention you're an AI or bot
4. Don't include "Reply STOP" - it's added automatically
5. End with a clear, simple next step or question
6. Use the knowledge base for accurate company info
7. Match the customer's energy - if they're excited, be excited back
8. ALWAYS reference the conversation context - if replying to "who is this?", mention what the previous message was about
9. Be specific about what you're helping with based on the conversation history`;

    let existingCustomerContext = '';
    if (stCustomerContext?.isExistingCustomer) {
      existingCustomerContext = `\n- EXISTING CUSTOMER: Yes, they have an account with us!`;
      if (stCustomerContext.isMember) {
        existingCustomerContext += `\n- VIP MEMBER: This customer is an active service plan member - treat with priority!`;
      }
      if (stCustomerContext.address) {
        existingCustomerContext += `\n- Address on file: ${stCustomerContext.address}${stCustomerContext.city ? `, ${stCustomerContext.city}` : ''}${stCustomerContext.state ? `, ${stCustomerContext.state}` : ''}`;
      }
      if (stCustomerContext.customerName && stCustomerContext.customerName !== contact.firstName) {
        existingCustomerContext += `\n- Name on account: ${stCustomerContext.customerName}`;
      }
      if (stCustomerContext.enterpriseContext) {
        existingCustomerContext += `\n\nCUSTOMER HISTORY (from ServiceTitan):\n${stCustomerContext.enterpriseContext}`;
      }
      if (stCustomerContext.pendingEstimateCount && stCustomerContext.pendingEstimateCount > 0) {
        existingCustomerContext += `\n- TIP: Customer has ${stCustomerContext.pendingEstimateCount} pending estimate(s) - consider asking if they'd like to proceed with any!`;
      }
    }

    const userPrompt = `CONTEXT:
- Customer Name: ${contact.firstName || 'Customer'}
- Company: ${tenant.publicName || tenant.name}${existingCustomerContext}
${session.offerContext ? `- Current Offer: ${session.offerContext.offerName} ${session.offerContext.price ? `at ${session.offerContext.price}` : ''}` : ''}

RECENT CONVERSATION:
${historyText}

INSTRUCTION: ${instruction}
${stCustomerContext?.isExistingCustomer && stCustomerContext.address && conversationHistory.length <= 2 ? `\nIMPORTANT: Since this is an existing customer with address on file, consider warmly acknowledging you recognize them and confirming their address is still correct (e.g., "I see you're already in our system! Are you still at [address]?") - but only if appropriate to the conversation flow.` : ''}

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
