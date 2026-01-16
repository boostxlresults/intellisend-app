import express from 'express';
import { prisma } from '../index';

const router = express.Router();

const SYSTEM_TEMPLATES = [
  // ============================================
  // HVAC Templates
  // ============================================
  {
    name: 'HVAC - Neighborhood Special',
    category: 'HVAC',
    bodyTemplate: "Hey! This is {{agentName}} from {{companyName}}. We're finishing a job in your area and wanted to offer you a tune-up for only ${{price}}. Reply YES for details!",
    variables: JSON.stringify(['agentName', 'companyName', 'price']),
  },
  {
    name: 'HVAC - Seasonal Tune-Up',
    category: 'HVAC',
    bodyTemplate: "Hi {{firstName}}! {{companyName}} here. Time for your {{season}} HVAC tune-up! Keep your system running efficiently. Reply YES to schedule.",
    variables: JSON.stringify(['firstName', 'companyName', 'season']),
  },
  {
    name: 'HVAC - Filter Reminder',
    category: 'HVAC',
    bodyTemplate: "{{firstName}}, it's been 90 days since we serviced your HVAC. Time to change your filter! Need help? Reply YES and we'll take care of it.",
    variables: JSON.stringify(['firstName']),
  },
  {
    name: 'HVAC - Emergency Check',
    category: 'HVAC',
    bodyTemplate: "Hi {{firstName}}! With {{weather}} temps coming, is your AC/heat ready? {{companyName}} offers 24/7 emergency service. Reply to schedule a checkup!",
    variables: JSON.stringify(['firstName', 'weather', 'companyName']),
  },
  {
    name: 'HVAC - Membership Offer',
    category: 'HVAC',
    bodyTemplate: "{{firstName}}, join our maintenance club! 2 tune-ups/year, priority service, and {{discount}}% off repairs. Only ${{price}}/mo. Reply for info!",
    variables: JSON.stringify(['firstName', 'discount', 'price']),
  },

  // ============================================
  // Plumbing Templates
  // ============================================
  {
    name: 'Plumbing - Water Heater Check',
    category: 'PLUMBING',
    bodyTemplate: "Hi {{firstName}}! When's the last time you had your water heater checked? {{companyName}} offers free inspections this month. Reply YES to book!",
    variables: JSON.stringify(['firstName', 'companyName']),
  },
  {
    name: 'Plumbing - Drain Cleaning Special',
    category: 'PLUMBING',
    bodyTemplate: "{{firstName}}, slow drains? {{companyName}} drain cleaning special: ${{price}}! Clear any drain in your home. Reply YES to schedule.",
    variables: JSON.stringify(['firstName', 'companyName', 'price']),
  },
  {
    name: 'Plumbing - Leak Detection',
    category: 'PLUMBING',
    bodyTemplate: "Hey {{firstName}}! Did you know a small leak can waste 10,000 gallons/year? {{companyName}} offers free leak inspections. Text YES to schedule!",
    variables: JSON.stringify(['firstName', 'companyName']),
  },
  {
    name: 'Plumbing - Winter Prep',
    category: 'PLUMBING',
    bodyTemplate: "{{firstName}}, freezing temps are coming! Protect your pipes with our winterization service for ${{price}}. Reply YES to schedule. - {{companyName}}",
    variables: JSON.stringify(['firstName', 'price', 'companyName']),
  },
  {
    name: 'Plumbing - Emergency Service',
    category: 'PLUMBING',
    bodyTemplate: "Hi {{firstName}}! {{companyName}} here. Just a reminder - we offer 24/7 emergency plumbing. Save this number! Any issues? Reply anytime.",
    variables: JSON.stringify(['firstName', 'companyName']),
  },

  // ============================================
  // Electrical Templates
  // ============================================
  {
    name: 'Electrical - Safety Inspection',
    category: 'ELECTRICAL',
    bodyTemplate: "{{firstName}}, is your home's electrical system up to code? {{companyName}} offers safety inspections for ${{price}}. Reply YES to book!",
    variables: JSON.stringify(['firstName', 'companyName', 'price']),
  },
  {
    name: 'Electrical - Panel Upgrade',
    category: 'ELECTRICAL',
    bodyTemplate: "Hi {{firstName}}! Older electrical panel? Upgrade for safety and add capacity for modern appliances. {{companyName}} - Reply for a free quote!",
    variables: JSON.stringify(['firstName', 'companyName']),
  },
  {
    name: 'Electrical - Generator Special',
    category: 'ELECTRICAL',
    bodyTemplate: "{{firstName}}, never lose power again! {{companyName}} generator installations starting at ${{price}}. Storm season is here. Reply YES for info!",
    variables: JSON.stringify(['firstName', 'companyName', 'price']),
  },
  {
    name: 'Electrical - Smart Home',
    category: 'ELECTRICAL',
    bodyTemplate: "Hey {{firstName}}! Ready to upgrade to a smart home? {{companyName}} installs smart switches, outlets & more. Reply YES for a free estimate!",
    variables: JSON.stringify(['firstName', 'companyName']),
  },
  {
    name: 'Electrical - EV Charger',
    category: 'ELECTRICAL',
    bodyTemplate: "{{firstName}}, got an EV or thinking about one? {{companyName}} installs home chargers! Level 2 charging from ${{price}}. Reply for details!",
    variables: JSON.stringify(['firstName', 'companyName', 'price']),
  },

  // ============================================
  // Solar Templates
  // ============================================
  {
    name: 'Solar - Free Savings Analysis',
    category: 'SOLAR',
    bodyTemplate: "Hi {{firstName}}! Curious how much you could save with solar? {{companyName}} offers free savings analyses. Reply YES and we'll run your numbers!",
    variables: JSON.stringify(['firstName', 'companyName']),
  },
  {
    name: 'Solar - Tax Credit Reminder',
    category: 'SOLAR',
    bodyTemplate: "{{firstName}}, the 30% federal solar tax credit won't last forever! Lock in your savings with {{companyName}}. Reply YES for a free quote!",
    variables: JSON.stringify(['firstName', 'companyName']),
  },
  {
    name: 'Solar - Panel Cleaning',
    category: 'SOLAR',
    bodyTemplate: "Hey {{firstName}}! Dirty panels = less power. {{companyName}} panel cleaning for ${{price}} keeps your system at peak efficiency. Reply YES to book!",
    variables: JSON.stringify(['firstName', 'companyName', 'price']),
  },
  {
    name: 'Solar - Battery Backup',
    category: 'SOLAR',
    bodyTemplate: "{{firstName}}, add battery backup to your solar! Keep the lights on during outages. {{companyName}} installs all major brands. Reply for info!",
    variables: JSON.stringify(['firstName', 'companyName']),
  },
  {
    name: 'Solar - Referral Bonus',
    category: 'SOLAR',
    bodyTemplate: "{{firstName}}, love your solar? Refer a friend and get ${{amount}}! They save, you earn. Just reply with their name and number. - {{companyName}}",
    variables: JSON.stringify(['firstName', 'amount', 'companyName']),
  },

  // ============================================
  // Roofing Templates
  // ============================================
  {
    name: 'Roofing - Storm Damage Check',
    category: 'ROOFING',
    bodyTemplate: "Hi {{firstName}}! After recent storms, {{companyName}} is offering free roof inspections in your area. Reply YES to schedule yours!",
    variables: JSON.stringify(['firstName', 'companyName']),
  },
  {
    name: 'Roofing - Gutter Cleaning',
    category: 'ROOFING',
    bodyTemplate: "{{firstName}}, clogged gutters cause roof damage! {{companyName}} gutter cleaning for ${{price}}. Protect your home. Reply YES to schedule!",
    variables: JSON.stringify(['firstName', 'companyName', 'price']),
  },
  {
    name: 'Roofing - Free Inspection',
    category: 'ROOFING',
    bodyTemplate: "Hey {{firstName}}! When's the last time you had your roof inspected? {{companyName}} offers free inspections. Reply YES to book yours!",
    variables: JSON.stringify(['firstName', 'companyName']),
  },
  {
    name: 'Roofing - Financing Available',
    category: 'ROOFING',
    bodyTemplate: "{{firstName}}, need a new roof? {{companyName}} offers 0% financing for {{months}} months! Get a free estimate - reply YES to get started!",
    variables: JSON.stringify(['firstName', 'companyName', 'months']),
  },
  {
    name: 'Roofing - Insurance Claims Help',
    category: 'ROOFING',
    bodyTemplate: "Hi {{firstName}}! Storm damage? {{companyName}} works directly with insurance companies. Free inspection + claim assistance. Reply YES for help!",
    variables: JSON.stringify(['firstName', 'companyName']),
  },

  // ============================================
  // Landscaping Templates
  // ============================================
  {
    name: 'Landscaping - Spring Cleanup',
    category: 'LANDSCAPING',
    bodyTemplate: "{{firstName}}, spring is here! {{companyName}} offers yard cleanups starting at ${{price}}. Mulch, pruning, and more! Reply YES to schedule!",
    variables: JSON.stringify(['firstName', 'companyName', 'price']),
  },
  {
    name: 'Landscaping - Lawn Care Plan',
    category: 'LANDSCAPING',
    bodyTemplate: "Hi {{firstName}}! Want a lush, green lawn? {{companyName}} seasonal lawn plans from ${{price}}/mo. Reply YES for a free yard assessment!",
    variables: JSON.stringify(['firstName', 'companyName', 'price']),
  },
  {
    name: 'Landscaping - Irrigation Check',
    category: 'LANDSCAPING',
    bodyTemplate: "{{firstName}}, is your sprinkler system ready for summer? {{companyName}} irrigation tune-ups for ${{price}}. Reply YES to schedule!",
    variables: JSON.stringify(['firstName', 'companyName', 'price']),
  },
  {
    name: 'Landscaping - Fall Leaf Removal',
    category: 'LANDSCAPING',
    bodyTemplate: "Hey {{firstName}}! Leaves piling up? {{companyName}} leaf removal starting at ${{price}}. Protect your lawn this fall. Reply YES to book!",
    variables: JSON.stringify(['firstName', 'companyName', 'price']),
  },
  {
    name: 'Landscaping - Holiday Lights',
    category: 'LANDSCAPING',
    bodyTemplate: "{{firstName}}, skip the ladder! {{companyName}} installs holiday lights. Professional setup + takedown for ${{price}}. Reply YES for details!",
    variables: JSON.stringify(['firstName', 'companyName', 'price']),
  },

  // ============================================
  // Pest Control Templates
  // ============================================
  {
    name: 'Pest Control - Quarterly Treatment',
    category: 'PEST_CONTROL',
    bodyTemplate: "Hi {{firstName}}! Time for your quarterly pest treatment. {{companyName}} keeps bugs out year-round. Reply YES to schedule your visit!",
    variables: JSON.stringify(['firstName', 'companyName']),
  },
  {
    name: 'Pest Control - New Neighbor Special',
    category: 'PEST_CONTROL',
    bodyTemplate: "{{firstName}}, welcome to the neighborhood! {{companyName}} offers first-time customers {{discount}}% off. Keep pests out! Reply YES for details.",
    variables: JSON.stringify(['firstName', 'companyName', 'discount']),
  },
  {
    name: 'Pest Control - Termite Inspection',
    category: 'PEST_CONTROL',
    bodyTemplate: "Hey {{firstName}}! Termites cause $5B in damage annually. {{companyName}} offers free termite inspections. Protect your home - reply YES!",
    variables: JSON.stringify(['firstName', 'companyName']),
  },
  {
    name: 'Pest Control - Mosquito Season',
    category: 'PEST_CONTROL',
    bodyTemplate: "{{firstName}}, mosquito season is here! {{companyName}} yard treatments starting at ${{price}}. Enjoy your backyard again. Reply YES to book!",
    variables: JSON.stringify(['firstName', 'companyName', 'price']),
  },
  {
    name: 'Pest Control - Rodent Prevention',
    category: 'PEST_CONTROL',
    bodyTemplate: "Hi {{firstName}}! As temps drop, rodents look for shelter. {{companyName}} rodent prevention from ${{price}}. Don't wait - reply YES to schedule!",
    variables: JSON.stringify(['firstName', 'companyName', 'price']),
  },

  // ============================================
  // Public Service Announcements
  // ============================================
  {
    name: 'PSA - Freeze Warning',
    category: 'PSA',
    bodyTemplate: "{{firstName}}, freeze warning tonight! Drip faucets, open cabinet doors, and disconnect hoses. Questions? Reply anytime. - {{companyName}}",
    variables: JSON.stringify(['firstName', 'companyName']),
  },
  {
    name: 'PSA - Storm Prep Tips',
    category: 'PSA',
    bodyTemplate: "{{firstName}}, storms forecasted! Secure outdoor items, check gutters, and know your shutoff valves. Stay safe! - {{companyName}}",
    variables: JSON.stringify(['firstName', 'companyName']),
  },
  {
    name: 'PSA - Change Your Filters',
    category: 'PSA',
    bodyTemplate: "Pro tip: Change HVAC filters every 90 days for better air quality and lower bills! Need help? Reply YES. - {{companyName}}",
    variables: JSON.stringify(['companyName']),
  },
  {
    name: 'PSA - Test Smoke Detectors',
    category: 'PSA',
    bodyTemplate: "Safety reminder: Test smoke & CO detectors monthly, replace batteries twice yearly. Stay safe, {{firstName}}! - {{companyName}}",
    variables: JSON.stringify(['firstName', 'companyName']),
  },
  {
    name: 'PSA - Water Heater Life',
    category: 'PSA',
    bodyTemplate: "Did you know? Water heaters last 8-12 years. If yours is older, it may be time for an upgrade. Questions? Reply anytime! - {{companyName}}",
    variables: JSON.stringify(['companyName']),
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
