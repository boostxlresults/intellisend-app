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
  doNotService?: boolean;
  doNotMail?: boolean;
  tagTypeIds?: number[];
}

// ServiceTitan Location interface - locations have contacts with phone numbers
interface STLocationImport {
  id: number;
  customerId: number;
  name: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  contacts?: Array<{
    id?: number;
    type?: string;
    value?: string;
    memo?: string;
    phoneNumber?: string; // Some versions use this
  }>;
  doNotService?: boolean;
  doNotMail?: boolean;
  taxExempt?: boolean;
}

// Helper to get or create a tag by name for a tenant (with optional cache for bulk operations)
async function getOrCreateTag(
  tenantId: string, 
  tagName: string, 
  color?: string,
  cache?: Map<string, string>
): Promise<string> {
  // Check cache first for performance during bulk imports
  const cacheKey = `${tenantId}:${tagName}`;
  if (cache?.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }
  
  let tag = await prisma.tag.findFirst({
    where: { tenantId, name: tagName },
  });
  
  if (!tag) {
    tag = await prisma.tag.create({
      data: {
        tenantId,
        name: tagName,
        color: color || '#718096',
      },
    });
  }
  
  // Store in cache
  if (cache) {
    cache.set(cacheKey, tag.id);
  }
  
  return tag.id;
}

// Fetch ServiceTitan tag types mapping (ID -> name)
async function fetchServiceTitanTagTypes(
  config: { tenantApiBaseUrl: string; serviceTitanTenantId: string; appKey: string },
  token: string
): Promise<Map<number, string>> {
  const tagTypesMap = new Map<number, string>();
  
  try {
    const url = `${config.tenantApiBaseUrl}/settings/v2/tenant/${config.serviceTitanTenantId}/tag-types?pageSize=200`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'ST-App-Key': config.appKey,
      },
    });
    
    if (response.ok) {
      const data = await response.json() as { data?: Array<{ id: number; name: string }> };
      if (data.data) {
        for (const tag of data.data) {
          tagTypesMap.set(tag.id, tag.name);
        }
        console.log(`[ServiceTitan Import] Fetched ${tagTypesMap.size} tag types`);
      }
    } else {
      console.warn(`[ServiceTitan Import] Could not fetch tag types: ${response.status}`);
    }
  } catch (error) {
    console.warn('[ServiceTitan Import] Error fetching tag types:', error);
  }
  
  return tagTypesMap;
}

interface ImportResult {
  success: boolean;
  totalFetched: number;
  imported: number;
  skippedDuplicates: number;
  skippedDoNotContact: number;
  skippedNoPhone: number;
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
      skippedDoNotContact: 0,
      skippedNoPhone: 0,
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
      skippedDoNotContact: 0,
      skippedNoPhone: 0,
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

  // Fetch ServiceTitan tag types for syncing customer tags
  const stTagTypes = await fetchServiceTitanTagTypes(
    { tenantApiBaseUrl: config.tenantApiBaseUrl, serviceTitanTenantId: config.serviceTitanTenantId, appKey: config.appKey },
    token
  );

  const existingContacts = await prisma.contact.findMany({
    where: { tenantId },
    select: { phone: true },
  });
  
  const existingPhones = new Set(
    existingContacts.map(c => normalizePhoneForComparison(c.phone))
  );
  
  console.log(`[ServiceTitan Import] Found ${existingContacts.length} existing contacts in IntelliSend`);
  console.log(`[ServiceTitan Import] Unique normalized phones in existing set: ${existingPhones.size}`);

  // Cache for tag lookups to improve performance during bulk import
  const tagCache = new Map<string, string>();

  let totalFetched = 0;
  let imported = 0;
  let skippedDuplicates = 0;
  let skippedDoNotContact = 0;
  let skippedNoPhone = 0;
  let errors = 0;
  let continueFromToken: string | null = null;
  let hasMore = true;
  let apiError = false;
  let iteration = 0;

