import { prisma } from '../../index';
import { getServiceTitanToken } from '../serviceTitanClient';

interface STCustomer {
  id: number;
  name: string;
  type: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  phoneSettings?: Array<{ phoneNumber: string; type: string }>;
  email?: string;
}

interface STLocation {
  id: number;
  customerId: number;
  name: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}

interface CustomerSearchResult {
  found: boolean;
  customers: STCustomer[];
  locations: STLocation[];
  exactMatch?: {
    customerId: number;
    locationId?: number;
    matchedBy: 'phone' | 'address' | 'name';
    confidence: 'high' | 'medium' | 'low';
  };
  possibleMatches?: Array<{
    customerId: number;
    locationId?: number;
    customerName: string;
    address?: string;
    matchedBy: 'address' | 'name';
  }>;
}

export async function searchServiceTitanCustomer(
  tenantId: string,
  phone: string,
  email?: string,
  address?: string
): Promise<CustomerSearchResult> {
  const config = await prisma.serviceTitanConfig.findUnique({
    where: { tenantId },
  });

  if (!config || !config.enabled) {
    console.log(`[ServiceTitan] Customer search: No config or not enabled for tenant ${tenantId}`);
    return { found: false, customers: [], locations: [] };
  }

  try {
    const token = await getServiceTitanToken(config);
    if (!token) {
      console.error(`[ServiceTitan] Customer search: Failed to get auth token for tenant ${tenantId}`);
      return { found: false, customers: [], locations: [] };
    }
    
    const headers = {
      'Authorization': `Bearer ${token}`,
      'ST-App-Key': config.appKey,
      'Content-Type': 'application/json',
    };

    const normalizedPhone = normalizePhone(phone);
    console.log(`[ServiceTitan] Customer search: Original phone "${phone}" → Normalized "${normalizedPhone}"`);
    
    const customerUrl = `${config.tenantApiBaseUrl}/crm/v2/tenant/${config.serviceTitanTenantId}/customers?phone=${encodeURIComponent(normalizedPhone)}&pageSize=10`;
    console.log(`[ServiceTitan] Customer search URL: ${customerUrl}`);
    
    const customerResponse = await fetch(customerUrl, { headers });
    
    if (!customerResponse.ok) {
      const errorText = await customerResponse.text();
      console.error(`[ServiceTitan] Customer search failed: ${customerResponse.status} - ${errorText}`);
      return { found: false, customers: [], locations: [] };
    }

    const customerData = await customerResponse.json() as { data?: STCustomer[] };
    const customers: STCustomer[] = customerData.data || [];
    console.log(`[ServiceTitan] Customer search found ${customers.length} customers for phone "${normalizedPhone}"`);

    if (customers.length === 0) {
      console.log(`[ServiceTitan] No customers found for phone "${normalizedPhone}"`);
      return { found: false, customers: [], locations: [] };
    }

    const allLocations: STLocation[] = [];
    
    for (const customer of customers.slice(0, 3)) {
      const locationUrl = `${config.tenantApiBaseUrl}/crm/v2/tenant/${config.serviceTitanTenantId}/locations?customerId=${customer.id}&pageSize=10`;
      const locationResponse = await fetch(locationUrl, { headers });
      
      if (locationResponse.ok) {
        const locationData = await locationResponse.json() as { data?: STLocation[] };
        allLocations.push(...(locationData.data || []));
      }
    }

    let exactMatch: CustomerSearchResult['exactMatch'] = undefined;
    
    if (customers.length === 1) {
      exactMatch = { 
        customerId: customers[0].id,
        matchedBy: 'phone',
        confidence: 'high',
      };
      if (allLocations.length === 1) {
        exactMatch.locationId = allLocations[0].id;
      }
    }

    return {
      found: true,
      customers,
      locations: allLocations,
      exactMatch,
    };
  } catch (error) {
    console.error('ServiceTitan search error:', error);
    return { found: false, customers: [], locations: [] };
  }
}

