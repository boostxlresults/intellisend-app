/**
 * phoneValidator.ts
 * 
 * HLR (Home Location Register) phone number validation using Twilio Lookup API.
 * 
 * Validates phone numbers BEFORE they enter campaigns to prevent:
 * 1. Sending to landlines (generates hard bounces, damages Twilio sender reputation)
 * 2. Sending to disconnected/invalid numbers (wastes credits, hurts deliverability)
 * 3. Carrier spam filter triggers from high bounce rates
 * 
 * IMPORTANT: This uses Twilio Lookup v2 which costs ~$0.005 per lookup.
 * To control costs, validation is cached on the Contact record and only re-run
 * if the number has never been validated or hasn't been checked in 90 days.
 * 
 * Phone types:
 * - 'mobile'    → Valid for SMS, allow
 * - 'voip'      → Usually valid for SMS (Google Voice, etc.), allow with warning
 * - 'landline'  → Cannot receive SMS, block
 * - 'unknown'   → Cannot determine, allow but log
 * - null        → Lookup failed, allow (fail open to avoid blocking valid numbers)
 */

import twilio from 'twilio';
import { prisma } from '../index';

export type PhoneLineType = 'mobile' | 'voip' | 'landline' | 'unknown' | null;

export interface PhoneValidationResult {
  phone: string;
  isValid: boolean;
  lineType: PhoneLineType;
  callerName?: string;
  countryCode?: string;
  error?: string;
  cached?: boolean;
}

// Cache validation results on the Contact record for 90 days
const REVALIDATION_DAYS = 90;

/**
 * Validate a single phone number using Twilio Lookup API.
 * Returns cached result if available and not stale.
 */
export async function validatePhoneNumber(
  tenantId: string,
  phone: string,
  contactId?: string
): Promise<PhoneValidationResult> {
  // Check if we have a cached result on the contact
  if (contactId) {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: {
        phoneLineType: true,
        phoneValidatedAt: true,
      } as any,
    });

    if (contact) {
      const c = contact as any;
      if (c.phoneValidatedAt) {
        const daysSinceValidation = (Date.now() - new Date(c.phoneValidatedAt).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceValidation < REVALIDATION_DAYS) {
          const lineType = c.phoneLineType as PhoneLineType;
          return {
            phone,
            isValid: lineType !== 'landline',
            lineType,
            cached: true,
          };
        }
      }
    }
  }

  // Get Twilio credentials for this tenant
  const integration = await prisma.tenantIntegration.findUnique({
    where: { tenantId },
    select: { twilioAccountSid: true, twilioAuthToken: true, twilioConfigured: true },
  });

  if (!integration?.twilioConfigured || !integration.twilioAccountSid || !integration.twilioAuthToken) {
    // No Twilio configured — fail open (allow the number through)
    console.warn(`[PhoneValidator] No Twilio config for tenant ${tenantId}, skipping HLR for ${phone}`);
    return { phone, isValid: true, lineType: null, error: 'No Twilio config' };
  }

  try {
    const client = twilio(integration.twilioAccountSid, integration.twilioAuthToken);
    
    const lookup = await client.lookups.v2
      .phoneNumbers(phone)
      .fetch({ fields: 'line_type_intelligence' });

    const lineTypeIntelligence = (lookup as any).lineTypeIntelligence;
    const rawType = lineTypeIntelligence?.type?.toLowerCase() || 'unknown';
    
    // Normalize Twilio line type to our enum
    let lineType: PhoneLineType = 'unknown';
    if (rawType.includes('mobile') || rawType === 'mobile') {
      lineType = 'mobile';
    } else if (rawType.includes('landline') || rawType === 'landline') {
      lineType = 'landline';
    } else if (rawType.includes('voip') || rawType === 'voip') {
      lineType = 'voip';
    }

    const isValid = lineType !== 'landline';

    // Cache the result on the contact record
    if (contactId) {
      await prisma.contact.update({
        where: { id: contactId },
        data: {
          phoneLineType: lineType,
          phoneValidatedAt: new Date(),
        } as any,
      });
    }

    console.log(`[PhoneValidator] ${phone} → ${lineType} (${isValid ? 'valid' : 'BLOCKED'})`);
    return { phone, isValid, lineType, countryCode: lookup.countryCode };

  } catch (err: any) {
    // Fail open — if Twilio Lookup fails (network error, invalid number format), allow the send
    console.error(`[PhoneValidator] Lookup failed for ${phone}: ${err.message}`);
    return { phone, isValid: true, lineType: null, error: err.message };
  }
}

