import { prisma } from '../index';
import { searchServiceTitanCustomer } from './aiAgent/serviceTitanSearch';

const SERVICE_TITAN_TAG_NAME = 'In ServiceTitan';

interface SyncResult {
  success: boolean;
  totalContacts: number;
  matchedContacts: number;
  newlyTagged: number;
  errors: number;
}

export async function syncServiceTitanContacts(tenantId: string): Promise<SyncResult> {
  console.log(`[ServiceTitan Sync] Starting contact sync for tenant ${tenantId}`);
  
  const config = await prisma.serviceTitanConfig.findUnique({
    where: { tenantId },
  });

  if (!config || !config.enabled) {
    console.log(`[ServiceTitan Sync] No ServiceTitan config or not enabled for tenant ${tenantId}`);
    return {
      success: false,
      totalContacts: 0,
      matchedContacts: 0,
      newlyTagged: 0,
      errors: 0,
    };
  }

  let stTag = await prisma.tag.findUnique({
    where: { tenantId_name: { tenantId, name: SERVICE_TITAN_TAG_NAME } },
  });

  if (!stTag) {
    stTag = await prisma.tag.create({
      data: {
        tenantId,
        name: SERVICE_TITAN_TAG_NAME,
        color: '#10B981',
      },
    });
    console.log(`[ServiceTitan Sync] Created tag "${SERVICE_TITAN_TAG_NAME}" for tenant ${tenantId}`);
  }

  const contacts = await prisma.contact.findMany({
    where: { tenantId },
    select: {
      id: true,
      phone: true,
      firstName: true,
      lastName: true,
      tags: {
        select: { tagId: true },
      },
    },
  });

  console.log(`[ServiceTitan Sync] Found ${contacts.length} contacts to check`);

  let matchedContacts = 0;
  let newlyTagged = 0;
  let errors = 0;

  for (const contact of contacts) {
    try {
      const alreadyTagged = contact.tags.some(t => t.tagId === stTag!.id);
      
      if (alreadyTagged) {
        matchedContacts++;
        continue;
      }

      const searchResult = await searchServiceTitanCustomer(tenantId, contact.phone);
      
      if (searchResult.found && searchResult.customers.length > 0) {
        matchedContacts++;
        
        await prisma.contactTag.create({
          data: {
            contactId: contact.id,
            tagId: stTag!.id,
          },
        });
        newlyTagged++;
        
        console.log(`[ServiceTitan Sync] Tagged contact ${contact.firstName} ${contact.lastName} (${contact.phone})`);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`[ServiceTitan Sync] Error checking contact ${contact.id}:`, error);
      errors++;
    }
  }

  console.log(`[ServiceTitan Sync] Completed: ${matchedContacts} matched, ${newlyTagged} newly tagged, ${errors} errors`);

  return {
    success: true,
    totalContacts: contacts.length,
    matchedContacts,
    newlyTagged,
    errors,
  };
}

export async function syncSingleContact(tenantId: string, contactId: string): Promise<boolean> {
  const config = await prisma.serviceTitanConfig.findUnique({
    where: { tenantId },
  });

  if (!config || !config.enabled) {
    return false;
  }

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      id: true,
      phone: true,
      tags: { select: { tagId: true } },
    },
  });

  if (!contact) {
    return false;
  }

  let stTag = await prisma.tag.findUnique({
    where: { tenantId_name: { tenantId, name: SERVICE_TITAN_TAG_NAME } },
  });

  if (!stTag) {
    stTag = await prisma.tag.create({
      data: {
        tenantId,
        name: SERVICE_TITAN_TAG_NAME,
        color: '#10B981',
      },
    });
  }

  const alreadyTagged = contact.tags.some(t => t.tagId === stTag!.id);
  if (alreadyTagged) {
    return true;
  }

  try {
    const searchResult = await searchServiceTitanCustomer(tenantId, contact.phone);
    
    if (searchResult.found && searchResult.customers.length > 0) {
      await prisma.contactTag.create({
        data: {
          contactId: contact.id,
          tagId: stTag!.id,
        },
      });
      return true;
    }
  } catch (error) {
    console.error(`[ServiceTitan Sync] Error syncing contact ${contactId}:`, error);
  }

  return false;
}

export async function getServiceTitanTagId(tenantId: string): Promise<string | null> {
  const tag = await prisma.tag.findUnique({
    where: { tenantId_name: { tenantId, name: SERVICE_TITAN_TAG_NAME } },
  });
  return tag?.id || null;
}
