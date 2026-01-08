import { Router } from 'express';
import { prisma } from '../index';

const router = Router();

type DateRange = 'today' | '7d' | '30d' | 'all';

function getDateFilter(range: DateRange): Date | null {
  const now = new Date();
  switch (range) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case 'all':
      return null;
  }
}

router.get('/:tenantId/analytics/summary', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const range = (req.query.range as DateRange) || '30d';
    const dateFilter = getDateFilter(range);

    const dateWhere = dateFilter ? { createdAt: { gte: dateFilter } } : {};

    const [
      totalSent,
      totalDelivered,
      totalFailed,
      totalSuppressed,
      totalOptOuts,
      totalInbound,
      totalOutbound,
    ] = await Promise.all([
      prisma.messageEvent.count({
        where: { tenantId, eventType: 'SENT', ...dateWhere },
      }),
      prisma.messageEvent.count({
        where: { tenantId, eventType: 'DELIVERED', ...dateWhere },
      }),
      prisma.messageEvent.count({
        where: { tenantId, eventType: 'FAILED', ...dateWhere },
      }),
      prisma.messageEvent.count({
        where: { tenantId, eventType: 'SUPPRESSED', ...dateWhere },
      }),
      prisma.suppression.count({
        where: { tenantId, reason: 'STOP', ...dateWhere },
      }),
      prisma.message.count({
        where: { tenantId, direction: 'INBOUND', ...dateWhere },
      }),
      prisma.message.count({
        where: { tenantId, direction: 'OUTBOUND', ...dateWhere },
      }),
    ]);

    const deliveryRate = totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0;
    const optOutRate = totalOutbound > 0 ? ((totalOptOuts / totalOutbound) * 100).toFixed(2) : '0';
    const replyRate = totalOutbound > 0 ? ((totalInbound / totalOutbound) * 100).toFixed(2) : '0';

    res.json({
      totalSent,
      totalDelivered,
      totalFailed,
      totalSuppressed,
      totalOptOuts,
      totalInbound,
      totalOutbound,
      deliveryRate,
      optOutRate: parseFloat(optOutRate),
      replyRate: parseFloat(replyRate),
    });
  } catch (error: any) {
    console.error('Error fetching analytics summary:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:tenantId/analytics/timeline', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const range = (req.query.range as DateRange) || '30d';
    const dateFilter = getDateFilter(range);

    const daysBack = range === 'today' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : 90;

    const timeline: { date: string; sent: number; delivered: number; failed: number; suppressed: number; inbound: number }[] = [];

    for (let i = daysBack - 1; i >= 0; i--) {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      dayStart.setDate(dayStart.getDate() - i);
      
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const [sent, delivered, failed, suppressed, inbound] = await Promise.all([
        prisma.messageEvent.count({
          where: { tenantId, eventType: 'SENT', createdAt: { gte: dayStart, lte: dayEnd } },
        }),
        prisma.messageEvent.count({
          where: { tenantId, eventType: 'DELIVERED', createdAt: { gte: dayStart, lte: dayEnd } },
        }),
        prisma.messageEvent.count({
          where: { tenantId, eventType: 'FAILED', createdAt: { gte: dayStart, lte: dayEnd } },
        }),
        prisma.messageEvent.count({
          where: { tenantId, eventType: 'SUPPRESSED', createdAt: { gte: dayStart, lte: dayEnd } },
        }),
        prisma.message.count({
          where: { tenantId, direction: 'INBOUND', createdAt: { gte: dayStart, lte: dayEnd } },
        }),
      ]);

      timeline.push({
        date: dayStart.toISOString().split('T')[0],
        sent,
        delivered,
        failed,
        suppressed,
        inbound,
      });
    }

    res.json(timeline);
  } catch (error: any) {
    console.error('Error fetching analytics timeline:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:tenantId/analytics/campaigns', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const range = (req.query.range as DateRange) || '30d';
    const dateFilter = getDateFilter(range);

    const dateWhere = dateFilter ? { createdAt: { gte: dateFilter } } : {};

    const campaigns = await prisma.campaign.findMany({
      where: { tenantId, ...dateWhere },
      include: {
        _count: {
          select: { messages: true },
        },
        segment: {
          include: {
            _count: { select: { members: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const campaignStats = await Promise.all(
      campaigns.map(async (campaign) => {
        const [sent, delivered, failed] = await Promise.all([
          prisma.messageEvent.count({
            where: { tenantId, campaignId: campaign.id, eventType: 'SENT' },
          }),
          prisma.messageEvent.count({
            where: { tenantId, campaignId: campaign.id, eventType: 'DELIVERED' },
          }),
          prisma.messageEvent.count({
            where: { tenantId, campaignId: campaign.id, eventType: 'FAILED' },
          }),
        ]);

        return {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          audienceSize: campaign.segment?._count?.members || 0,
          messagesSent: sent,
          messagesDelivered: delivered,
          messagesFailed: failed,
          deliveryRate: sent > 0 ? Math.round((delivered / sent) * 100) : 0,
          createdAt: campaign.createdAt,
        };
      })
    );

    res.json(campaignStats);
  } catch (error: any) {
    console.error('Error fetching campaign analytics:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:tenantId/analytics/opt-outs', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const range = (req.query.range as DateRange) || '30d';
    const dateFilter = getDateFilter(range);

    const dateWhere = dateFilter ? { createdAt: { gte: dateFilter } } : {};

    const optOuts = await prisma.suppression.findMany({
      where: { tenantId, reason: 'STOP', ...dateWhere },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const daysBack = range === 'today' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : 90;
    const optOutTrend: { date: string; count: number }[] = [];

    for (let i = daysBack - 1; i >= 0; i--) {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      dayStart.setDate(dayStart.getDate() - i);
      
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const count = await prisma.suppression.count({
        where: { tenantId, reason: 'STOP', createdAt: { gte: dayStart, lte: dayEnd } },
      });

      optOutTrend.push({
        date: dayStart.toISOString().split('T')[0],
        count,
      });
    }

    res.json({
      recent: optOuts,
      trend: optOutTrend,
      total: optOuts.length,
    });
  } catch (error: any) {
    console.error('Error fetching opt-out analytics:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
