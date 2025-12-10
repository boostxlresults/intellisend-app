import OpenAI from 'openai';
import { prisma } from '../index';

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY not set - AI features will use fallback responses');
    return null;
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

interface AiPersona {
  id: string;
  name: string;
  systemPrompt: string;
  description?: string | null;
  canAutoReply: boolean;
}

interface KnowledgeSnippet {
  title: string;
  topic: string;
  content: string;
}

export async function getActivePersonaForTenant(tenantId: string): Promise<AiPersona> {
  const persona = await prisma.aiPersona.findFirst({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
  });

  if (persona) {
    return {
      id: persona.id,
      name: persona.name,
      systemPrompt: persona.systemPrompt,
      description: persona.description,
      canAutoReply: persona.canAutoReply,
    };
  }

  return {
    id: 'default',
    name: 'Default Assistant',
    systemPrompt: 'You are a helpful SMS assistant for a home-services brand. Be friendly, professional, and concise.',
    description: null,
    canAutoReply: false,
  };
}

export async function getKnowledgeSnippetsForTenant(tenantId: string, limit: number = 5): Promise<KnowledgeSnippet[]> {
  const articles = await prisma.knowledgeBaseArticle.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      title: true,
      topic: true,
      content: true,
    },
  });

  return articles;
}

export interface GenerateImprovedMessageOptions {
  tenantId: string;
  personaId?: string;
  originalText: string;
  goal?: 'higher_reply_rate' | 'more_compliant' | 'shorter' | 'friendlier';
}

export interface GenerateImprovedMessageResult {
  text: string;
}

export async function generateImprovedMessage(
  options: GenerateImprovedMessageOptions
): Promise<GenerateImprovedMessageResult> {
  const { tenantId, originalText, goal } = options;

  const client = getOpenAIClient();
  if (!client) {
    return { text: originalText };
  }

  try {
    const persona = await getActivePersonaForTenant(tenantId);
    const snippets = await getKnowledgeSnippetsForTenant(tenantId, 3);

    const goalDescriptions: Record<string, string> = {
      higher_reply_rate: 'increase the likelihood of getting a reply from the recipient',
      more_compliant: 'make it more compliant with SMS marketing best practices',
      shorter: 'make it shorter and more concise while keeping the core message',
      friendlier: 'make it warmer and more friendly in tone',
    };

    const goalDescription = goal ? goalDescriptions[goal] || 'improve clarity and effectiveness' : 'improve clarity and effectiveness';

    const systemMessage = `${persona.systemPrompt}

You are helping craft an outbound SMS for a home-services brand.

RULES:
- Keep messages concise and under 320 characters when possible.
- Do not make unrealistic promises, especially about savings or guarantees.
- Mention opt-out instructions only if the original text already includes them; do NOT invent legal boilerplate.
- Preserve the core meaning and any personalization variables like {{firstName}}.
- Output ONLY the final SMS text, nothing else.`;

    let brandContext = '';
    if (snippets.length > 0) {
      brandContext = '\n\nBrand context:\n' + snippets.map(s => `- ${s.title}: ${s.topic}`).join('\n');
    }

    const userMessage = `Here is a draft SMS we plan to send. Rewrite it to ${goalDescription} while preserving the core meaning. Output only the final SMS text, nothing else.

Draft:
${originalText}${brandContext}`;

    const response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    const improvedText = response.choices[0]?.message?.content?.trim();

    if (!improvedText) {
      console.warn(`[AI] Empty response for tenant ${tenantId}, returning original`);
      return { text: originalText };
    }

    return { text: improvedText };
  } catch (error: any) {
    console.error(`[AI] generateImprovedMessage error for tenant ${tenantId}:`, error.message);
    return { text: originalText };
  }
}

export interface SuggestRepliesOptions {
  tenantId: string;
  personaId?: string;
  contactId: string;
  conversationId: string;
  lastUserMessage: string;
}

export interface SuggestedReply {
  text: string;
}

export async function suggestRepliesForInboundMessage(
  options: SuggestRepliesOptions
): Promise<SuggestedReply[]> {
  const { tenantId, personaId, conversationId, lastUserMessage } = options;

  const client = getOpenAIClient();
  if (!client) {
    return getFallbackSuggestions(lastUserMessage);
  }

  try {
    let persona: AiPersona;
    if (personaId) {
      const found = await prisma.aiPersona.findFirst({
        where: { id: personaId, tenantId },
      });
      persona = found ? {
        id: found.id,
        name: found.name,
        systemPrompt: found.systemPrompt,
        description: found.description,
        canAutoReply: found.canAutoReply,
      } : await getActivePersonaForTenant(tenantId);
    } else {
      persona = await getActivePersonaForTenant(tenantId);
    }

    const recentMessages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 10,
      select: {
        direction: true,
        body: true,
      },
    });

    const transcript = recentMessages
      .map(m => `${m.direction === 'INBOUND' ? 'Customer' : 'Agent'}: ${m.body}`)
      .join('\n');

    const snippets = await getKnowledgeSnippetsForTenant(tenantId, 3);

    let knowledgeContext = '';
    if (snippets.length > 0) {
      knowledgeContext = '\n\nContext - The brand offers these services and information:\n' +
        snippets.map(s => `- ${s.title}: ${s.content.substring(0, 150)}...`).join('\n');
    }

    const systemMessage = `You are the SMS assistant for a home-services brand. You are continuing a text conversation with a homeowner.

RULES:
- Stay friendly, concise, and focused on moving them toward either a booked appointment, a clear next step, or a positive closure.
- Never promise specific dollar savings or legal/financial guarantees.
- Keep responses under 320 characters.
- Be helpful and professional.

${persona.systemPrompt}${knowledgeContext}`;

    const userMessage = `Here is the recent conversation transcript and the last customer message. Propose 2-3 possible SMS replies as a JSON array of strings, most likely to move the conversation forward in a helpful way.

Transcript:
${transcript}

Last customer message: "${lastUserMessage}"

Respond with ONLY a JSON array of 2-3 suggested reply strings, like: ["reply 1", "reply 2", "reply 3"]`;

    const response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 500,
      temperature: 0.8,
    });

    const content = response.choices[0]?.message?.content?.trim();

    if (!content) {
      console.warn(`[AI] Empty response for suggestions, tenant ${tenantId}`);
      return getFallbackSuggestions(lastUserMessage);
    }

    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          return parsed.slice(0, 3).map(text => ({ text: String(text).trim() }));
        }
      }
    } catch (parseError) {
      console.warn(`[AI] Failed to parse suggestions JSON:`, content);
    }

    return getFallbackSuggestions(lastUserMessage);
  } catch (error: any) {
    console.error(`[AI] suggestRepliesForInboundMessage error for tenant ${tenantId}:`, error.message);
    return getFallbackSuggestions(lastUserMessage);
  }
}

function getFallbackSuggestions(lastUserMessage: string): SuggestedReply[] {
  return [
    { text: `Thanks for your message! We'll get back to you shortly.` },
    { text: `Hi! I received your message about "${lastUserMessage.substring(0, 30)}..." - let me look into that for you.` },
    { text: `Thank you for reaching out! Is there a specific time that works best to discuss this further?` },
  ];
}