export async function searchByAddress(
  tenantId: string,
  address: string
): Promise<CustomerSearchResult> {
  const config = await prisma.serviceTitanConfig.findUnique({
    where: { tenantId },
  });

  if (!config || !config.enabled) {
    return { found: false, customers: [], locations: [] };
  }

  try {
    const token = await getServiceTitanToken(config);
    const headers = {
      'Authorization': `Bearer ${token}`,
      'ST-App-Key': config.appKey,
      'Content-Type': 'application/json',
    };

    const addressParts = parseAddressForSearch(address);
    if (!addressParts.street) {
      return { found: false, customers: [], locations: [] };
    }

    const searchParams = new URLSearchParams({ pageSize: '20' });
    if (addressParts.street) {
      searchParams.append('street', addressParts.street);
    }
    if (addressParts.city) {
      searchParams.append('city', addressParts.city);
    }
    if (addressParts.zip) {
      searchParams.append('zip', addressParts.zip);
    }

    const locationUrl = `${config.tenantApiBaseUrl}/crm/v2/tenant/${config.serviceTitanTenantId}/locations?${searchParams.toString()}`;
    const locationResponse = await fetch(locationUrl, { headers });

    if (!locationResponse.ok) {
      console.error('ST location search failed:', await locationResponse.text());
      return { found: false, customers: [], locations: [] };
    }

    const locationData = await locationResponse.json() as { data?: STLocation[] };
    const locations: STLocation[] = locationData.data || [];

    if (locations.length === 0) {
      return { found: false, customers: [], locations: [] };
    }

    const customerIds = [...new Set(locations.map(l => l.customerId))];
    const customers: STCustomer[] = [];

    for (const customerId of customerIds.slice(0, 5)) {
      const customerUrl = `${config.tenantApiBaseUrl}/crm/v2/tenant/${config.serviceTitanTenantId}/customers/${customerId}`;
      const customerResponse = await fetch(customerUrl, { headers });
      if (customerResponse.ok) {
        const customer = await customerResponse.json() as STCustomer;
        customers.push(customer);
      }
    }

    const possibleMatches = locations.slice(0, 5).map(loc => {
      const customer = customers.find(c => c.id === loc.customerId);
      return {
        customerId: loc.customerId,
        locationId: loc.id,
        customerName: customer?.name || 'Unknown',
        address: loc.address ? `${loc.address.street}, ${loc.address.city}` : undefined,
        matchedBy: 'address' as const,
      };
    });

    let exactMatch: CustomerSearchResult['exactMatch'] = undefined;
    if (locations.length === 1) {
      exactMatch = {
        customerId: locations[0].customerId,
        locationId: locations[0].id,
        matchedBy: 'address',
        confidence: 'medium',
      };
    }

    return {
      found: true,
      customers,
      locations,
      exactMatch,
      possibleMatches,
    };
  } catch (error) {
    console.error('ServiceTitan address search error:', error);
    return { found: false, customers: [], locations: [] };
  }
}

export async function searchByName(
  tenantId: string,
  name: string
): Promise<CustomerSearchResult> {
  const config = await prisma.serviceTitanConfig.findUnique({
    where: { tenantId },
  });

  if (!config || !config.enabled) {
    return { found: false, customers: [], locations: [] };
  }

  try {
    const token = await getServiceTitanToken(config);
    const headers = {
      'Authorization': `Bearer ${token}`,
      'ST-App-Key': config.appKey,
      'Content-Type': 'application/json',
    };

    const customerUrl = `${config.tenantApiBaseUrl}/crm/v2/tenant/${config.serviceTitanTenantId}/customers?name=${encodeURIComponent(name)}&pageSize=10`;
    const customerResponse = await fetch(customerUrl, { headers });

    if (!customerResponse.ok) {
      console.error('ST name search failed:', await customerResponse.text());
      return { found: false, customers: [], locations: [] };
    }

    const customerData = await customerResponse.json() as { data?: STCustomer[] };
    const customers: STCustomer[] = customerData.data || [];

    if (customers.length === 0) {
      return { found: false, customers: [], locations: [] };
    }

    const allLocations: STLocation[] = [];
    for (const customer of customers.slice(0, 3)) {
      const locationUrl = `${config.tenantApiBaseUrl}/crm/v2/tenant/${config.serviceTitanTenantId}/locations?customerId=${customer.id}&pageSize=5`;
      const locationResponse = await fetch(locationUrl, { headers });
      if (locationResponse.ok) {
        const locationData = await locationResponse.json() as { data?: STLocation[] };
        allLocations.push(...(locationData.data || []));
      }
    }

    const possibleMatches = customers.slice(0, 5).map(customer => {
      const location = allLocations.find(l => l.customerId === customer.id);
      return {
        customerId: customer.id,
        locationId: location?.id,
        customerName: customer.name,
        address: location?.address ? `${location.address.street}, ${location.address.city}` : undefined,
        matchedBy: 'name' as const,
      };
    });

    return {
      found: true,
      customers,
      locations: allLocations,
      possibleMatches,
    };
  } catch (error) {
    console.error('ServiceTitan name search error:', error);
    return { found: false, customers: [], locations: [] };
  }
}

