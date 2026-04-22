/**
 * contactTimezone.ts
 * 
 * Resolves the IANA timezone for a contact based on their area code or zip code.
 * Used by the quiet hours enforcement engine to check per-contact local time,
 * not just the tenant's configured timezone.
 * 
 * This ensures TCPA compliance for contacts in different time zones from the tenant.
 * E.g., a tenant in Arizona (America/Phoenix) sending to a contact in Florida
 * (America/New_York) must respect Florida's quiet hours, not Arizona's.
 */

// Area code to IANA timezone mapping (US only)
// Covers all 50 states + DC. Source: NANPA area code assignments.
const AREA_CODE_TIMEZONE_MAP: Record<string, string> = {
  // Eastern Time
  '201': 'America/New_York', '202': 'America/New_York', '203': 'America/New_York',
  '207': 'America/New_York', '212': 'America/New_York', '215': 'America/New_York',
  '216': 'America/New_York', '217': 'America/New_York', '219': 'America/New_York',
  '228': 'America/Chicago', '229': 'America/New_York', '231': 'America/New_York',
  '234': 'America/New_York', '239': 'America/New_York', '240': 'America/New_York',
  '248': 'America/New_York', '252': 'America/New_York', '253': 'America/Los_Angeles',
  '267': 'America/New_York', '269': 'America/New_York', '272': 'America/New_York',
  '276': 'America/New_York', '301': 'America/New_York', '302': 'America/New_York',
  '304': 'America/New_York', '305': 'America/New_York', '309': 'America/Chicago',
  '313': 'America/New_York', '315': 'America/New_York', '317': 'America/Indiana/Indianapolis',
  '321': 'America/New_York', '330': 'America/New_York', '331': 'America/Chicago',
  '334': 'America/Chicago', '336': 'America/New_York', '339': 'America/New_York',
  '340': 'America/St_Thomas', '347': 'America/New_York', '351': 'America/New_York',
  '352': 'America/New_York', '380': 'America/New_York', '385': 'America/Denver',
  '386': 'America/New_York', '401': 'America/New_York', '404': 'America/New_York',
  '407': 'America/New_York', '410': 'America/New_York', '412': 'America/New_York',
  '413': 'America/New_York', '414': 'America/Chicago', '419': 'America/New_York',
  '423': 'America/New_York', '424': 'America/Los_Angeles', '425': 'America/Los_Angeles',
  '430': 'America/Chicago', '434': 'America/New_York', '440': 'America/New_York',
  '443': 'America/New_York', '445': 'America/New_York', '447': 'America/Chicago',
  '458': 'America/Los_Angeles', '463': 'America/Indiana/Indianapolis',
  '470': 'America/New_York', '475': 'America/New_York', '478': 'America/New_York',
  '479': 'America/Chicago', '484': 'America/New_York', '501': 'America/Chicago',
  '502': 'America/New_York', '503': 'America/Los_Angeles', '504': 'America/Chicago',
  '505': 'America/Denver', '507': 'America/Chicago', '508': 'America/New_York',
  '509': 'America/Los_Angeles', '510': 'America/Los_Angeles', '512': 'America/Chicago',
  '513': 'America/New_York', '515': 'America/Chicago', '516': 'America/New_York',
  '517': 'America/New_York', '518': 'America/New_York', '520': 'America/Phoenix',
  '530': 'America/Los_Angeles', '531': 'America/Chicago', '534': 'America/Chicago',
  '539': 'America/Chicago', '540': 'America/New_York', '541': 'America/Los_Angeles',
  '551': 'America/New_York', '559': 'America/Los_Angeles', '561': 'America/New_York',
  '562': 'America/Los_Angeles', '563': 'America/Chicago', '564': 'America/Los_Angeles',
  '567': 'America/New_York', '570': 'America/New_York', '571': 'America/New_York',
  '573': 'America/Chicago', '574': 'America/Indiana/Indianapolis', '575': 'America/Denver',
  '580': 'America/Chicago', '585': 'America/New_York', '586': 'America/New_York',
  '601': 'America/Chicago', '602': 'America/Phoenix', '603': 'America/New_York',
  '605': 'America/Chicago', '606': 'America/New_York', '607': 'America/New_York',
  '608': 'America/Chicago', '609': 'America/New_York', '610': 'America/New_York',
  '612': 'America/Chicago', '614': 'America/New_York', '615': 'America/Chicago',
  '616': 'America/New_York', '617': 'America/New_York', '618': 'America/Chicago',
  '619': 'America/Los_Angeles', '620': 'America/Chicago', '623': 'America/Phoenix',
  '626': 'America/Los_Angeles', '628': 'America/Los_Angeles', '629': 'America/Chicago',
  '630': 'America/Chicago', '631': 'America/New_York', '636': 'America/Chicago',
  '641': 'America/Chicago', '646': 'America/New_York', '650': 'America/Los_Angeles',
  '651': 'America/Chicago', '657': 'America/Los_Angeles', '659': 'America/Chicago',
  '660': 'America/Chicago', '661': 'America/Los_Angeles', '662': 'America/Chicago',
  '667': 'America/New_York', '669': 'America/Los_Angeles', '678': 'America/New_York',
  '681': 'America/New_York', '682': 'America/Chicago', '689': 'America/New_York',
  '701': 'America/Chicago', '702': 'America/Los_Angeles', '703': 'America/New_York',
  '704': 'America/New_York', '706': 'America/New_York', '707': 'America/Los_Angeles',
  '708': 'America/Chicago', '712': 'America/Chicago', '713': 'America/Chicago',
  '714': 'America/Los_Angeles', '715': 'America/Chicago', '716': 'America/New_York',
  '717': 'America/New_York', '718': 'America/New_York', '719': 'America/Denver',
  '720': 'America/Denver', '724': 'America/New_York', '725': 'America/Los_Angeles',
  '726': 'America/Chicago', '727': 'America/New_York', '731': 'America/Chicago',
  '732': 'America/New_York', '734': 'America/New_York', '737': 'America/Chicago',
  '740': 'America/New_York', '743': 'America/New_York', '747': 'America/Los_Angeles',
  '754': 'America/New_York', '757': 'America/New_York', '760': 'America/Los_Angeles',
  '762': 'America/New_York', '763': 'America/Chicago', '765': 'America/Indiana/Indianapolis',
  '769': 'America/Chicago', '770': 'America/New_York', '771': 'America/New_York',
  '772': 'America/New_York', '773': 'America/Chicago', '774': 'America/New_York',
  '775': 'America/Los_Angeles', '779': 'America/Chicago', '781': 'America/New_York',
  '785': 'America/Chicago', '786': 'America/New_York', '801': 'America/Denver',
  '802': 'America/New_York', '803': 'America/New_York', '804': 'America/New_York',
  '805': 'America/Los_Angeles', '806': 'America/Chicago', '808': 'Pacific/Honolulu',
  '810': 'America/New_York', '812': 'America/Indiana/Indianapolis', '813': 'America/New_York',
  '814': 'America/New_York', '815': 'America/Chicago', '816': 'America/Chicago',
  '817': 'America/Chicago', '818': 'America/Los_Angeles', '820': 'America/Los_Angeles',
  '828': 'America/New_York', '830': 'America/Chicago', '831': 'America/Los_Angeles',
  '832': 'America/Chicago', '838': 'America/New_York', '843': 'America/New_York',
  '845': 'America/New_York', '847': 'America/Chicago', '848': 'America/New_York',
  '850': 'America/Chicago', '854': 'America/New_York', '856': 'America/New_York',
  '857': 'America/New_York', '858': 'America/Los_Angeles', '859': 'America/New_York',
  '860': 'America/New_York', '862': 'America/New_York', '863': 'America/New_York',
  '864': 'America/New_York', '865': 'America/New_York', '870': 'America/Chicago',
  '872': 'America/Chicago', '878': 'America/New_York', '901': 'America/Chicago',
  '903': 'America/Chicago', '904': 'America/New_York', '906': 'America/New_York',
  '907': 'America/Anchorage', '908': 'America/New_York', '909': 'America/Los_Angeles',
  '910': 'America/New_York', '912': 'America/New_York', '913': 'America/Chicago',
  '914': 'America/New_York', '915': 'America/Denver', '916': 'America/Los_Angeles',
  '917': 'America/New_York', '918': 'America/Chicago', '919': 'America/New_York',
  '920': 'America/Chicago', '925': 'America/Los_Angeles', '928': 'America/Phoenix',
  '929': 'America/New_York', '930': 'America/Indiana/Indianapolis', '931': 'America/Chicago',
  '934': 'America/New_York', '936': 'America/Chicago', '937': 'America/New_York',
  '938': 'America/Chicago', '940': 'America/Chicago', '941': 'America/New_York',
  '945': 'America/Chicago', '947': 'America/New_York', '949': 'America/Los_Angeles',
  '951': 'America/Los_Angeles', '952': 'America/Chicago', '954': 'America/New_York',
  '956': 'America/Chicago', '959': 'America/New_York', '970': 'America/Denver',
  '971': 'America/Los_Angeles', '972': 'America/Chicago', '973': 'America/New_York',
  '975': 'America/Chicago', '978': 'America/New_York', '979': 'America/Chicago',
  '980': 'America/New_York', '984': 'America/New_York', '985': 'America/Chicago',
  '986': 'America/Boise', '989': 'America/New_York',
};

