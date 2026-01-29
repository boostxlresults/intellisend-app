import { prisma } from '../index';
import { searchServiceTitanCustomer, searchByAddress, searchByName } from './aiAgent/serviceTitanSearch';
import { getServiceTitanToken } from './serviceTitanClient';

const SERVICE_TITAN_TAG_NAME = 'In ServiceTitan';

interface SyncResult {
  success: boolean;
  totalContacts: number;
  matchedContacts: number;
  newlyTagged: number;
  errors: number;
  matchedByPhone?: number;
  matchedByAddress?: number;
  matchedByName?: number;
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
      email: true,
      firstName: true,
      lastName: true,
      address: true,
      city: true,
      state: true,
      zip: true,
      tags: {
        select: { tagId: true },
      },
    },
  });

  console.log(`[ServiceTitan Sync] Found ${contacts.length} contacts to check`);

  let matchedContacts = 0;
  let newlyTagged = 0;
  let errors = 0;
  let matchedByPhone = 0;
  let matchedByAddress = 0;
  let matchedByName = 0;

  for (const contact of contacts) {
    try {
      const alreadyTagged = contact.tags.some(t => t.tagId === stTag!.id);
      
      if (alreadyTagged) {
        matchedContacts++;
        continue;
      }

      let found = false;
      let matchType = '';

      // 1. Try phone match first (most reliable)
      if (contact.phone) {
        const phoneResult = await searchServiceTitanCustomer(tenantId, contact.phone);
        if (phoneResult.found && phoneResult.customers.length > 0) {
          found = true;
          matchType = 'phone';
          matchedByPhone++;
        }
      }

      // 2. Try address match if phone didn't match
      if (!found && contact.address) {
        const fullAddress = [contact.address, contact.city, contact.state, contact.zip]
          .filter(Boolean).join(', ');
        if (fullAddress.length > 5) {
          const addressResult = await searchByAddress(tenantId, fullAddress);
          if (addressResult.found && addressResult.locations.length > 0) {
            found = true;
            matchType = 'address';
            matchedByAddress++;
          }
        }
      }

      // 3. Try name match as last resort
      if (!found && contact.firstName && contact.lastName) {
        const fullName = `${contact.firstName} ${contact.lastName}`;
        const nameResult = await searchByName(tenantId, fullName);
        if (nameResult.found && nameResult.customers.length > 0) {
          found = true;
          matchType = 'name';
          matchedByName++;
        }
      }
      
      if (found) {
        matchedContacts++;
        
        try {
          await prisma.contactTag.create({
            data: {
              contactId: contact.id,
              tagId: stTag!.id,
            },
          });
          newlyTagged++;
          console.log(`[ServiceTitan Sync] Tagged contact ${contact.firstName} ${contact.lastName} (matched by ${matchType})`);
        } catch (tagError: any) {
          if (!tagError.message?.includes('Unique constraint')) {
            throw tagError;
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`[ServiceTitan Sync] Error checking contact ${contact.id}:`, error);
      errors++;
    }
  }

  console.log(`[ServiceTitan Sync] Completed: ${matchedContacts} matched (phone: ${matchedByPhone}, address: ${matchedByAddress}, name: ${matchedByName}), ${newlyTagged} newly tagged, ${errors} errors`);

  return {
    success: true,
    totalContacts: contacts.length,
    matchedContacts,
    newlyTagged,
    errors,
    matchedByPhone,
    matchedByAddress,
    matchedByName,
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
      email: true,
      firstName: true,
      lastName: true,
      address: true,
      city: true,
      state: true,
      zip: true,
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
    let found = false;

    // 1. Try phone match first (most reliable)
    if (contact.phone) {
      const phoneResult = await searchServiceTitanCustomer(tenantId, contact.phone);
      if (phoneResult.found && phoneResult.customers.length > 0) {
        found = true;
      }
    }

    // 2. Try address match if phone didn't match
    if (!found && contact.address) {
      const fullAddress = [contact.address, contact.city, contact.state, contact.zip]
        .filter(Boolean).join(', ');
      if (fullAddress.length > 5) {
        const addressResult = await searchByAddress(tenantId, fullAddress);
        if (addressResult.found && addressResult.locations.length > 0) {
          found = true;
        }
      }
    }

    // 3. Try name match as last resort
    if (!found && contact.firstName && contact.lastName) {
      const fullName = `${contact.firstName} ${contact.lastName}`;
      const nameResult = await searchByName(tenantId, fullName);
      if (nameResult.found && nameResult.customers.length > 0) {
        found = true;
      }
    }
    
    if (found) {
      try {
        await prisma.contactTag.create({
          data: {
            contactId: contact.id,
            tagId: stTag!.id,
          },
        });
        return true;
      } catch (tagError: any) {
        if (!tagError.message?.includes('Unique constraint')) {
          throw tagError;
        }
        return true;
      }
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

interface STCustomerImport {
  id: number;
  name: string;
  type?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  phoneSettings?: Array<{ phoneNumber: string; type: string }>;
  email?: string;
}

interface ImportResult {
  success: boolean;
  totalFetched: number;
  imported: number;
  skippedDuplicates: number;
  errors: number;
}

export async function importServiceTitanContacts(tenantId: string): Promise<ImportResult> {
  console.log(`[ServiceTitan Import] Starting contact import for tenant ${tenantId}`);
  
  const config = await prisma.serviceTitanConfig.findUnique({
    where: { tenantId },
  });

  if (!config || !config.enabled) {
    console.log(`[ServiceTitan Import] No ServiceTitan config or not enabled for tenant ${tenantId}`);
    return {
      success: false,
      totalFetched: 0,
      imported: 0,
      skippedDuplicates: 0,
      errors: 0,
    };
  }

  const token = await getServiceTitanToken(config);
  if (!token) {
    console.error(`[ServiceTitan Import] Failed to get auth token`);
    return {
      success: false,
      totalFetched: 0,
      imported: 0,
      skippedDuplicates: 0,
      errors: 0,
    };
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'ST-App-Key': config.appKey,
    'Content-Type': 'application/json',
  };

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

  const existingPhones = new Set(
    (await prisma.contact.findMany({
      where: { tenantId },
      select: { phone: true },
    })).map(c => normalizePhoneForComparison(c.phone))
  );

  let totalFetched = 0;
  let imported = 0;
  let skippedDuplicates = 0;
  let errors = 0;
  let page = 1;
  const pageSize = 50;
  let hasMore = true;
  let apiError = false;

  while (hasMore) {
    try {
      const customersUrl = `${config.tenantApiBaseUrl}/crm/v2/tenant/${config.serviceTitanTenantId}/customers?page=${page}&pageSize=${pageSize}&active=true`;
      console.log(`[ServiceTitan Import] Fetching page ${page}...`);
      
      const response = await fetch(customersUrl, { headers });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ServiceTitan Import] API error on page ${page}: ${response.status} - ${errorText}`);
        apiError = true;
        break;
      }

      const data = await response.json() as { 
        data?: STCustomerImport[];
        hasMore?: boolean;
        page?: number;
        totalCount?: number;
      };

      const customers = data.data || [];
      totalFetched += customers.length;
      
      console.log(`[ServiceTitan Import] Page ${page}: ${customers.length} customers (hasMore: ${data.hasMore})`);

      for (const customer of customers) {
        try {
          const primaryPhone = customer.phoneSettings?.[0]?.phoneNumber;
          if (!primaryPhone) {
            continue;
          }

          const normalizedPhone = normalizePhoneForComparison(primaryPhone);
          if (existingPhones.has(normalizedPhone)) {
            skippedDuplicates++;
            continue;
          }

          const nameParts = customer.name?.split(' ') || ['Unknown'];
          const firstName = nameParts[0] || 'Unknown';
          const lastName = nameParts.slice(1).join(' ') || '';

          const contact = await prisma.contact.create({
            data: {
              tenantId,
              firstName,
              lastName: lastName || null,
              phone: formatPhoneForDisplay(primaryPhone),
              email: customer.email || null,
              address: customer.address?.street || null,
              city: customer.address?.city || null,
              state: customer.address?.state || null,
              zip: customer.address?.zip || null,
              source: 'ServiceTitan Import',
            },
          });

          await prisma.contactTag.create({
            data: {
              contactId: contact.id,
              tagId: stTag!.id,
            },
          });

          existingPhones.add(normalizedPhone);
          imported++;

        } catch (err: any) {
          if (!err.message?.includes('Unique constraint')) {
            console.error(`[ServiceTitan Import] Error importing customer ${customer.id}:`, err);
            errors++;
          } else {
            skippedDuplicates++;
          }
        }
      }

      // Use API's hasMore field if available, otherwise fallback to page size check
      if (data.hasMore !== undefined) {
        hasMore = data.hasMore;
      } else {
        hasMore = customers.length === pageSize;
      }
      page++;

      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (error) {
      console.error(`[ServiceTitan Import] Error on page ${page}:`, error);
      apiError = true;
      break;
    }
  }

  console.log(`[ServiceTitan Import] Completed: ${totalFetched} fetched, ${imported} imported, ${skippedDuplicates} skipped, ${errors} errors`);

  return {
    success: !apiError,
    totalFetched,
    imported,
    skippedDuplicates,
    errors,
  };
}

function normalizePhoneForComparison(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
}

function formatPhoneForDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  return phone;
}
