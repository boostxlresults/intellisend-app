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
    return { found: false, customers: [], locations: [] };
  }

  try {
    const token = await getServiceTitanToken(config);
    const headers = {
      'Authorization': `Bearer ${token}`,
      'ST-App-Key': config.appKey,
      'Content-Type': 'application/json',
    };

    const normalizedPhone = normalizePhone(phone);
    
    const customerUrl = `${config.tenantApiBaseUrl}/crm/v2/tenant/${config.serviceTitanTenantId}/customers?phone=${encodeURIComponent(normalizedPhone)}&pageSize=10`;
    
    const customerResponse = await fetch(customerUrl, { headers });
    
    if (!customerResponse.ok) {
      console.error('ST customer search failed:', await customerResponse.text());
      return { found: false, customers: [], locations: [] };
    }

    const customerData = await customerResponse.json() as { data?: STCustomer[] };
    const customers: STCustomer[] = customerData.data || [];

    if (customers.length === 0) {
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
    return null;
  }

  try {
    const token = await getServiceTitanToken(config);
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

    const customerUrl = `${config.tenantApiBaseUrl}/crm/v2/tenant/${config.serviceTitanTenantId}/customers`;
    const customerResponse = await fetch(customerUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(customerPayload),
    });

    if (!customerResponse.ok) {
      console.error('ST customer create failed:', await customerResponse.text());
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
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  return phone;
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
    return generateFallbackSlots(options.maxSlots || 5);
  }

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
      console.error('[ServiceTitan] Capacity API error:', capacityResponse.status, await capacityResponse.text());
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
    console.error('[ServiceTitan] Availability lookup error:', error);
    return generateFallbackSlots(options.maxSlots || 5);
  }
}

function generateFallbackSlots(count: number): AvailabilitySlot[] {
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
