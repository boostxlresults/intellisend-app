import { prisma } from '../index';

export async function buildConversationSummary(
  conversationId: string,
  maxMessages: number = 5,
  maxChars: number = 800
): Promise<string> {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: maxMessages,
    include: {
      contact: {
        select: { firstName: true, lastName: true }
      }
    }
  });

  if (messages.length === 0) {
    return 'No messages in conversation.';
  }

  const reversedMessages = messages.reverse();
  
  let summary = 'Recent SMS conversation:\n';
  
  for (const msg of reversedMessages) {
    const speaker = msg.direction === 'INBOUND' 
      ? `Customer (${msg.contact.firstName || 'Unknown'})` 
      : 'Agent';
    const line = `${speaker}: ${msg.body}\n`;
    
    if (summary.length + line.length <= maxChars) {
      summary += line;
    } else {
      const remaining = maxChars - summary.length - 4;
      if (remaining > 20) {
        summary += line.substring(0, remaining) + '...\n';
      }
      break;
    }
  }

  if (summary.length > maxChars) {
    summary = summary.substring(0, maxChars - 3) + '...';
  }

  return summary;
}
