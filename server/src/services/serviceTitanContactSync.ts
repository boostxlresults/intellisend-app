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
  // ServiceTitan stores phone numbers in a contacts array
  contacts?: Array<{
    id?: number;
    type?: string | { name?: string; value?: string };
    value?: string;
    memo?: string;
  }>;
  // Legacy fields (may or may not be present)
  phoneNumber?: string;
  phoneSettings?: Array<{ phoneNumber: string; type: string }>;
  email?: string;
  doNotService?: boolean;
  doNotMail?: boolean;
  customerId?: number;
  tagTypeIds?: number[];
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
      
      // Debug: Log raw customer object structure from first page
      if (page === 1 && customers.length > 0) {
        console.log(`[ServiceTitan Import] DEBUG - Raw first customer keys:`, Object.keys(customers[0]));
        console.log(`[ServiceTitan Import] DEBUG - Raw first customer:`, JSON.stringify(customers[0], null, 2));
        console.log(`[ServiceTitan Import] DEBUG - Sample contact arrays:`, 
          customers.slice(0, 3).map(c => ({
            name: c.name,
            contacts: c.contacts,
            phoneNumber: c.phoneNumber,
          }))
        );
      }

      for (const customer of customers) {
        try {
          // Skip customers marked as Do Not Service or Do Not Mail
          if (customer.doNotService || customer.doNotMail) {
            skippedDoNotContact++;
            continue;
          }

          // ServiceTitan stores phone in contacts array - extract phone type contacts
          let primaryPhone: string | undefined;
          
          // First check the contacts array (correct ServiceTitan structure)
          if (customer.contacts && customer.contacts.length > 0) {
            for (const contact of customer.contacts) {
              // Check if this is a phone contact (type can be string or object)
              const contactType = typeof contact.type === 'string' 
                ? contact.type.toLowerCase() 
                : (contact.type?.name || contact.type?.value || '').toLowerCase();
              
              if (contactType.includes('phone') || contactType.includes('mobile') || contactType.includes('cell')) {
                if (contact.value) {
                  primaryPhone = contact.value;
                  break;
                }
              }
            }
            // If no phone type found, check if first contact has a phone-like value (10+ digits)
            if (!primaryPhone && customer.contacts[0]?.value) {
              const val = customer.contacts[0].value.replace(/\D/g, '');
              if (val.length >= 10) {
                primaryPhone = customer.contacts[0].value;
              }
            }
          }
          
          // Fallback to legacy fields
          if (!primaryPhone) {
            primaryPhone = customer.phoneNumber || customer.phoneSettings?.[0]?.phoneNumber;
          }
          
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

          const nameParts = customer.name?.split(' ') || ['Unknown'];
          const firstName = nameParts[0] || 'Unknown';
          const lastName = nameParts.slice(1).join(' ') || '';
          const customerZip = customer.address?.zip?.trim();

          const contact = await prisma.contact.create({
            data: {
              tenantId,
              firstName,
              lastName: lastName || '',
              phone: formatPhoneForDisplay(primaryPhone),
              email: customer.email || null,
              address: customer.address?.street || null,
              city: customer.address?.city || null,
              state: customer.address?.state || null,
              zip: customerZip || null,
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

          // Add ZIP code tag for geo-targeting (e.g., "ZIP-85658")
          if (customerZip && customerZip.length >= 5) {
            const zipCode = customerZip.substring(0, 5); // Get first 5 digits
            if (/^\d{5}$/.test(zipCode)) {
              const zipTagId = await getOrCreateTag(tenantId, `ZIP-${zipCode}`, '#48BB78', tagCache);
              await prisma.contactTag.upsert({
                where: {
                  contactId_tagId: { contactId: contact.id, tagId: zipTagId },
                },
                create: { contactId: contact.id, tagId: zipTagId },
                update: {},
              });
            }
          }

          // Sync ServiceTitan tags (e.g., "ST: VIP Customer", "ST: Commercial")
          if (customer.tagTypeIds && customer.tagTypeIds.length > 0 && stTagTypes.size > 0) {
            for (const tagTypeId of customer.tagTypeIds) {
              const tagName = stTagTypes.get(tagTypeId);
              if (tagName) {
                const stSyncTagId = await getOrCreateTag(tenantId, `ST: ${tagName}`, '#9F7AEA', tagCache);
                await prisma.contactTag.upsert({
                  where: {
                    contactId_tagId: { contactId: contact.id, tagId: stSyncTagId },
                  },
                  create: { contactId: contact.id, tagId: stSyncTagId },
                  update: {},
                });
              }
            }
          }

          imported++;
          
          // Log progress every 1000 contacts
          if (imported % 1000 === 0) {
            console.log(`[ServiceTitan Import] Progress: ${imported} contacts imported...`);
          }

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
