import express from 'express';
import { prisma } from '../index';

const router = express.Router();

router.get('/:tenantId/sequences', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const sequences = await prisma.sequence.findMany({
      where: { tenantId },
      include: {
        steps: { orderBy: { order: 'asc' } },
        _count: { select: { enrollments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    
    res.json(sequences);
  } catch (error: any) {
    console.error('Error fetching sequences:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/sequences', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { name, description, triggerType, triggerConfig, steps } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    
    const sequence = await prisma.sequence.create({
      data: {
        tenantId,
        name,
        description,
        triggerType: triggerType || 'manual',
        triggerConfig: triggerConfig ? JSON.stringify(triggerConfig) : null,
        steps: steps?.length > 0 ? {
          create: steps.map((step: any, index: number) => ({
            order: index + 1,
            delayMinutes: step.delayMinutes || 0,
            delayUnit: step.delayUnit || 'minutes',
            bodyTemplate: step.bodyTemplate,
            useAiAssist: step.useAiAssist || false,
            mediaUrl: step.mediaUrl,
          })),
        } : undefined,
      },
      include: {
        steps: { orderBy: { order: 'asc' } },
      },
    });
    
    res.status(201).json(sequence);
  } catch (error: any) {
    console.error('Error creating sequence:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:tenantId/sequences/:sequenceId', async (req, res) => {
  try {
    const { tenantId, sequenceId } = req.params;
    
    const sequence = await prisma.sequence.findFirst({
      where: { id: sequenceId, tenantId },
      include: {
        steps: { orderBy: { order: 'asc' } },
        enrollments: {
          include: {
            steps: true,
          },
          take: 100,
        },
      },
    });
    
    if (!sequence) {
      return res.status(404).json({ error: 'Sequence not found' });
    }
    
    res.json(sequence);
  } catch (error: any) {
    console.error('Error fetching sequence:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:tenantId/sequences/:sequenceId', async (req, res) => {
  try {
    const { tenantId, sequenceId } = req.params;
    const { name, description, status, triggerType, triggerConfig, steps } = req.body;
    
    const existing = await prisma.sequence.findFirst({
      where: { id: sequenceId, tenantId },
    });
    
    if (!existing) {
      return res.status(404).json({ error: 'Sequence not found' });
    }
    
    if (steps) {
      await prisma.sequenceStep.deleteMany({ where: { sequenceId } });
    }
    
    const sequence = await prisma.sequence.update({
      where: { id: sequenceId },
      data: {
        name,
        description,
        status,
        triggerType,
        triggerConfig: triggerConfig ? JSON.stringify(triggerConfig) : undefined,
        steps: steps?.length > 0 ? {
          create: steps.map((step: any, index: number) => ({
            order: index + 1,
            delayMinutes: step.delayMinutes || 0,
            delayUnit: step.delayUnit || 'minutes',
            bodyTemplate: step.bodyTemplate,
            useAiAssist: step.useAiAssist || false,
            mediaUrl: step.mediaUrl,
          })),
        } : undefined,
      },
      include: {
        steps: { orderBy: { order: 'asc' } },
      },
    });
    
    res.json(sequence);
  } catch (error: any) {
    console.error('Error updating sequence:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:tenantId/sequences/:sequenceId', async (req, res) => {
  try {
    const { tenantId, sequenceId } = req.params;
    
    await prisma.sequence.deleteMany({
      where: { id: sequenceId, tenantId },
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting sequence:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/sequences/:sequenceId/enroll', async (req, res) => {
  try {
    const { tenantId, sequenceId } = req.params;
    const { contactIds } = req.body;
    
    if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({ error: 'contactIds array is required' });
    }
    
    const sequence = await prisma.sequence.findFirst({
      where: { id: sequenceId, tenantId, status: 'ACTIVE' },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    
    if (!sequence) {
      return res.status(404).json({ error: 'Active sequence not found' });
    }
    
    if (sequence.steps.length === 0) {
      return res.status(400).json({ error: 'Sequence has no steps' });
    }
    
    const enrollments = [];
    
    for (const contactId of contactIds) {
      const existing = await prisma.sequenceEnrollment.findFirst({
        where: { sequenceId, contactId },
      });
      
      if (existing) continue;
      
      const enrollment = await prisma.sequenceEnrollment.create({
        data: {
          sequenceId,
          contactId,
          status: 'ACTIVE',
          currentStep: 0,
          steps: {
            create: sequence.steps.map((step, index) => {
              let scheduledAt = new Date();
              if (index > 0) {
                const prevSteps = sequence.steps.slice(0, index);
                const totalDelayMinutes = prevSteps.reduce((acc, s) => {
                  let delay = s.delayMinutes;
                  if (s.delayUnit === 'hours') delay *= 60;
                  if (s.delayUnit === 'days') delay *= 1440;
                  return acc + delay;
                }, 0);
                scheduledAt = new Date(Date.now() + totalDelayMinutes * 60 * 1000);
              }
              return {
                stepId: step.id,
                scheduledAt,
              };
            }),
          },
        },
      });
      
      enrollments.push(enrollment);
    }
    
    res.status(201).json({ enrolled: enrollments.length, skipped: contactIds.length - enrollments.length });
  } catch (error: any) {
    console.error('Error enrolling contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/sequences/:sequenceId/enrollments/:enrollmentId/pause', async (req, res) => {
  try {
    const { tenantId, sequenceId, enrollmentId } = req.params;
    
    const enrollment = await prisma.sequenceEnrollment.findFirst({
      where: { id: enrollmentId, sequenceId },
      include: { sequence: true },
    });
    
    if (!enrollment || enrollment.sequence.tenantId !== tenantId) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }
    
    await prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'PAUSED', pausedAt: new Date() },
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error pausing enrollment:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/sequences/:sequenceId/enrollments/:enrollmentId/resume', async (req, res) => {
  try {
    const { tenantId, sequenceId, enrollmentId } = req.params;
    
    const enrollment = await prisma.sequenceEnrollment.findFirst({
      where: { id: enrollmentId, sequenceId },
      include: { sequence: true },
    });
    
    if (!enrollment || enrollment.sequence.tenantId !== tenantId) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }
    
    await prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'ACTIVE', pausedAt: null },
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error resuming enrollment:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