/**
 * Batch validate an array of phone numbers.
 * Returns a map of phone → validation result.
 * Rate-limited to avoid Twilio API throttling.
 */
export async function batchValidatePhones(
  tenantId: string,
  phones: Array<{ phone: string; contactId?: string }>,
  options: { maxConcurrent?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<Map<string, PhoneValidationResult>> {
  const { maxConcurrent = 5, onProgress } = options;
  const results = new Map<string, PhoneValidationResult>();
  
  // Process in batches to avoid rate limiting
  for (let i = 0; i < phones.length; i += maxConcurrent) {
    const batch = phones.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(
      batch.map(({ phone, contactId }) => validatePhoneNumber(tenantId, phone, contactId))
    );
    batchResults.forEach(result => results.set(result.phone, result));
    
    if (onProgress) {
      onProgress(Math.min(i + maxConcurrent, phones.length), phones.length);
    }
    
    // Small delay between batches to be respectful of Twilio rate limits
    if (i + maxConcurrent < phones.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  return results;
}

/**
 * Filter a list of contacts/phones to only include SMS-capable numbers.
 * Landlines are tagged in the database and excluded from the returned list.
 * Used by campaignScheduler before queuing messages.
 */
export async function filterSmsCapableContacts(
  tenantId: string,
  contacts: Array<{ id: string; phone: string }>
): Promise<{
  valid: Array<{ id: string; phone: string }>;
  landlines: Array<{ id: string; phone: string }>;
  skipped: number;
}> {
  const valid: Array<{ id: string; phone: string }> = [];
  const landlines: Array<{ id: string; phone: string }> = [];

  // Check cached validation status first (no API call needed)
  const contactIds = contacts.map(c => c.id);
  const cachedContacts = await prisma.contact.findMany({
    where: { id: { in: contactIds } },
    select: {
      id: true,
      phone: true,
      phoneLineType: true,
      phoneValidatedAt: true,
    } as any,
  });

  const staleOrUnvalidated: Array<{ id: string; phone: string }> = [];
  const cutoff = new Date(Date.now() - REVALIDATION_DAYS * 24 * 60 * 60 * 1000);

  for (const c of cachedContacts as any[]) {
    if (c.phoneLineType === 'landline') {
      landlines.push({ id: c.id, phone: c.phone });
    } else if (c.phoneValidatedAt && new Date(c.phoneValidatedAt) > cutoff) {
      // Recently validated and not a landline — allow
      valid.push({ id: c.id, phone: c.phone });
    } else {
      // Never validated or stale — needs fresh lookup
      staleOrUnvalidated.push({ id: c.id, phone: c.phone });
    }
  }

  // Validate stale/unvalidated numbers
  if (staleOrUnvalidated.length > 0) {
    console.log(`[PhoneValidator] Validating ${staleOrUnvalidated.length} unvalidated/stale numbers...`);
    const validationResults = await batchValidatePhones(
      tenantId,
      staleOrUnvalidated.map(c => ({ phone: c.phone, contactId: c.id }))
    );

    for (const contact of staleOrUnvalidated) {
      const result = validationResults.get(contact.phone);
      if (result?.lineType === 'landline') {
        landlines.push(contact);
        // Tag the contact as a landline in the database
        await tagContactAsLandline(tenantId, contact.id).catch(err =>
          console.error(`[PhoneValidator] Failed to tag landline ${contact.phone}:`, err)
        );
      } else {
        valid.push(contact);
      }
    }
  }

  console.log(`[PhoneValidator] Filter complete: ${valid.length} valid, ${landlines.length} landlines blocked`);
  return { valid, landlines, skipped: landlines.length };
}

/**
 * Tag a contact as a landline so they are excluded from future campaigns.
 */
async function tagContactAsLandline(tenantId: string, contactId: string): Promise<void> {
  let landlineTag = await prisma.tag.findFirst({
    where: { tenantId, name: 'Landline' },
  });
  if (!landlineTag) {
    landlineTag = await prisma.tag.create({
      data: { tenantId, name: 'Landline', color: '#e53e3e' },
    });
  }
  await prisma.contactTag.upsert({
    where: { contactId_tagId: { contactId, tagId: landlineTag.id } },
    create: { contactId, tagId: landlineTag.id },
    update: {},
  });
}