// State-specific quiet hours (stricter than federal TCPA 8AM-9PM)
// Format: [startHour, endHour] in local time (24h). Messages MUST be sent between start and end.
// Federal default: 8:00 AM - 9:00 PM (8, 21)
const STATE_QUIET_HOURS: Record<string, { start: number; end: number; label: string }> = {
  'FL': { start: 8, end: 20, label: 'Florida (8AM-8PM)' },
  'CT': { start: 8, end: 20, label: 'Connecticut (8AM-8PM)' },
  'MD': { start: 8, end: 20, label: 'Maryland (8AM-8PM)' },
  'OK': { start: 8, end: 20, label: 'Oklahoma (8AM-8PM)' },
  'TX': { start: 9, end: 21, label: 'Texas (9AM-9PM)' },
};

// State abbreviation from area code (for state-specific quiet hours)
const AREA_CODE_STATE_MAP: Record<string, string> = {
  '205': 'AL', '251': 'AL', '256': 'AL', '334': 'AL', '938': 'AL',
  '907': 'AK',
  '480': 'AZ', '520': 'AZ', '602': 'AZ', '623': 'AZ', '928': 'AZ',
  '479': 'AR', '501': 'AR', '870': 'AR',
  '209': 'CA', '213': 'CA', '310': 'CA', '323': 'CA', '408': 'CA',
  '415': 'CA', '424': 'CA', '442': 'CA', '510': 'CA', '530': 'CA',
  '559': 'CA', '562': 'CA', '619': 'CA', '626': 'CA', '628': 'CA',
  '650': 'CA', '657': 'CA', '661': 'CA', '669': 'CA', '707': 'CA',
  '714': 'CA', '747': 'CA', '760': 'CA', '805': 'CA', '818': 'CA',
  '820': 'CA', '831': 'CA', '858': 'CA', '909': 'CA', '916': 'CA',
  '925': 'CA', '949': 'CA', '951': 'CA',
  '303': 'CO', '719': 'CO', '720': 'CO', '970': 'CO',
  '203': 'CT', '475': 'CT', '860': 'CT', '959': 'CT',
  '302': 'DE',
  '202': 'DC', '771': 'DC',
  '239': 'FL', '305': 'FL', '321': 'FL', '352': 'FL', '386': 'FL',
  '407': 'FL', '561': 'FL', '689': 'FL', '727': 'FL', '754': 'FL',
  '772': 'FL', '786': 'FL', '813': 'FL', '850': 'FL', '863': 'FL',
  '904': 'FL', '941': 'FL', '954': 'FL',
  '229': 'GA', '404': 'GA', '470': 'GA', '478': 'GA', '678': 'GA',
  '706': 'GA', '762': 'GA', '770': 'GA', '912': 'GA',
  '808': 'HI',
  '208': 'ID', '986': 'ID',
  '217': 'IL', '224': 'IL', '309': 'IL', '312': 'IL', '331': 'IL',
  '447': 'IL', '618': 'IL', '630': 'IL', '708': 'IL', '773': 'IL',
  '779': 'IL', '815': 'IL', '847': 'IL', '872': 'IL',
  '219': 'IN', '260': 'IN', '317': 'IN', '463': 'IN', '574': 'IN',
  '765': 'IN', '812': 'IN', '930': 'IN',
  '319': 'IA', '515': 'IA', '563': 'IA', '641': 'IA', '712': 'IA',
  '316': 'KS', '620': 'KS', '785': 'KS', '913': 'KS',
  '270': 'KY', '364': 'KY', '502': 'KY', '606': 'KY', '859': 'KY',
  '225': 'LA', '318': 'LA', '337': 'LA', '504': 'LA', '985': 'LA',
  '207': 'ME',
  '240': 'MD', '301': 'MD', '410': 'MD', '443': 'MD', '667': 'MD',
  '339': 'MA', '351': 'MA', '413': 'MA', '508': 'MA', '617': 'MA',
  '774': 'MA', '781': 'MA', '857': 'MA', '978': 'MA',
  '231': 'MI', '248': 'MI', '269': 'MI', '313': 'MI', '517': 'MI',
  '586': 'MI', '616': 'MI', '734': 'MI', '810': 'MI', '906': 'MI',
  '947': 'MI', '989': 'MI',
  '218': 'MN', '320': 'MN', '507': 'MN', '612': 'MN', '651': 'MN',
  '763': 'MN', '952': 'MN',
  '228': 'MS', '601': 'MS', '662': 'MS', '769': 'MS',
  '314': 'MO', '417': 'MO', '573': 'MO', '636': 'MO', '660': 'MO',
  '816': 'MO', '975': 'MO',
  '406': 'MT',
  '308': 'NE', '402': 'NE', '531': 'NE',
  '702': 'NV', '725': 'NV', '775': 'NV',
  '603': 'NH',
  '201': 'NJ', '551': 'NJ', '609': 'NJ', '732': 'NJ', '848': 'NJ',
  '856': 'NJ', '862': 'NJ', '908': 'NJ', '973': 'NJ',
  '505': 'NM', '575': 'NM',
  '212': 'NY', '315': 'NY', '332': 'NY', '347': 'NY', '516': 'NY',
  '518': 'NY', '585': 'NY', '607': 'NY', '631': 'NY', '646': 'NY',
  '680': 'NY', '716': 'NY', '718': 'NY', '838': 'NY', '845': 'NY',
  '914': 'NY', '917': 'NY', '929': 'NY', '934': 'NY',
  '252': 'NC', '336': 'NC', '704': 'NC', '743': 'NC', '828': 'NC',
  '910': 'NC', '919': 'NC', '980': 'NC', '984': 'NC',
  '701': 'ND',
  '216': 'OH', '220': 'OH', '234': 'OH', '330': 'OH', '380': 'OH',
  '419': 'OH', '440': 'OH', '513': 'OH', '567': 'OH', '614': 'OH',
  '740': 'OH', '937': 'OH',
  '405': 'OK', '539': 'OK', '580': 'OK', '918': 'OK',
  '458': 'OR', '503': 'OR', '541': 'OR', '971': 'OR',
  '215': 'PA', '267': 'PA', '272': 'PA', '412': 'PA', '445': 'PA',
  '484': 'PA', '570': 'PA', '610': 'PA', '717': 'PA', '724': 'PA',
  '814': 'PA', '878': 'PA',
  '401': 'RI',
  '803': 'SC', '839': 'SC', '843': 'SC', '854': 'SC', '864': 'SC',
  '605': 'SD',
  '423': 'TN', '615': 'TN', '629': 'TN', '731': 'TN', '865': 'TN',
  '901': 'TN', '931': 'TN',
  '210': 'TX', '214': 'TX', '254': 'TX', '281': 'TX', '325': 'TX',
  '346': 'TX', '361': 'TX', '409': 'TX', '430': 'TX', '432': 'TX',
  '469': 'TX', '512': 'TX', '682': 'TX', '713': 'TX', '726': 'TX',
  '737': 'TX', '806': 'TX', '817': 'TX', '830': 'TX', '832': 'TX',
  '903': 'TX', '915': 'TX', '936': 'TX', '940': 'TX', '945': 'TX',
  '956': 'TX', '972': 'TX', '979': 'TX',
  '385': 'UT', '435': 'UT', '801': 'UT',
  '802': 'VT',
  '276': 'VA', '434': 'VA', '540': 'VA', '571': 'VA', '703': 'VA',
  '757': 'VA', '804': 'VA',
  '253': 'WA', '360': 'WA', '425': 'WA', '509': 'WA', '564': 'WA',
  '206': 'WA',
  '304': 'WV', '681': 'WV',
  '262': 'WI', '414': 'WI', '534': 'WI', '608': 'WI', '715': 'WI',
  '920': 'WI',
  '307': 'WY',
};

