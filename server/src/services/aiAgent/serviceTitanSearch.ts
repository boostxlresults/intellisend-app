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
  };
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
      exactMatch = { customerId: customers[0].id };
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

    const startTime = getNextAvailableSlot(data.preferredTime);
    const endTime = new Date(startTime.getTime() + 3 * 60 * 60 * 1000);

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
          arrivalWindowStart: startTime.toISOString(),
          arrivalWindowEnd: new Date(startTime.getTime() + 60 * 60 * 1000).toISOString(),
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