function parseAddressForSearch(address: string): { street?: string; city?: string; state?: string; zip?: string } {
  const zipMatch = address.match(/\b(\d{5})(?:-\d{4})?\b/);
  const stateMatch = address.match(/\b([A-Z]{2})\b/);
  
  const parts = address.split(',').map(p => p.trim());
  
  return {
    street: parts[0] || undefined,
    city: parts[1]?.replace(/\b[A-Z]{2}\b/, '').replace(/\d{5}.*/, '').trim() || undefined,
    state: stateMatch?.[1] || undefined,
    zip: zipMatch?.[1] || undefined,
  };
}

export async function createServiceTitanCustomer(
  tenantId: string,
  data: {
    name: string;
    phone: string;
    email?: string;
    address: {
      street: string;
      city: string;
      state: string;
      zip: string;
    };
  }
): Promise<{ customerId: number; locationId: number } | null> {
  const config = await prisma.serviceTitanConfig.findUnique({
    where: { tenantId },
  });

  if (!config || !config.enabled) {
    console.log(`[ServiceTitan] Create customer: No config or not enabled for tenant ${tenantId}`);
    return null;
  }

  console.log(`[ServiceTitan] Creating customer: name="${data.name}", phone="${data.phone}", address="${data.address.street}, ${data.address.city}"`);
  
  try {
    const token = await getServiceTitanToken(config);
    if (!token) {
      console.error(`[ServiceTitan] Create customer: Failed to get auth token`);
      return null;
    }
    
    const headers = {
      'Authorization': `Bearer ${token}`,
      'ST-App-Key': config.appKey,
      'Content-Type': 'application/json',
    };

    const customerPayload = {
      name: data.name,
      type: 'Residential',
      address: {
        street: data.address.street,
        city: data.address.city,
        state: data.address.state,
        zip: data.address.zip,
        country: 'USA',
      },
      phoneSettings: [
        {
          phoneNumber: data.phone,
          type: 'Mobile',
        },
      ],
      email: data.email || undefined,
    };

    console.log(`[ServiceTitan] Create customer payload:`, JSON.stringify(customerPayload));
    
    const customerUrl = `${config.tenantApiBaseUrl}/crm/v2/tenant/${config.serviceTitanTenantId}/customers`;
    const customerResponse = await fetch(customerUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(customerPayload),
    });

    if (!customerResponse.ok) {
      const errorText = await customerResponse.text();
      console.error(`[ServiceTitan] Create customer failed: ${customerResponse.status} - ${errorText}`);
      return null;
    }

    const customerResult = await customerResponse.json() as { id: number };
    const customerId = customerResult.id;

    const locationPayload = {
      customerId,
      name: `${data.name} - ${data.address.street}`,
      address: {
        street: data.address.street,
        city: data.address.city,
        state: data.address.state,
        zip: data.address.zip,
        country: 'USA',
      },
      contacts: [
        {
          name: data.name,
          type: 'Primary',
          phoneNumber: data.phone,
          email: data.email || undefined,
        },
      ],
    };

    const locationUrl = `${config.tenantApiBaseUrl}/crm/v2/tenant/${config.serviceTitanTenantId}/locations`;
    const locationResponse = await fetch(locationUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(locationPayload),
    });

    if (!locationResponse.ok) {
      console.error('ST location create failed:', await locationResponse.text());
      return { customerId, locationId: 0 };
    }

    const locationResult = await locationResponse.json() as { id: number };
    return { customerId, locationId: locationResult.id };
  } catch (error) {
    console.error('ServiceTitan create error:', error);
    return null;
  }
}