/**
 * Get the IANA timezone for a phone number based on its area code.
 * Falls back to the tenant's configured timezone if area code is unknown.
 */
export function getTimezoneFromPhone(phone: string, fallbackTimezone: string = 'America/Phoenix'): string {
  // Strip all non-digits
  const digits = phone.replace(/\D/g, '');
  
  // Handle +1 country code prefix
  const normalized = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits;
  
  if (normalized.length < 10) {
    return fallbackTimezone;
  }
  
  const areaCode = normalized.substring(0, 3);
  return AREA_CODE_TIMEZONE_MAP[areaCode] || fallbackTimezone;
}

/**
 * Get the state abbreviation for a phone number based on its area code.
 */
export function getStateFromPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  const normalized = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits;
  if (normalized.length < 10) return null;
  const areaCode = normalized.substring(0, 3);
  return AREA_CODE_STATE_MAP[areaCode] || null;
}

/**
 * Get the applicable quiet hours window for a phone number.
 * Returns the STRICTEST applicable rule (state-specific or federal default).
 * 
 * Returns: { startHour: number, endHour: number, timezone: string, rule: string }
 * Messages are ALLOWED between startHour and endHour in the contact's local timezone.
 */
export function getContactQuietHoursWindow(
  phone: string,
  fallbackTimezone: string = 'America/Phoenix'
): { startHour: number; endHour: number; timezone: string; rule: string } {
  const timezone = getTimezoneFromPhone(phone, fallbackTimezone);
  const state = getStateFromPhone(phone);
  
  // Federal default: 8AM - 9PM
  let startHour = 8;
  let endHour = 21;
  let rule = 'Federal TCPA (8AM-9PM)';
  
  if (state && STATE_QUIET_HOURS[state]) {
    const stateRule = STATE_QUIET_HOURS[state];
    // Apply the stricter rule
    if (stateRule.start > startHour) startHour = stateRule.start;
    if (stateRule.end < endHour) endHour = stateRule.end;
    rule = stateRule.label;
  }
  
  return { startHour, endHour, timezone, rule };
}

