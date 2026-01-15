import { prisma } from '../index';

async function processSequenceSteps() {
  const now = new Date();
  
  const dueSteps = await prisma.sequenceEnrollmentStep.findMany({
    where: {
      sentAt: null,
      skipped: false,
      scheduledAt: { lte: now },
      enrollment: {
        status: 'ACTIVE',
      },
    },
    include: {
      enrollment: {
        include: {
          sequence: true,
        },
      },
      step: true,
    },
    take: 100,
  });
  
  for (const enrollmentStep of dueSteps) {
    try {
      const contact = await prisma.contact.findUnique({
        where: { id: enrollmentStep.enrollment.contactId },
      });
      
      if (!contact) {
        await prisma.sequenceEnrollmentStep.update({
          where: { id: enrollmentStep.id },
          data: { skipped: true, skipReason: 'Contact not found' },
        });
        continue;
      }
      
      const suppressed = await prisma.suppression.findFirst({
        where: {
          tenantId: enrollmentStep.enrollment.sequence.tenantId,
          phone: contact.phone,
        },
      });
      
      if (suppressed) {
        await prisma.sequenceEnrollmentStep.update({
          where: { id: enrollmentStep.id },
          data: { skipped: true, skipReason: 'Contact is suppressed' },
        });
        continue;
      }
      
      const settings = await prisma.tenantSettings.findUnique({
        where: { tenantId: enrollmentStep.enrollment.sequence.tenantId },
        include: { defaultFromNumber: true },
      });
      
      const fromNumber = settings?.defaultFromNumber?.phoneNumber;
      
      if (!fromNumber) {
        await prisma.sequenceEnrollmentStep.update({
          where: { id: enrollmentStep.id },
          data: { skipped: true, skipReason: 'No from number configured' },
        });
        continue;
      }
      
      let body = enrollmentStep.step.bodyTemplate;
      body = body.replace(/\{\{firstName\}\}/g, contact.firstName || '');
      body = body.replace(/\{\{lastName\}\}/g, contact.lastName || '');
      body = body.replace(/\{\{phone\}\}/g, contact.phone || '');
      
      await prisma.outboundMessageQueue.create({
        data: {
          tenantId: enrollmentStep.enrollment.sequence.tenantId,
          contactId: contact.id,
          phone: contact.phone,
          body: body + '\n\nReply STOP to unsubscribe',
          mediaUrl: enrollmentStep.step.mediaUrl,
          fromNumber,
          sequenceEnrollmentStepId: enrollmentStep.id,
          status: 'PENDING',
        },
      });
      
    } catch (error) {
      console.error(`Error processing sequence step ${enrollmentStep.id}:`, error);
    }
  }
}

let intervalId: NodeJS.Timeout | null = null;

export function startSequenceProcessor() {
  if (intervalId) return;
  
  console.log('Sequence processor started');
  intervalId = setInterval(processSequenceSteps, 30000);
  
  processSequenceSteps();
}

export function stopSequenceProcessor() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('Sequence processor stopped');
  }
}