export async function createServiceTitanJob(
  tenantId: string,
  data: {
    customerId: number;
    locationId: number;
    jobTypeId: string;
    businessUnitId: string;
    summary: string;
    preferredTime?: string;
    campaignId?: string;
    selectedSlot?: AvailabilitySlot;
  }
): Promise<{ jobId: number; appointmentId: number } | null> {
  const config = await prisma.serviceTitanConfig.findUnique({
    where: { tenantId },
  });

  if (!config || !config.enabled) {
    return null;
  }

  try {
    const token = await getServiceTitanToken(config);
    const headers = {
      'Authorization': `Bearer ${token}`,
      'ST-App-Key': config.appKey,
      'Content-Type': 'application/json',
    };

    let startTime: Date;
    let endTime: Date;
    let arrivalWindowStart: Date;
    let arrivalWindowEnd: Date;
    
    if (data.selectedSlot) {
      startTime = new Date(`${data.selectedSlot.date}T${data.selectedSlot.startTime}:00`);
      endTime = new Date(`${data.selectedSlot.date}T${data.selectedSlot.endTime}:00`);
      arrivalWindowStart = startTime;
      arrivalWindowEnd = endTime;
      console.log(`[ServiceTitan] Using selected slot: ${data.selectedSlot.displayText}`);
    } else {
      startTime = getNextAvailableSlot(data.preferredTime);
      endTime = new Date(startTime.getTime() + 3 * 60 * 60 * 1000);
      arrivalWindowStart = startTime;
      arrivalWindowEnd = new Date(startTime.getTime() + 60 * 60 * 1000);
    }

    const jobPayload = {
      customerId: data.customerId,
      locationId: data.locationId,
      jobTypeId: parseInt(data.jobTypeId),
      businessUnitId: parseInt(data.businessUnitId),
      priority: 'Normal',
      campaignId: data.campaignId ? parseInt(data.campaignId) : undefined,
      summary: data.summary,
      appointments: [
        {
          start: startTime.toISOString(),
          end: endTime.toISOString(),
          arrivalWindowStart: arrivalWindowStart.toISOString(),
          arrivalWindowEnd: arrivalWindowEnd.toISOString(),
        },
      ],
    };

    const jobUrl = `${config.tenantApiBaseUrl}/jpm/v2/tenant/${config.serviceTitanTenantId}/jobs`;
    const jobResponse = await fetch(jobUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(jobPayload),
    });

    if (!jobResponse.ok) {
      const errorText = await jobResponse.text();
      console.error('ST job create failed:', errorText);
      return null;
    }

    const jobResult = await jobResponse.json() as { 
      id: number; 
      firstAppointmentId?: number; 
      appointments?: Array<{ id: number }> 
    };
    return {
      jobId: jobResult.id,
      appointmentId: jobResult.firstAppointmentId || jobResult.appointments?.[0]?.id || 0,
    };
  } catch (error) {
    console.error('ServiceTitan job create error:', error);
    return null;
  }
}

function normalizePhone(phone: string): string {
  // ServiceTitan expects 10-digit format without +1 prefix
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1); // Remove leading 1
  }
  if (digits.length === 10) {
    return digits; // Return 10 digits as-is
  }
  console.log(`[ServiceTitan] Phone normalization: unusual format "${phone}" → "${digits}"`);
  return digits;
}

