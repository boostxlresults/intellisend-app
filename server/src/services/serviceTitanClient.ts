import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

const tokenCache: Map<string, TokenCache> = new Map();

export interface CreateBookingFromInboundSmsOptions {
  tenantId: string;
  contact: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    email?: string | null;
  };
  conversationId: string;
  toNumber: string;
  lastInboundMessage: string;
  conversationSummary: string;
}

async function getServiceTitanConfig(tenantId: string) {
  return prisma.serviceTitanConfig.findUnique({
    where: { tenantId },
    include: { tenant: { select: { publicName: true } } }
  });
}

async function getAccessToken(config: {
  tenantApiBaseUrl: string;
  serviceTitanTenantId: string;
  clientId: string;
  clientSecret: string;
}): Promise<string | null> {
  const cacheKey = `${config.serviceTitanTenantId}:${config.clientId}`;
  const cached = tokenCache.get(cacheKey);
  
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return cached.accessToken;
  }

  try {
    const tokenUrl = `${config.tenantApiBaseUrl}/connect/token`;
    
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });

    if (!response.ok) {
      console.error(`[ServiceTitan] Token fetch failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    const expiresAt = Date.now() + (data.expires_in * 1000);
    
    tokenCache.set(cacheKey, {
      accessToken: data.access_token,
      expiresAt,
    });

    return data.access_token;
  } catch (error) {
    console.error('[ServiceTitan] Error fetching access token:', error);
    return null;
  }
}

export async function createBookingFromInboundSms(
  options: CreateBookingFromInboundSmsOptions
): Promise<string | null> {
  try {
    const config = await getServiceTitanConfig(options.tenantId);
    
    if (!config || !config.enabled) {
      return null;
    }

    const accessToken = await getAccessToken({
      tenantApiBaseUrl: config.tenantApiBaseUrl,
      serviceTitanTenantId: config.serviceTitanTenantId,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });

    if (!accessToken) {
      console.error(`[ServiceTitan] Failed to get access token for tenant ${options.tenantId}`);
      return null;
    }

    const bookingNotes = [
      `IntelliSend SMS Notification`,
      `Tenant: ${config.tenant.publicName}`,
      `Twilio Number: ${options.toNumber}`,
      `Conversation ID: ${options.conversationId}`,
      ``,
      `Last Message: ${options.lastInboundMessage}`,
      ``,
      options.conversationSummary,
    ].join('\n');

    const bookingPayload = {
      source: config.bookingProvider,
      name: `${options.contact.firstName} ${options.contact.lastName}`.trim() || 'Unknown',
      contacts: [
        {
          type: 'MobilePhone',
          value: options.contact.phone,
        },
        ...(options.contact.email ? [{
          type: 'Email',
          value: options.contact.email,
        }] : []),
      ],
      summary: `SMS Reply - ${options.lastInboundMessage.substring(0, 100)}${options.lastInboundMessage.length > 100 ? '...' : ''}`,
      notes: bookingNotes,
    };

    const bookingUrl = `${config.tenantApiBaseUrl}/booking/v2/tenant/${config.serviceTitanTenantId}/bookings`;
    
    const response = await fetch(bookingUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'ST-App-Key': config.clientId,
      },
      body: JSON.stringify(bookingPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ServiceTitan] Booking creation failed for tenant ${options.tenantId}: ${response.status} - ${errorText}`);
      return null;
    }

    const result = await response.json() as { id?: string; bookingId?: string };
    const bookingId = result.id || result.bookingId || null;
    
    console.log(`[ServiceTitan] Booking created for tenant ${options.tenantId}: ${bookingId}`);
    return bookingId;
  } catch (error) {
    console.error(`[ServiceTitan] Error creating booking for tenant ${options.tenantId}:`, error);
    return null;
  }
}

export async function testServiceTitanConnection(tenantId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const config = await getServiceTitanConfig(tenantId);
    
    if (!config) {
      return { ok: false, error: 'ServiceTitan configuration not found' };
    }

    const accessToken = await getAccessToken({
      tenantApiBaseUrl: config.tenantApiBaseUrl,
      serviceTitanTenantId: config.serviceTitanTenantId,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });

    if (!accessToken) {
      return { ok: false, error: 'Failed to obtain access token - check credentials' };
    }

    const testUrl = `${config.tenantApiBaseUrl}/settings/v2/tenant/${config.serviceTitanTenantId}/business-units`;
    
    const response = await fetch(testUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'ST-App-Key': config.clientId,
      },
    });

    if (response.ok) {
      return { ok: true };
    } else {
      return { ok: false, error: `API call failed: ${response.status} ${response.statusText}` };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
