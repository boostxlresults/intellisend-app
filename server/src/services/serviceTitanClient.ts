import { prisma } from '../index';

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
  campaignName?: string;
  frontendUrl?: string;
}

export interface BookingResult {
  success: boolean;
  bookingId?: string;
  error?: string;
  errorCode?: 'AUTH_FAILED' | 'INVALID_TENANT' | 'MISSING_SCOPE' | 'RATE_LIMITED' | 'API_ERROR' | 'NETWORK_ERROR';
}

async function getServiceTitanConfig(tenantId: string) {
  return prisma.serviceTitanConfig.findUnique({
    where: { tenantId },
    include: { tenant: { select: { publicName: true } } }
  });
}

function getAuthBaseUrl(apiBaseUrl: string): string {
  if (apiBaseUrl.includes('api-integration.servicetitan.io')) {
    return 'https://auth-integration.servicetitan.io';
  }
  return 'https://auth.servicetitan.io';
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
    const authBaseUrl = getAuthBaseUrl(config.tenantApiBaseUrl);
    const tokenUrl = `${authBaseUrl}/connect/token`;
    
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: 'api',
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
): Promise<BookingResult> {
  try {
    const config = await getServiceTitanConfig(options.tenantId);
    
    if (!config || !config.enabled) {
      return { success: false, error: 'ServiceTitan integration not configured or disabled', errorCode: 'API_ERROR' };
    }

    const accessToken = await getAccessToken({
      tenantApiBaseUrl: config.tenantApiBaseUrl,
      serviceTitanTenantId: config.serviceTitanTenantId,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });

    if (!accessToken) {
      console.error(`[ServiceTitan] Failed to get access token for tenant ${options.tenantId} - check Client ID/Secret`);
      return { 
        success: false, 
        error: 'Authentication failed - check Client ID and Client Secret', 
        errorCode: 'AUTH_FAILED' 
      };
    }

    const conversationUrl = options.frontendUrl 
      ? `${options.frontendUrl}/conversations/${options.conversationId}`
      : `IntelliSend Conversation ID: ${options.conversationId}`;

    const createdAt = new Date().toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const bookingNotes = [
      `════════════════════════════════════════`,
      `🚨 CSR ACTION REQUIRED`,
      `════════════════════════════════════════`,
      ``,
      `A customer has replied to an SMS campaign and needs attention.`,
      ``,
      `📋 BOOKING DETAILS`,
      `────────────────────────────────────────`,
      `Customer: ${options.contact.firstName} ${options.contact.lastName}`.trim(),
      `Phone: ${options.contact.phone}`,
      options.contact.email ? `Email: ${options.contact.email}` : null,
      ``,
      options.campaignName ? `📣 Campaign: ${options.campaignName}` : null,
      `📱 Twilio Number: ${options.toNumber}`,
      `🕐 Created: ${createdAt}`,
      ``,
      `💬 LAST MESSAGE FROM CUSTOMER`,
      `────────────────────────────────────────`,
      `"${options.lastInboundMessage}"`,
      ``,
      options.conversationSummary,
      ``,
      `🔗 VIEW FULL CONVERSATION`,
      `────────────────────────────────────────`,
      conversationUrl,
      ``,
      `────────────────────────────────────────`,
      `Source: ${config.bookingProvider} | Tenant: ${config.tenant.publicName}`,
    ].filter(line => line !== null).join('\n');

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

    const bookingUrl = `${config.tenantApiBaseUrl}/crm/v2/tenant/${config.serviceTitanTenantId}/bookings`;
    
    const response = await fetch(bookingUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'ST-App-Key': config.appKey,
      },
      body: JSON.stringify(bookingPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ServiceTitan] Booking creation failed for tenant ${options.tenantId}: ${response.status} - ${errorText}`);
      
      if (response.status === 401) {
        tokenCache.delete(`${config.serviceTitanTenantId}:${config.clientId}`);
        return { 
          success: false, 
          error: 'Authentication expired or invalid - credentials may have changed', 
          errorCode: 'AUTH_FAILED' 
        };
      }
      if (response.status === 403) {
        return { 
          success: false, 
          error: 'Access denied - ensure "bookings:write" scope is enabled in ServiceTitan Developer Portal', 
          errorCode: 'MISSING_SCOPE' 
        };
      }
      if (response.status === 404) {
        return { 
          success: false, 
          error: `Invalid ServiceTitan Tenant ID (${config.serviceTitanTenantId}) or API Base URL mismatch`, 
          errorCode: 'INVALID_TENANT' 
        };
      }
      if (response.status === 429) {
        return { 
          success: false, 
          error: 'Rate limited by ServiceTitan API - too many requests', 
          errorCode: 'RATE_LIMITED' 
        };
      }
      
      return { 
        success: false, 
        error: `API error ${response.status}: ${errorText.substring(0, 200)}`, 
        errorCode: 'API_ERROR' 
      };
    }

    const result = await response.json() as { id?: string; bookingId?: string };
    const bookingId = result.id || result.bookingId || undefined;
    
    console.log(`[ServiceTitan] Booking created for tenant ${options.tenantId}: ${bookingId}`);
    return { success: true, bookingId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ServiceTitan] Error creating booking for tenant ${options.tenantId}:`, error);
    
    if (message.includes('ENOTFOUND') || message.includes('ECONNREFUSED')) {
      return { 
        success: false, 
        error: 'Cannot reach ServiceTitan API - check API Base URL or network connectivity', 
        errorCode: 'NETWORK_ERROR' 
      };
    }
    
    return { success: false, error: message, errorCode: 'NETWORK_ERROR' };
  }
}