function getNextAvailableSlot(preference?: string): Date {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  if (preference?.toLowerCase().includes('morning')) {
    tomorrow.setHours(9, 0, 0, 0);
  } else if (preference?.toLowerCase().includes('afternoon')) {
    tomorrow.setHours(13, 0, 0, 0);
  } else {
    tomorrow.setHours(10, 0, 0, 0);
  }
  
  return tomorrow;
}

export interface AvailabilitySlot {
  date: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  arrivalWindow: string;
  displayText: string;
}

export async function getServiceTitanAvailability(
  tenantId: string,
  options: {
    businessUnitId?: string;
    jobTypeId?: string;
    daysAhead?: number;
    maxSlots?: number;
  } = {}
): Promise<AvailabilitySlot[]> {
  const config = await prisma.serviceTitanConfig.findUnique({
    where: { tenantId },
  });

  if (!config || !config.enabled) {
    console.error(`[ServiceTitan] FALLBACK: No config or not enabled for tenant ${tenantId}`);
    return generateFallbackSlots(options.maxSlots || 5);
  }

  console.log(`[ServiceTitan] Fetching real availability from ServiceTitan for tenant ${tenantId}`);
  try {
    const token = await getServiceTitanToken(config);
    const headers = {
      'Authorization': `Bearer ${token}`,
      'ST-App-Key': config.appKey,
      'Content-Type': 'application/json',
    };

    const daysAhead = options.daysAhead || 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + daysAhead);

    const capacityUrl = `${config.tenantApiBaseUrl}/dispatch/v2/tenant/${config.serviceTitanTenantId}/capacity?` + 
      `startsOnOrAfter=${startDate.toISOString().split('T')[0]}` +
      `&endsOnOrBefore=${endDate.toISOString().split('T')[0]}` +
      (options.businessUnitId ? `&businessUnitId=${options.businessUnitId}` : '');

    const capacityResponse = await fetch(capacityUrl, { headers });
    
    if (!capacityResponse.ok) {
      const errorText = await capacityResponse.text();
      console.error(`[ServiceTitan] FALLBACK: Capacity API error ${capacityResponse.status}: ${errorText}`);
      return generateFallbackSlots(options.maxSlots || 5);
    }

    const capacityData = await capacityResponse.json() as { 
      data?: Array<{
        date: string;
        businessUnitId: number;
        capacity: number;
        availability: number;
      }> 
    };

    if (!capacityData.data || capacityData.data.length === 0) {
      console.error(`[ServiceTitan] FALLBACK: No capacity data returned from API`);
      return generateFallbackSlots(options.maxSlots || 5);
    }

    const availableDays = capacityData.data
      .filter(d => d.availability > 0)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, options.maxSlots || 5);

    const slots: AvailabilitySlot[] = [];
    const timeWindows = [
      { start: '08:00', end: '10:00', label: '8-10 AM' },
      { start: '10:00', end: '12:00', label: '10 AM-12 PM' },
      { start: '12:00', end: '14:00', label: '12-2 PM' },
      { start: '14:00', end: '16:00', label: '2-4 PM' },
    ];

    for (const day of availableDays) {
      const date = new Date(day.date + 'T12:00:00');
      const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      
      const windowIndex = slots.length % timeWindows.length;
      const window = timeWindows[windowIndex];
      
      slots.push({
        date: day.date,
        dayOfWeek,
        startTime: window.start,
        endTime: window.end,
        arrivalWindow: window.label,
        displayText: `${dayOfWeek} ${dateStr}, ${window.label}`,
      });
    }

    console.log(`[ServiceTitan] Found ${slots.length} availability slots for tenant ${tenantId}`);
    return slots;

  } catch (error) {
    console.error('[ServiceTitan] FALLBACK: Availability lookup exception:', error);
    return generateFallbackSlots(options.maxSlots || 5);
  }
}

function generateFallbackSlots(count: number): AvailabilitySlot[] {
  // CRITICAL: Return empty array to trigger CSR handoff instead of fake slots
  // Production systems should never present fake availability to customers
  console.error(`[ServiceTitan] CRITICAL: Availability API failed - returning EMPTY to trigger CSR handoff (no fake slots)`);
  return []; // This will trigger handoffToCSR in proposeAvailableTimes
}

