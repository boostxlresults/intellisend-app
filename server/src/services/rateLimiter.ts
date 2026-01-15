import { prisma } from '../index';

interface RateLimitConfig {
  maxMessagesPerDay: number;
  maxMessagesPerWeek: number;
  maxMessagesPerMonth: number;
  minSecondsBetweenMessages: number;
}

const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  maxMessagesPerDay: 3,
  maxMessagesPerWeek: 10,
  maxMessagesPerMonth: 25,
  minSecondsBetweenMessages: 30,
};

interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  nextAllowedAt?: Date;
}

export async function checkRateLimit(
  tenantId: string,
  phone: string,
  config: Partial<RateLimitConfig> = {}
): Promise<RateLimitResult> {
  const limits = { ...DEFAULT_RATE_LIMITS, ...config };
  const now = new Date();
  
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  const recentMessages = await prisma.messageEvent.findMany({
    where: {
      tenantId,
      phone,
      eventType: 'SENT',
      createdAt: { gte: oneMonthAgo },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  
  if (recentMessages.length === 0) {
    return { allowed: true };
  }
  
  const lastMessage = recentMessages[0];
  const secondsSinceLastMessage = (now.getTime() - lastMessage.createdAt.getTime()) / 1000;
  
  if (secondsSinceLastMessage < limits.minSecondsBetweenMessages) {
    const nextAllowedAt = new Date(lastMessage.createdAt.getTime() + limits.minSecondsBetweenMessages * 1000);
    return {
      allowed: false,
      reason: `RATE_LIMIT_TOO_FREQUENT: Minimum ${limits.minSecondsBetweenMessages} seconds between messages`,
      nextAllowedAt,
    };
  }
  
  const messagesInLastDay = recentMessages.filter(m => m.createdAt >= oneDayAgo).length;
  if (messagesInLastDay >= limits.maxMessagesPerDay) {
    const nextAllowedAt = new Date(oneDayAgo.getTime() + 24 * 60 * 60 * 1000);
    return {
      allowed: false,
      reason: `RATE_LIMIT_DAILY: Maximum ${limits.maxMessagesPerDay} messages per day reached`,
      nextAllowedAt,
    };
  }
  
  const messagesInLastWeek = recentMessages.filter(m => m.createdAt >= oneWeekAgo).length;
  if (messagesInLastWeek >= limits.maxMessagesPerWeek) {
    const nextAllowedAt = new Date(oneWeekAgo.getTime() + 7 * 24 * 60 * 60 * 1000);
    return {
      allowed: false,
      reason: `RATE_LIMIT_WEEKLY: Maximum ${limits.maxMessagesPerWeek} messages per week reached`,
      nextAllowedAt,
    };
  }
  
  const messagesInLastMonth = recentMessages.filter(m => m.createdAt >= oneMonthAgo).length;
  if (messagesInLastMonth >= limits.maxMessagesPerMonth) {
    const nextAllowedAt = new Date(oneMonthAgo.getTime() + 30 * 24 * 60 * 60 * 1000);
    return {
      allowed: false,
      reason: `RATE_LIMIT_MONTHLY: Maximum ${limits.maxMessagesPerMonth} messages per month reached`,
      nextAllowedAt,
    };
  }
  
  return { allowed: true };
}

export async function getRateLimitStatus(
  tenantId: string,
  phone: string,
  config: Partial<RateLimitConfig> = {}
): Promise<{
  messagesInLastDay: number;
  messagesInLastWeek: number;
  messagesInLastMonth: number;
  remainingToday: number;
  remainingThisWeek: number;
  remainingThisMonth: number;
  lastMessageAt: Date | null;
}> {
  const limits = { ...DEFAULT_RATE_LIMITS, ...config };
  const now = new Date();
  
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  const recentMessages = await prisma.messageEvent.findMany({
    where: {
      tenantId,
      phone,
      eventType: 'SENT',
      createdAt: { gte: oneMonthAgo },
    },
    orderBy: { createdAt: 'desc' },
  });
  
  const messagesInLastDay = recentMessages.filter(m => m.createdAt >= oneDayAgo).length;
  const messagesInLastWeek = recentMessages.filter(m => m.createdAt >= oneWeekAgo).length;
  const messagesInLastMonth = recentMessages.length;
  
  return {
    messagesInLastDay,
    messagesInLastWeek,
    messagesInLastMonth,
    remainingToday: Math.max(0, limits.maxMessagesPerDay - messagesInLastDay),
    remainingThisWeek: Math.max(0, limits.maxMessagesPerWeek - messagesInLastWeek),
    remainingThisMonth: Math.max(0, limits.maxMessagesPerMonth - messagesInLastMonth),
    lastMessageAt: recentMessages[0]?.createdAt || null,
  };
}

export function getDefaultRateLimits(): RateLimitConfig {
  return { ...DEFAULT_RATE_LIMITS };
}
