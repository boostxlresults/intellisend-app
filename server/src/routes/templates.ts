import express from 'express';
import { prisma } from '../index';

const router = express.Router();

const SYSTEM_TEMPLATES = [
  {
    name: 'Appointment Reminder - 24hr',
    category: 'APPOINTMENT_REMINDER',
    bodyTemplate: "Hi {{firstName}}, this is a reminder about your appointment tomorrow at {{appointmentTime}}. Reply CONFIRM to confirm or call us to reschedule.",
    variables: JSON.stringify(['firstName', 'appointmentTime']),
  },
  {
    name: 'Appointment Reminder - 1hr',
    category: 'APPOINTMENT_REMINDER',
    bodyTemplate: "Hi {{firstName}}, just a heads up - we'll be there in about an hour for your {{serviceType}} appointment. See you soon!",
    variables: JSON.stringify(['firstName', 'serviceType']),
  },
  {
    name: 'Review Request',
    category: 'REVIEW_REQUEST',
    bodyTemplate: "Hi {{firstName}}, thank you for choosing {{companyName}}! We'd love your feedback. Please leave us a quick review: {{reviewLink}}",
    variables: JSON.stringify(['firstName', 'companyName', 'reviewLink']),
  },
  {
    name: 'Seasonal HVAC Tune-Up',
    category: 'SEASONAL_PROMO',
    bodyTemplate: "{{firstName}}, it's that time of year! Schedule your seasonal HVAC tune-up and save {{discount}}%. Book now: {{bookingLink}}",
    variables: JSON.stringify(['firstName', 'discount', 'bookingLink']),
  },
  {
    name: 'Winter Prep Special',
    category: 'SEASONAL_PROMO',
    bodyTemplate: "Get your home winter-ready! {{companyName}} is offering {{discount}}% off heating system inspections. Limited time offer. Reply YES to book.",
    variables: JSON.stringify(['companyName', 'discount']),
  },
  {
    name: 'Re-Engagement - 30 Days',
    category: 'RE_ENGAGEMENT',
    bodyTemplate: "Hi {{firstName}}, we miss you! It's been a while since your last service. Book now and get {{discount}}% off your next visit.",
    variables: JSON.stringify(['firstName', 'discount']),
  },
  {
    name: 'Re-Engagement - 90 Days',
    category: 'RE_ENGAGEMENT',
    bodyTemplate: "{{firstName}}, it's been 3 months! Time for a check-up? We're offering a special deal just for you. Reply for details.",
    variables: JSON.stringify(['firstName']),
  },
  {
    name: 'Welcome New Customer',
    category: 'WELCOME',
    bodyTemplate: "Welcome to {{companyName}}, {{firstName}}! We're excited to serve you. Save this number - text us anytime with questions.",
    variables: JSON.stringify(['companyName', 'firstName']),
  },
  {
    name: 'Service Confirmation',
    category: 'CONFIRMATION',
    bodyTemplate: '{{firstName}}, your {{serviceType}} is confirmed for {{appointmentDate}} at {{appointmentTime}}. Our tech {{techName}} will be there.',
    variables: JSON.stringify(['firstName', 'serviceType', 'appointmentDate', 'appointmentTime', 'techName']),
  },
  {
    name: 'Follow-Up After Service',
    category: 'FOLLOW_UP',
    bodyTemplate: 'Hi {{firstName}}, thanks for choosing us today! How was your experience? Reply with any questions or concerns.',
    variables: JSON.stringify(['firstName']),
  },
  {
    name: 'Invoice Reminder',
    category: 'FOLLOW_UP',
    bodyTemplate: 'Hi {{firstName}}, just a friendly reminder about your invoice of ${{amount}}. Pay online: {{paymentLink}} or reply with questions.',
    variables: JSON.stringify(['firstName', 'amount', 'paymentLink']),
  },
];

router.get('/templates', async (req, res) => {
  try {
    const templates = await prisma.messageTemplate.findMany({
      where: { isSystemTemplate: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    
    res.json(templates);
  } catch (error: any) {
    console.error('Error fetching system templates:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/templates/seed', async (req, res) => {
  try {
    const existing = await prisma.messageTemplate.count({
      where: { isSystemTemplate: true },
    });
    
    if (existing > 0) {
      return res.json({ message: 'System templates already exist', count: existing });
    }
    
    await prisma.messageTemplate.createMany({
      data: SYSTEM_TEMPLATES.map(t => ({
        ...t,
        isSystemTemplate: true,
        category: t.category as any,
      })),
    });
    
    res.status(201).json({ message: 'System templates created', count: SYSTEM_TEMPLATES.length });
  } catch (error: any) {
    console.error('Error seeding templates:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:tenantId/templates', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { category } = req.query;
    
    const where: any = {
      OR: [
        { tenantId },
        { isSystemTemplate: true },
      ],
    };
    
    if (category) {
      where.category = category;
    }
    
    const templates = await prisma.messageTemplate.findMany({
      where,
      orderBy: [{ isSystemTemplate: 'desc' }, { category: 'asc' }, { name: 'asc' }],
    });
    
    res.json(templates);
  } catch (error: any) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:tenantId/templates', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { name, category, bodyTemplate, mediaUrl, variables } = req.body;
    
    if (!name || !bodyTemplate) {
      return res.status(400).json({ error: 'name and bodyTemplate are required' });
    }
    
    const template = await prisma.messageTemplate.create({
      data: {
        tenantId,
        name,
        category: category || 'CUSTOM',
        bodyTemplate,
        mediaUrl,
        variables: variables ? JSON.stringify(variables) : null,
        isSystemTemplate: false,
      },
    });
    
    res.status(201).json(template);
  } catch (error: any) {
    console.error('Error creating template:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:tenantId/templates/:templateId', async (req, res) => {
  try {
    const { tenantId, templateId } = req.params;
    const { name, category, bodyTemplate, mediaUrl, variables } = req.body;
    
    const existing = await prisma.messageTemplate.findFirst({
      where: { id: templateId, tenantId },
    });
    
    if (!existing) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    if (existing.isSystemTemplate) {
      return res.status(403).json({ error: 'Cannot edit system templates' });
    }
    
    const template = await prisma.messageTemplate.update({
      where: { id: templateId },
      data: {
        name,
        category,
        bodyTemplate,
        mediaUrl,
        variables: variables ? JSON.stringify(variables) : undefined,
      },
    });
    
    res.json(template);
  } catch (error: any) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:tenantId/templates/:templateId', async (req, res) => {
  try {
    const { tenantId, templateId } = req.params;
    
    const existing = await prisma.messageTemplate.findFirst({
      where: { id: templateId, tenantId },
    });
    
    if (!existing) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    if (existing.isSystemTemplate) {
      return res.status(403).json({ error: 'Cannot delete system templates' });
    }
    
    await prisma.messageTemplate.delete({
      where: { id: templateId },
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