// Keep original function for reference/testing only
function _generateFallbackSlotsDisabled(count: number): AvailabilitySlot[] {
  console.warn(`[ServiceTitan] WARNING: Generating ${count} FAKE fallback slots - NOT from real availability`);
  const slots: AvailabilitySlot[] = [];
  const timeWindows = [
    { start: '09:00', end: '11:00', label: '9-11 AM' },
    { start: '11:00', end: '13:00', label: '11 AM-1 PM' },
    { start: '13:00', end: '15:00', label: '1-3 PM' },
    { start: '15:00', end: '17:00', label: '3-5 PM' },
  ];

  let dayOffset = 1;
  for (let i = 0; i < count; i++) {
    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    
    if (date.getDay() === 0) {
      date.setDate(date.getDate() + 1);
      dayOffset++;
    }
    
    const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const dateISO = date.toISOString().split('T')[0];
    const window = timeWindows[i % timeWindows.length];
    
    slots.push({
      date: dateISO,
      dayOfWeek,
      startTime: window.start,
      endTime: window.end,
      arrivalWindow: window.label,
      displayText: `${dayOfWeek} ${dateStr}, ${window.label}`,
    });
    
    if ((i + 1) % 2 === 0) dayOffset++;
  }
  
  return slots;
}

export function formatSlotsForSMS(slots: AvailabilitySlot[], maxToShow: number = 3): string {
  const slotsToShow = slots.slice(0, maxToShow);
  return slotsToShow.map((slot, i) => `${i + 1}) ${slot.displayText}`).join('\n');
}

// ============================================================================
// ENTERPRISE FEATURES: Job History, Memberships, Equipment, Estimates, Tags
// ============================================================================

export interface STJob {
  id: number;
  number: string;
  customerId: number;
  locationId: number;
  jobTypeId?: number;
  jobTypeName?: string;
  summary?: string;
  status?: string;
  completedOn?: string;
  createdOn?: string;
  total?: number;
}

export interface STMembership {
  id: number;
  customerId: number;
  membershipTypeId: number;
  membershipTypeName?: string;
  status: string;
  from?: string;
  to?: string;
  recurringTotal?: number;
}

export interface STEquipment {
  id: number;
  customerId: number;
  locationId: number;
  name: string;
  type?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  installedOn?: string;
  warrantyEnd?: string;
}

export interface STEstimate {
  id: number;
  customerId: number;
  locationId?: number;
  status: string;
  name?: string;
  summary?: string;
  total?: number;
  createdOn?: string;
  expiresOn?: string;
}

export interface STTag {
  id: number;
  name: string;
}

export interface EnterpriseCustomerContext {
  recentJobs: STJob[];
  activeMemberships: STMembership[];
  equipment: STEquipment[];
  pendingEstimates: STEstimate[];
  customerTags: STTag[];
  isMember: boolean;
  lastServiceDate?: string;
  lastServiceType?: string;
  totalJobsCompleted: number;
  lifetimeValue: number;
}