export async function testServiceTitanConnection(tenantId: string): Promise<{ 
  ok: boolean; 
  error?: string;
  details?: {
    oauth: boolean;
    apiAccess: boolean;
    bookingsAccess: boolean;
  };
}> {
  const details = {
    oauth: false,
    apiAccess: false,
    bookingsAccess: false,
  };

  try {
    const config = await getServiceTitanConfig(tenantId);
    
    if (!config) {
      return { ok: false, error: 'ServiceTitan configuration not found', details };
    }

    const accessToken = await getAccessToken({
      tenantApiBaseUrl: config.tenantApiBaseUrl,
      serviceTitanTenantId: config.serviceTitanTenantId,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });

    if (!accessToken) {
      return { ok: false, error: 'Failed to obtain access token - check Client ID and Client Secret', details };
    }
    details.oauth = true;

    const settingsUrl = `${config.tenantApiBaseUrl}/settings/v2/tenant/${config.serviceTitanTenantId}/business-units`;
    const settingsResponse = await fetch(settingsUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'ST-App-Key': config.appKey,
      },
    });

    if (!settingsResponse.ok) {
      return { 
        ok: false, 
        error: `API access failed: ${settingsResponse.status} ${settingsResponse.statusText} - check Tenant ID or App Key`, 
        details 
      };
    }
    details.apiAccess = true;

    const bookingsUrl = `${config.tenantApiBaseUrl}/crm/v2/tenant/${config.serviceTitanTenantId}/bookings?page=1&pageSize=1`;
    const bookingsResponse = await fetch(bookingsUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'ST-App-Key': config.appKey,
      },
    });

    if (!bookingsResponse.ok) {
      if (bookingsResponse.status === 403) {
        return { 
          ok: false, 
          error: 'Bookings API access denied - ensure "CRM > Bookings" read/write scope is enabled for your app in the ServiceTitan Developer Portal', 
          details 
        };
      }
      return { 
        ok: false, 
        error: `Bookings API failed: ${bookingsResponse.status} ${bookingsResponse.statusText}`, 
        details 
      };
    }
    details.bookingsAccess = true;

    return { ok: true, details };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error', details };
  }
}
