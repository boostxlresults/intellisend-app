import { PrismaClient } from '@prisma/client';
import { normalizePhone } from '../utils/phoneNormalize';

const prisma = new PrismaClient();

async function normalizeExistingPhones() {
  console.log('Starting phone number normalization...');
  
  const contacts = await prisma.contact.findMany({
    select: { id: true, phone: true, tenantId: true },
  });
  
  console.log(`Found ${contacts.length} contacts to check`);
  
  let updated = 0;
  let duplicatesFound = 0;
  const errors: string[] = [];
  
  const tenantPhoneMap = new Map<string, Map<string, string>>();
  
  for (const contact of contacts) {
    const normalized = normalizePhone(contact.phone);
    
    if (!tenantPhoneMap.has(contact.tenantId)) {
      tenantPhoneMap.set(contact.tenantId, new Map());
    }
    const phoneMap = tenantPhoneMap.get(contact.tenantId)!;
    
    if (phoneMap.has(normalized) && phoneMap.get(normalized) !== contact.id) {
      duplicatesFound++;
      console.log(`  DUPLICATE: "${contact.phone}" -> "${normalized}" (contact ${contact.id}) conflicts with contact ${phoneMap.get(normalized)}`);
      continue;
    }
    
    phoneMap.set(normalized, contact.id);
    
    if (contact.phone !== normalized) {
      try {
        await prisma.contact.update({
          where: { id: contact.id },
          data: { phone: normalized },
        });
        updated++;
        if (updated % 100 === 0) {
          console.log(`  Updated ${updated} contacts so far...`);
        }
      } catch (err: any) {
        errors.push(`Failed to update contact ${contact.id} (${contact.phone} -> ${normalized}): ${err.message}`);
      }
    }
  }
  
  console.log(`\nDone!`);
  console.log(`  Checked: ${contacts.length}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Duplicates found: ${duplicatesFound}`);
  if (errors.length > 0) {
    console.log(`  Errors: ${errors.length}`);
    errors.forEach(e => console.log(`    ${e}`));
  }
  
  await prisma.$disconnect();
}

normalizeExistingPhones().catch(console.error);
