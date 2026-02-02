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

  // Token management - refresh before expiration (tokens last 15 min, refresh at 12 min)
  const TOKEN_REFRESH_INTERVAL_MS = 8 * 60 * 1000; // 8 minutes (well before 15-minute expiration)
  let currentToken = await getServiceTitanToken(config);
  let tokenObtainedAt = Date.now();
  
  if (!currentToken) {
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

  // Helper function to get current valid token, refreshing if needed
  const getValidToken = async (): Promise<string | null> => {
    const tokenAge = Date.now() - tokenObtainedAt;
    if (tokenAge > TOKEN_REFRESH_INTERVAL_MS) {
      console.log(`[ServiceTitan Import] Token age ${Math.round(tokenAge / 1000)}s, refreshing...`);
      const newToken = await getServiceTitanToken(config);
      if (newToken) {
        currentToken = newToken;
        tokenObtainedAt = Date.now();
        console.log(`[ServiceTitan Import] Token refreshed successfully`);
      } else {
        console.error(`[ServiceTitan Import] Failed to refresh token`);
        return null;
      }
    }
    return currentToken;
  };

  // Helper to get current headers with valid token
  const getHeaders = async () => {
    const token = await getValidToken();
    if (!token) return null;
    return {
      'Authorization': `Bearer ${token}`,
      'ST-App-Key': config.appKey,
      'Content-Type': 'application/json',
    };
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
    currentToken
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
  let hasMore = true;
  let apiError = false;

  // Try different endpoints in order of preference
  const pageSize = 50;
  let page = 1;
  
  while (hasMore) {
    try {
      // Get fresh headers (will refresh token if needed)
      let currentHeaders = await getHeaders();
      if (!currentHeaders) {
        console.error(`[ServiceTitan Import] Failed to get valid token`);
        apiError = true;
        break;
      }

      // Use transactional /locations endpoint with pagination
      // Contacts are nested under each location
      const locationsUrl = `${config.tenantApiBaseUrl}/crm/v2/tenant/${config.serviceTitanTenantId}/locations?page=${page}&pageSize=${pageSize}&active=true`;
      console.log(`[ServiceTitan Import] Fetching locations page ${page}...`);
      
      const response = await fetch(locationsUrl, { headers: currentHeaders });
      
      if (!response.ok) {
        // If 401, force token refresh and retry the same page
        if (response.status === 401) {
          console.log(`[ServiceTitan Import] Got 401, forcing token refresh and retrying page ${page}...`);
          tokenObtainedAt = 0; // Force refresh on next getHeaders() call
          continue; // Retry this page with fresh token
        }
        
        const errorText = await response.text();
        console.error(`[ServiceTitan Import] API error: ${response.status} - ${errorText}`);
        apiError = true;
        break;
      }

      const data = await response.json() as { 
        data?: STLocationImport[];
        hasMore?: boolean;
        page?: number;
        totalCount?: number;
      };

      const locations = data.data || [];
      totalFetched += locations.length;
      
      console.log(`[ServiceTitan Import] Page ${page}: ${locations.length} locations (hasMore: ${data.hasMore})`);
      
      // Debug: Log raw object structure from first page
      if (page === 1 && locations.length > 0) {
        console.log(`[ServiceTitan Import] DEBUG - Raw first location keys:`, Object.keys(locations[0]));
        console.log(`[ServiceTitan Import] DEBUG - Raw first location:`, JSON.stringify(locations[0], null, 2));
        // Also check if there's a contacts array
        console.log(`[ServiceTitan Import] DEBUG - First location contacts:`, locations[0].contacts);
      }

      // For each location, we need to fetch its contacts separately
      for (const location of locations) {
        try {
          // Skip locations marked as Do Not Service or Do Not Mail
          if (location.doNotService || location.doNotMail) {
            skippedDoNotContact++;
            continue;
          }

          // Fetch contacts for this location (use same headers which were refreshed at page start)
          const locationContactsUrl = `${config.tenantApiBaseUrl}/crm/v2/tenant/${config.serviceTitanTenantId}/locations/${location.id}/contacts`;
          let contactsResponse = await fetch(locationContactsUrl, { headers: currentHeaders });
          
          // Retry on 401 with fresh token
          if (contactsResponse.status === 401) {
            console.log(`[ServiceTitan Import] Got 401 on contacts fetch, refreshing token...`);
            tokenObtainedAt = 0;
            const freshHeaders = await getHeaders();
            if (freshHeaders) {
              currentHeaders = freshHeaders;
              contactsResponse = await fetch(locationContactsUrl, { headers: currentHeaders });
            }
          }
          
          if (!contactsResponse.ok) {
            // If we can't fetch contacts, skip this location
            if (page === 1 && location === locations[0]) {
              console.log(`[ServiceTitan Import] DEBUG - Cannot fetch location contacts: ${contactsResponse.status}`);
            }
            skippedNoPhone++;
            continue;
          }

          const contactsData = await contactsResponse.json() as {
            data?: Array<{
              id?: number;
              active?: boolean;
              type?: string;
              value?: string;
              memo?: string;
              phoneSettings?: { phoneNumber?: string; doNotText?: boolean };
            }>;
          };

          // Debug first location's contacts
          if (page === 1 && location === locations[0]) {
            console.log(`[ServiceTitan Import] DEBUG - Location contacts response:`, JSON.stringify(contactsData, null, 2));
          }

          const locationContacts = contactsData.data || [];
          
          // Extract phone from contacts
          let primaryPhone: string | undefined;
          let contactEmail: string | undefined;
          
          for (const contact of locationContacts) {
            // Check phoneSettings first
            if (contact.phoneSettings?.phoneNumber) {
              primaryPhone = contact.phoneSettings.phoneNumber;
              break;
            } else if (contact.value) {
              const contactType = (contact.type || '').toLowerCase();
              if (contactType.includes('phone') || contactType.includes('mobile') || contactType.includes('cell')) {
                primaryPhone = contact.value;
                break;
              } else if (contactType.includes('email') && !contactEmail) {
                contactEmail = contact.value;
              } else {
                // Check if value looks like a phone number
                const digits = contact.value.replace(/\D/g, '');
                if (digits.length >= 10 && !primaryPhone) {
                  primaryPhone = contact.value;
                } else if (contact.value.includes('@') && !contactEmail) {
                  contactEmail = contact.value;
                }
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

          // Use location name
          const nameParts = location.name?.split(' ') || ['Unknown'];
          const firstName = nameParts[0] || 'Unknown';
          const lastName = nameParts.slice(1).join(' ') || '';
          const locationZip = location.address?.zip?.trim();

          const newContact = await prisma.contact.create({
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
              contactId: newContact.id,
              tagId: stTag!.id,
            },
          });

          // Add ZIP code tag for geo-targeting
          if (locationZip && locationZip.length >= 5) {
            const zipCode = locationZip.substring(0, 5);
            if (/^\d{5}$/.test(zipCode)) {
              const zipTagId = await getOrCreateTag(tenantId, `ZIP-${zipCode}`, '#48BB78', tagCache);
              await prisma.contactTag.upsert({
                where: { contactId_tagId: { contactId: newContact.id, tagId: zipTagId } },
                create: { contactId: newContact.id, tagId: zipTagId },
                update: {},
              });
            }
          }

          imported++;
          
          // Log progress every 100 contacts (with nested API calls, this is slower)
          if (imported % 100 === 0) {
            console.log(`[ServiceTitan Import] Progress: ${imported} contacts imported...`);
          }

        } catch (err: any) {
          if (!err.message?.includes('Unique constraint')) {
            console.error(`[ServiceTitan Import] Error importing location ${location.id}:`, err);
            errors++;
          } else {
            skippedDuplicates++;
          }
        }
      }

      // Use page-based pagination
      if (data.hasMore) {
        hasMore = true;
        page++;
      } else {
        hasMore = locations.length === pageSize;
        page++;
      }

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