/**
 * Check if it is currently within quiet hours for a specific phone number.
 * Returns true if the current time is OUTSIDE the allowed sending window.
 */
export function isContactInQuietHours(
  phone: string,
  fallbackTimezone: string = 'America/Phoenix'
): { blocked: boolean; reason?: string; nextAllowedAt?: Date } {
  const { startHour, endHour, timezone, rule } = getContactQuietHoursWindow(phone, fallbackTimezone);
  
  const now = new Date();
  
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const localHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const localMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    
    const isAllowed = localHour >= startHour && localHour < endHour;
    
    if (isAllowed) {
      return { blocked: false };
    }
    
    // Calculate next allowed time
    let minutesUntilStart: number;
    const currentTotalMinutes = localHour * 60 + localMinute;
    const startTotalMinutes = startHour * 60;
    
    if (currentTotalMinutes < startTotalMinutes) {
      minutesUntilStart = startTotalMinutes - currentTotalMinutes;
    } else {
      // Past end hour, wait until tomorrow's start
      minutesUntilStart = (24 * 60 - currentTotalMinutes) + startTotalMinutes;
    }
    
    const nextAllowedAt = new Date(now.getTime() + minutesUntilStart * 60 * 1000 + 60000);
    
    return {
      blocked: true,
      reason: `Quiet hours (${rule}) in ${timezone}: current local time is ${localHour}:${String(localMinute).padStart(2, '0')}. Allowed window: ${startHour}:00-${endHour}:00.`,
      nextAllowedAt,
    };
  } catch (err) {
    console.warn(`[QuietHours] Could not resolve timezone ${timezone} for phone ${phone}, defaulting to allowed`);
    return { blocked: false };
  }
}
