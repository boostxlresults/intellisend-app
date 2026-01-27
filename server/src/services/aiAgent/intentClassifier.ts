import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type CustomerIntent = 
  | 'BOOK_YES'           // Ready to book
  | 'INTERESTED'         // Interested but needs more info
  | 'INFO_REQUEST'       // Asking questions
  | 'RESCHEDULE'         // Wants to reschedule
  | 'NOT_NOW'            // Maybe later
  | 'NOT_INTERESTED'     // Clear no
  | 'OPT_OUT'            // STOP, UNSUBSCRIBE, etc.
  | 'WRONG_NUMBER'       // Wrong person
  | 'CALL_ME'            // Wants a person to call them
  | 'CONFIRM_YES'        // Confirming identity/address (yes, that's me)
  | 'CONFIRM_NO'         // Denying identity/address (no, wrong person/address)
  | 'UNCLEAR';           // Can't determine intent

export interface IntentClassification {
  intent: CustomerIntent;
  confidence: number;
  reasoning: string;
  extractedData: {
    address?: string;
    name?: string;
    email?: string;
    preferredTime?: string;
    question?: string;
  };
}

const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];

export async function classifyIntent(
  message: string,
  conversationHistory: Array<{ role: 'customer' | 'business'; body: string }>,
  offerContext?: {
    offerType?: string;
    offerName?: string;
    price?: string;
  }
): Promise<IntentClassification> {
  const upperMessage = message.toUpperCase().trim();
  if (STOP_WORDS.some(word => upperMessage === word)) {
    return {
      intent: 'OPT_OUT',
      confidence: 1.0,
      reasoning: 'Customer used explicit opt-out keyword',
      extractedData: {},
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    return fallbackClassification(message);
  }

  try {
    const historyText = conversationHistory
      .slice(-6)
      .map(m => `${m.role === 'business' ? 'Business' : 'Customer'}: ${m.body}`)
      .join('\n');

    const offerText = offerContext
      ? `Current Offer: ${offerContext.offerName || offerContext.offerType} ${offerContext.price ? `at ${offerContext.price}` : ''}`
      : 'No specific offer context';

    const prompt = `You are an intent classifier for a home services SMS booking system.

CONTEXT:
${offerText}

CONVERSATION HISTORY:
${historyText}

LATEST CUSTOMER MESSAGE:
"${message}"

Classify the customer's intent into ONE of these categories:
- BOOK_YES: Customer clearly wants to book/schedule (e.g., "yes", "book me", "I'm in", "schedule me", "let's do it")
- INTERESTED: Customer shows interest but isn't fully committing (e.g., "sounds good", "tell me more", "maybe", "interested")
- INFO_REQUEST: Customer is asking a question about the service (e.g., "what's included?", "how long does it take?")
- RESCHEDULE: Customer wants to change an existing appointment
- NOT_NOW: Customer wants to delay (e.g., "not right now", "maybe next month", "busy this week")
- NOT_INTERESTED: Clear rejection (e.g., "no thanks", "not interested", "don't need it")
- OPT_OUT: Wants to stop receiving messages
- WRONG_NUMBER: Claims wrong number or wrong person
- CALL_ME: Customer prefers a real person call them (e.g., "can someone call me", "have someone give me a call", "I'd rather talk to someone")
- CONFIRM_YES: Customer confirming their identity or address (e.g., "yes that's me", "correct", "yep that's right", "that's my address")
- CONFIRM_NO: Customer denying identity or address (e.g., "no that's not me", "wrong address", "I moved", "different location")
- UNCLEAR: Cannot determine intent

Also extract any data the customer provided:
- address (if they mention a street address)
- name (if they mention their name)
- email (if they mention an email)
- preferredTime (if they mention a time preference like "mornings" or "next Tuesday")
- question (if they're asking something)

Respond in JSON format:
{
  "intent": "INTENT_TYPE",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation",
  "extractedData": {
    "address": null or "extracted address",
    "name": null or "extracted name",
    "email": null or "extracted email",
    "preferredTime": null or "extracted time",
    "question": null or "extracted question"
  }
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return fallbackClassification(message);
    }

    const parsed = JSON.parse(content) as IntentClassification;
    return {
      intent: parsed.intent || 'UNCLEAR',
      confidence: parsed.confidence || 0.5,
      reasoning: parsed.reasoning || 'AI classification',
      extractedData: parsed.extractedData || {},
    };
  } catch (error) {
    console.error('Intent classification error:', error);
    return fallbackClassification(message);
  }
}

function fallbackClassification(message: string): IntentClassification {
  const lower = message.toLowerCase().trim();
  
  const yesPatterns = ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'book', 'schedule', "i'm in", 'im in', 'let\'s do it', 'sign me up'];
  const noPatterns = ['no', 'nope', 'not interested', 'no thanks', 'pass'];
  const laterPatterns = ['later', 'not now', 'maybe', 'next month', 'busy'];
  const questionPatterns = ['?', 'what', 'how', 'when', 'where', 'why', 'which', 'does', 'is it', 'can you'];
  const callMePatterns = ['call me', 'give me a call', 'call back', 'phone call', 'talk to someone', 'speak to someone', 'real person'];
  const confirmYesPatterns = ["that's me", "that's correct", "that's right", "correct address", "yes that"];
  const confirmNoPatterns = ["that's not me", "wrong address", "not my address", "i moved", "different address", "no that"];

  if (callMePatterns.some(p => lower.includes(p))) {
    return { intent: 'CALL_ME', confidence: 0.8, reasoning: 'Matched call me pattern', extractedData: {} };
  }
  if (confirmYesPatterns.some(p => lower.includes(p))) {
    return { intent: 'CONFIRM_YES', confidence: 0.8, reasoning: 'Matched confirm yes pattern', extractedData: {} };
  }
  if (confirmNoPatterns.some(p => lower.includes(p))) {
    return { intent: 'CONFIRM_NO', confidence: 0.8, reasoning: 'Matched confirm no pattern', extractedData: {} };
  }
  if (yesPatterns.some(p => lower.includes(p))) {
    return { intent: 'BOOK_YES', confidence: 0.7, reasoning: 'Matched yes pattern', extractedData: {} };
  }
  if (noPatterns.some(p => lower.includes(p))) {
    return { intent: 'NOT_INTERESTED', confidence: 0.7, reasoning: 'Matched no pattern', extractedData: {} };
  }
  if (laterPatterns.some(p => lower.includes(p))) {
    return { intent: 'NOT_NOW', confidence: 0.6, reasoning: 'Matched later pattern', extractedData: {} };
  }
  if (questionPatterns.some(p => lower.includes(p))) {
    return { intent: 'INFO_REQUEST', confidence: 0.6, reasoning: 'Matched question pattern', extractedData: { question: message } };
  }

  return { intent: 'UNCLEAR', confidence: 0.3, reasoning: 'No pattern matched', extractedData: {} };
}