export async function getEnterpriseCustomerContext(
  tenantId: string,
  customerId: number
): Promise<EnterpriseCustomerContext | null> {
  const config = await prisma.serviceTitanConfig.findUnique({
    where: { tenantId },
  });

  if (!config || !config.enabled) {
    return null;
  }

  try {
    const token = await getServiceTitanToken(config);
    if (!token) return null;

    const headers = {
      'Authorization': `Bearer ${token}`,
      'ST-App-Key': config.appKey,
      'Content-Type': 'application/json',
    };

    const results = await Promise.allSettled([
      fetchJobHistory(config, headers, customerId),
      fetchMemberships(config, headers, customerId),
      fetchEquipment(config, headers, customerId),
      fetchEstimates(config, headers, customerId),
      fetchCustomerTags(config, headers, customerId),
    ]);

    const [jobsResult, membershipsResult, equipmentResult, estimatesResult, tagsResult] = results;

    const recentJobs = jobsResult.status === 'fulfilled' ? jobsResult.value : [];
    const activeMemberships = membershipsResult.status === 'fulfilled' ? membershipsResult.value : [];
    const equipment = equipmentResult.status === 'fulfilled' ? equipmentResult.value : [];
    const pendingEstimates = estimatesResult.status === 'fulfilled' ? estimatesResult.value : [];
    const customerTags = tagsResult.status === 'fulfilled' ? tagsResult.value : [];

    const completedJobs = recentJobs.filter(j => j.status === 'Completed' || j.completedOn);
    const lastCompletedJob = completedJobs[0];
    
    const lifetimeValue = completedJobs.reduce((sum, job) => sum + (job.total || 0), 0);

    return {
      recentJobs,
      activeMemberships,
      equipment,
      pendingEstimates,
      customerTags,
      isMember: activeMemberships.length > 0,
      lastServiceDate: lastCompletedJob?.completedOn,
      lastServiceType: lastCompletedJob?.jobTypeName || lastCompletedJob?.summary,
      totalJobsCompleted: completedJobs.length,
      lifetimeValue,
    };
  } catch (error) {
    console.error('[ServiceTitan] Enterprise context fetch error:', error);
    return null;
  }
}

async function fetchJobHistory(
  config: any,
  headers: Record<string, string>,
  customerId: number
): Promise<STJob[]> {
  try {
    const url = `${config.tenantApiBaseUrl}/jpm/v2/tenant/${config.serviceTitanTenantId}/jobs?customerId=${customerId}&pageSize=10&sort=-completedOn`;
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      console.log(`[ServiceTitan] Job history fetch returned ${response.status}`);
      return [];
    }

    const data = await response.json() as { data?: any[] };
    return (data.data || []).map((job: any) => ({
      id: job.id,
      number: job.number,
      customerId: job.customerId,
      locationId: job.locationId,
      jobTypeId: job.jobTypeId,
      jobTypeName: job.jobType?.name,
      summary: job.summary,
      status: job.status,
      completedOn: job.completedOn,
      createdOn: job.createdOn,
      total: job.total,
    }));
  } catch (error) {
    console.error('[ServiceTitan] Job history error:', error);
    return [];
  }
}

async function fetchMemberships(
  config: any,
  headers: Record<string, string>,
  customerId: number
): Promise<STMembership[]> {
  try {
    const url = `${config.tenantApiBaseUrl}/memberships/v2/tenant/${config.serviceTitanTenantId}/memberships?customerId=${customerId}&status=Active&pageSize=10`;
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      console.log(`[ServiceTitan] Memberships fetch returned ${response.status}`);
      return [];
    }

    const data = await response.json() as { data?: any[] };
    return (data.data || []).map((m: any) => ({
      id: m.id,
      customerId: m.customerId,
      membershipTypeId: m.membershipTypeId,
      membershipTypeName: m.membershipType?.name,
      status: m.status,
      from: m.from,
      to: m.to,
      recurringTotal: m.recurringTotal,
    }));
  } catch (error) {
    console.error('[ServiceTitan] Memberships error:', error);
    return [];
  }
}

async function fetchEquipment(
  config: any,
  headers: Record<string, string>,
  customerId: number
): Promise<STEquipment[]> {
  try {
    const url = `${config.tenantApiBaseUrl}/equipmentsystems/v2/tenant/${config.serviceTitanTenantId}/installed-equipment?customerId=${customerId}&pageSize=20`;
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      console.log(`[ServiceTitan] Equipment fetch returned ${response.status}`);
      return [];
    }

    const data = await response.json() as { data?: any[] };
    return (data.data || []).map((e: any) => ({
      id: e.id,
      customerId: e.customerId,
      locationId: e.locationId,
      name: e.name || e.equipmentType,
      type: e.equipmentType,
      manufacturer: e.manufacturer,
      model: e.model,
      serialNumber: e.serialNumber,
      installedOn: e.installedOn,
      warrantyEnd: e.warrantyExpirationDate,
    }));
  } catch (error) {
    console.error('[ServiceTitan] Equipment error:', error);
    return [];
  }
}

