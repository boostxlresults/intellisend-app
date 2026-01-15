import express from 'express';
import { prisma } from '../index';

const router = express.Router();

const PLANS = {
  FREE: { name: 'Free', monthlyLimit: 500, price: 0 },
  STARTER: { name: 'Starter', monthlyLimit: 2500, price: 4900 },
  PROFESSIONAL: { name: 'Professional', monthlyLimit: 10000, price: 14900 },
  ENTERPRISE: { name: 'Enterprise', monthlyLimit: 50000, price: 49900 },
};

router.get('/:tenantId/billing', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    let plan = await prisma.tenantPlan.findUnique({
      where: { tenantId },
    });
    
    if (!plan) {
      plan = await prisma.tenantPlan.create({
        data: {
          tenantId,
          planType: 'FREE',
          monthlyMessageLimit: 500,
          monthlyCost: 0,
        },
      });
    }
    
    const now = new Date();
    const periodStart = plan.currentPeriodStart || new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = plan.currentPeriodEnd || new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    
    const usage = await prisma.usageRecord.findFirst({
      where: {
        tenantId,
        periodStart: { gte: new Date(now.getFullYear(), now.getMonth(), 1) },
      },
    });
    
    res.json({
      plan: {
        ...plan,
        planDetails: PLANS[plan.planType as keyof typeof PLANS],
      },
      usage: {
        smsCount: usage?.smsCount || 0,
        mmsCount: usage?.mmsCount || 0,
        segmentCount: usage?.segmentCount || 0,
        limit: plan.monthlyMessageLimit,
        periodStart,
        periodEnd,
      },
      availablePlans: Object.entries(PLANS).map(([key, value]) => ({
        id: key,
        ...value,
      })),
    });
  } catch (error: any) {
    console.error('Error fetching billing:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/billing/upgrade', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { planType } = req.body;
    
    if (!planType || !PLANS[planType as keyof typeof PLANS]) {
      return res.status(400).json({ error: 'Invalid plan type' });
    }
    
    const planDetails = PLANS[planType as keyof typeof PLANS];
    
    const plan = await prisma.tenantPlan.upsert({
      where: { tenantId },
      create: {
        tenantId,
        planType: planType as any,
        monthlyMessageLimit: planDetails.monthlyLimit,
        monthlyCost: planDetails.price,
      },
      update: {
        planType: planType as any,
        monthlyMessageLimit: planDetails.monthlyLimit,
        monthlyCost: planDetails.price,
      },
    });
    
    res.json({
      success: true,
      plan,
      message: planDetails.price > 0 
        ? 'Stripe integration required for paid plans' 
        : 'Plan updated',
    });
  } catch (error: any) {
    console.error('Error upgrading plan:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:tenantId/billing/usage-history', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const records = await prisma.usageRecord.findMany({
      where: { tenantId },
      orderBy: { periodStart: 'desc' },
      take: 12,
    });
    
    res.json(records);
  } catch (error: any) {
    console.error('Error fetching usage history:', error);
    res.status(500).json({ error: error.message });
  }
});

export async function recordUsage(
  tenantId: string,
  type: 'sms' | 'mms',
  segments: number = 1
): Promise<{ allowed: boolean; remaining: number }> {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  
  const plan = await prisma.tenantPlan.findUnique({
    where: { tenantId },
  });
  
  const limit = plan?.monthlyMessageLimit || 500;
  
  let usage = await prisma.usageRecord.findFirst({
    where: { tenantId, periodStart },
  });
  
  if (!usage) {
    usage = await prisma.usageRecord.create({
      data: {
        tenantId,
        periodStart,
        periodEnd,
        smsCount: 0,
        mmsCount: 0,
        segmentCount: 0,
      },
    });
  }
  
  const currentTotal = usage.smsCount + usage.mmsCount;
  
  if (currentTotal >= limit) {
    return { allowed: false, remaining: 0 };
  }
  
  await prisma.usageRecord.update({
    where: { id: usage.id },
    data: {
      [type === 'sms' ? 'smsCount' : 'mmsCount']: { increment: 1 },
      segmentCount: { increment: segments },
    },
  });
  
  return { allowed: true, remaining: limit - currentTotal - 1 };
}

export async function checkUsageLimit(tenantId: string): Promise<{ allowed: boolean; remaining: number }> {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  
  const plan = await prisma.tenantPlan.findUnique({
    where: { tenantId },
  });
  
  const limit = plan?.monthlyMessageLimit || 500;
  
  const usage = await prisma.usageRecord.findFirst({
    where: { tenantId, periodStart },
  });
  
  const currentTotal = (usage?.smsCount || 0) + (usage?.mmsCount || 0);
  
  return {
    allowed: currentTotal < limit,
    remaining: Math.max(0, limit - currentTotal),
  };
}

export default router;