  // Use export/location-contacts endpoint which includes phone data
  while (hasMore) {
    iteration++;
    try {
      // Build URL with continuation token for pagination
      let contactsUrl = `${config.tenantApiBaseUrl}/crm/v2/tenant/${config.serviceTitanTenantId}/export/location-contacts`;
      if (continueFromToken) {
        contactsUrl += `?from=${encodeURIComponent(continueFromToken)}`;
      }
      console.log(`[ServiceTitan Import] Fetching location-contacts batch ${iteration}...`);
      
      const response = await fetch(contactsUrl, { headers });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ServiceTitan Import] API error: ${response.status} - ${errorText}`);
        apiError = true;
        break;
      }

      const data = await response.json() as { 
        data?: Array<{
          id?: number;
          locationId?: number;
          customerId?: number;
          active?: boolean;
          name?: string;
          type?: string;
          value?: string;
          memo?: string;
          phoneSettings?: { phoneNumber?: string; doNotText?: boolean };
          modifiedOn?: string;
        }>;
        hasMore?: boolean;
        continueFrom?: string;
      };

      const locationContacts = data.data || [];
      totalFetched += locationContacts.length;
      
      console.log(`[ServiceTitan Import] Batch ${iteration}: ${locationContacts.length} location-contacts (hasMore: ${data.hasMore})`);
      
      // Debug: Log raw object structure from first batch
      if (iteration === 1 && locationContacts.length > 0) {
        console.log(`[ServiceTitan Import] DEBUG - Raw first contact keys:`, Object.keys(locationContacts[0]));
        console.log(`[ServiceTitan Import] DEBUG - Raw first contact:`, JSON.stringify(locationContacts[0], null, 2));
        console.log(`[ServiceTitan Import] DEBUG - Sample contacts:`, 
          locationContacts.slice(0, 5).map(c => ({
            id: c.id,
            type: c.type,
            value: c.value,
            phoneSettings: c.phoneSettings,
          }))
        );
      }

      for (const locationContact of locationContacts) {
        try {
          // Extract phone from the contact record
          let primaryPhone: string | undefined;
          let contactEmail: string | undefined;
          
          // Check phoneSettings first
          if (locationContact.phoneSettings?.phoneNumber) {
            primaryPhone = locationContact.phoneSettings.phoneNumber;
          } else if (locationContact.value) {
            // Check type to determine if it's a phone or email
            const contactType = (locationContact.type || '').toLowerCase();
            if (contactType.includes('phone') || contactType.includes('mobile') || contactType.includes('cell') || contactType.includes('text')) {
              primaryPhone = locationContact.value;
            } else if (contactType.includes('email')) {
              contactEmail = locationContact.value;
            } else {
              // Check if value looks like a phone number (10+ digits)
              const digits = locationContact.value.replace(/\D/g, '');
              if (digits.length >= 10) {
                primaryPhone = locationContact.value;
              } else if (locationContact.value.includes('@')) {
                contactEmail = locationContact.value;
              }
            }
          }
          
          // Only import if we have a phone number
          if (!primaryPhone) {
            skippedNoPhone++;
            continue;
          }

          const normalizedPhone = normalizePhoneForComparison(primaryPhone);
          if (existingPhones.has(normalizedPhone)) {
            skippedDuplicates++;
            continue;
          }
          
          // Add to set immediately to prevent duplicates within this import batch
          existingPhones.add(normalizedPhone);

          // Use contact name or generate from phone
          const contactName = locationContact.name || `Customer ${primaryPhone.slice(-4)}`;
          const nameParts = contactName.split(' ');
          const firstName = nameParts[0] || 'Unknown';
          const lastName = nameParts.slice(1).join(' ') || '';

          const contact = await prisma.contact.create({
            data: {
              tenantId,
              firstName,
              lastName: lastName || '',
              phone: formatPhoneForDisplay(primaryPhone),
              email: contactEmail || null,
              leadSource: 'ServiceTitan Import',
            },
          });

          // Add "In ServiceTitan" tag
          await prisma.contactTag.create({
            data: {
              contactId: contact.id,
              tagId: stTag!.id,
            },
          });

          // Note: ZIP codes and ServiceTitan tags require fetching location/customer separately
          // For now, we skip those during location-contacts import

          imported++;
          
          // Log progress every 1000 contacts
          if (imported % 1000 === 0) {
            console.log(`[ServiceTitan Import] Progress: ${imported} contacts imported...`);
          }

        } catch (err: any) {
          if (!err.message?.includes('Unique constraint')) {
            console.error(`[ServiceTitan Import] Error importing contact ${locationContact.id}:`, err);
            errors++;
          } else {
            skippedDuplicates++;
          }
        }
      }

      // Use continuation token for pagination
      if (data.hasMore && data.continueFrom) {
        hasMore = true;
        continueFromToken = data.continueFrom;
      } else {
        hasMore = false;
      }

      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (error) {
      console.error(`[ServiceTitan Import] Error on batch ${iteration}:`, error);
      apiError = true;
      break;
    }
  }

  console.log(`[ServiceTitan Import] Completed: ${totalFetched} fetched, ${imported} imported, ${skippedDuplicates} duplicates, ${skippedDoNotContact} do-not-contact, ${skippedNoPhone} no-phone, ${errors} errors`);

  return {
    success: !apiError,
    totalFetched,
    imported,
    skippedDuplicates,
    skippedDoNotContact,
    skippedNoPhone,
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