async function fetchEstimates(
  config: any,
  headers: Record<string, string>,
  customerId: number
): Promise<STEstimate[]> {
  try {
    const url = `${config.tenantApiBaseUrl}/sales/v2/tenant/${config.serviceTitanTenantId}/estimates?customerId=${customerId}&status=Open&pageSize=10`;
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      console.log(`[ServiceTitan] Estimates fetch returned ${response.status}`);
      return [];
    }

    const data = await response.json() as { data?: any[] };
    return (data.data || []).map((e: any) => ({
      id: e.id,
      customerId: e.customerId,
      locationId: e.locationId,
      status: e.status,
      name: e.name,
      summary: e.summary,
      total: e.total,
      createdOn: e.createdOn,
      expiresOn: e.expiresOn,
    }));
  } catch (error) {
    console.error('[ServiceTitan] Estimates error:', error);
    return [];
  }
}

async function fetchCustomerTags(
  config: any,
  headers: Record<string, string>,
  customerId: number
): Promise<STTag[]> {
  try {
    const url = `${config.tenantApiBaseUrl}/crm/v2/tenant/${config.serviceTitanTenantId}/customers/${customerId}`;
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      console.log(`[ServiceTitan] Customer tags fetch returned ${response.status}`);
      return [];
    }

    const data = await response.json() as { tagTypeIds?: number[] };
    const tagTypeIds = data.tagTypeIds || [];
    
    if (tagTypeIds.length === 0) return [];

    const tagsUrl = `${config.tenantApiBaseUrl}/crm/v2/tenant/${config.serviceTitanTenantId}/tag-types?ids=${tagTypeIds.join(',')}`;
    const tagsResponse = await fetch(tagsUrl, { headers });
    
    if (!tagsResponse.ok) return [];

    const tagsData = await tagsResponse.json() as { data?: any[] };
    return (tagsData.data || []).map((t: any) => ({
      id: t.id,
      name: t.name,
    }));
  } catch (error) {
    console.error('[ServiceTitan] Customer tags error:', error);
    return [];
  }
}

export function formatEnterpriseContextForAI(context: EnterpriseCustomerContext): string {
  const lines: string[] = [];

  if (context.isMember) {
    const membershipNames = context.activeMemberships.map(m => m.membershipTypeName || 'Service Plan').join(', ');
    lines.push(`MEMBER STATUS: Active member (${membershipNames}) - Treat as VIP!`);
  }

  if (context.lastServiceDate && context.lastServiceType) {
    const date = new Date(context.lastServiceDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    lines.push(`LAST SERVICE: ${context.lastServiceType} in ${date}`);
  }

  if (context.totalJobsCompleted > 0) {
    lines.push(`CUSTOMER HISTORY: ${context.totalJobsCompleted} completed jobs, $${context.lifetimeValue.toLocaleString()} lifetime value`);
  }

  if (context.pendingEstimates.length > 0) {
    const estimateNames = context.pendingEstimates.map(e => e.name || e.summary || 'Pending estimate').slice(0, 2).join(', ');
    lines.push(`PENDING ESTIMATES: ${context.pendingEstimates.length} open (${estimateNames})`);
  }

  if (context.equipment.length > 0) {
    const equipmentList = context.equipment.slice(0, 3).map(e => {
      let desc = e.name || e.type || 'Equipment';
      if (e.installedOn) {
        const installYear = new Date(e.installedOn).getFullYear();
        const age = new Date().getFullYear() - installYear;
        desc += ` (${age} years old)`;
      }
      return desc;
    }).join(', ');
    lines.push(`EQUIPMENT ON FILE: ${equipmentList}`);
  }

  if (context.customerTags.length > 0) {
    lines.push(`CUSTOMER TAGS: ${context.customerTags.map(t => t.name).join(', ')}`);
  }

  return lines.join('\n');
}
