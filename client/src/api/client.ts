const API_BASE = import.meta.env.VITE_API_URL || '/api';

export interface Tenant {
  id: string;
  name: string;
  publicName: string;
  industry?: string;
  websiteUrl?: string;
  mainPhone?: string;
  brandVoice?: string;
  createdAt: string;
  numbers?: TenantNumber[];
  _count?: {
    contacts: number;
    conversations: number;
  };
}

export interface TenantNumber {
  id: string;
  tenantId: string;
  phoneNumber: string;
  label?: string;
  isDefault: boolean;
}

export interface Contact {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  leadSource?: string;
  customerType: string;
  aiAgentEnabled?: boolean;
  tags?: ContactTag[];
  conversations?: Conversation[];
}

export interface ContactTag {
  id: string;
  name: string;
  color?: string | null;
}

export interface Conversation {
  id: string;
  tenantId: string;
  contactId: string;
  status: 'OPEN' | 'CLOSED';
  lastMessageAt: string;
  needsAttention?: boolean;
  aiAgentEnabled?: boolean;
  serviceTitanBookingId?: string;
  serviceTitanBookingCreatedAt?: string;
  contact?: Contact;
  messages?: Message[];
}

export interface ServiceTitanConfig {
  id: string;
  tenantId: string;
  tenantApiBaseUrl: string;
  serviceTitanTenantId: string;
  appKey: string;
  clientId: string;
  bookingProvider: string;
  bookingProviderId: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  tenantId: string;
  contactId: string;
  direction: 'OUTBOUND' | 'INBOUND';
  body: string;
  fromNumber: string;
  toNumber: string;
  status?: string;
  createdAt: string;
}

export interface Segment {
  id: string;
  tenantId: string;
  name: string;
  type: 'STATIC' | 'DYNAMIC';
  createdAt?: string;
  _count?: {
    members: number;
  };
  members?: {
    contact: Contact;
  }[];
}

export interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  type: 'BLAST' | 'DRIP';
  status: 'DRAFT' | 'SCHEDULED' | 'RUNNING' | 'PAUSED' | 'COMPLETED';
  segmentId?: string;
  segment?: Segment;
  steps?: CampaignStep[];
  startAt?: string;
}

export interface CampaignStep {
  id: string;
  campaignId: string;
  order: number;
  delayMinutes: number;
  bodyTemplate: string;
  useAiAssist: boolean;
}

export interface Suppression {
  id: string;
  tenantId: string;
  phone: string;
  reason: string;
  createdAt: string;
}

export interface AiPersona {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  systemPrompt: string;
  canAutoReply: boolean;
}

export interface TenantSettings {
  id: string;
  tenantId: string;
  timezone: string;
  quietHoursStart: number;
  quietHoursEnd: number;
  defaultFromNumberId?: string;
  defaultFromNumber?: TenantNumber;
  quietHoursStartFormatted: string;
  quietHoursEndFormatted: string;
  sendRatePerMinute: number;
  sendJitterMinMs: number;
  sendJitterMaxMs: number;
  notificationEmail?: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
  contactCount?: number;
  createdAt: string;
}

export interface KBArticle {
  id: string;
  tenantId: string;
  title: string;
  topic: string;
  content: string;
  sourceType: string;
  sourceUrl?: string;
}

export interface AnalyticsSummary {
  totalSent: number;
  totalDelivered: number;
  totalFailed: number;
  totalSuppressed: number;
  totalOptOuts: number;
  totalInbound: number;
  totalOutbound: number;
  deliveryRate: number;
  optOutRate: number;
  replyRate: number;
}

export interface TimelineDataPoint {
  date: string;
  sent: number;
  delivered: number;
  failed: number;
  suppressed: number;
  inbound: number;
}

export interface CampaignAnalytics {
  id: string;
  name: string;
  status: string;
  audienceSize: number;
  messagesSent: number;
  messagesDelivered: number;
  messagesFailed: number;
  deliveryRate: number;
  createdAt: string;
}

export interface OptOutAnalytics {
  recent: { id: string; phone: string; createdAt: string }[];
  trend: { date: string; count: number }[];
  total: number;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }
  
  return response.json();
}

export const api = {
  getTenants: () => request<Tenant[]>(`${API_BASE}/tenants`),
  
  createTenant: (data: Partial<Tenant>) =>
    request<Tenant>(`${API_BASE}/tenants`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  getTenantNumbers: (tenantId: string) =>
    request<TenantNumber[]>(`${API_BASE}/tenants/${tenantId}/numbers`),
  
  addTenantNumber: (tenantId: string, data: Partial<TenantNumber>) =>
    request<TenantNumber>(`${API_BASE}/tenants/${tenantId}/numbers`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  deleteTenantNumber: (tenantId: string, numberId: string) =>
    request<{ success: boolean }>(`${API_BASE}/tenants/${tenantId}/numbers/${numberId}`, {
      method: 'DELETE',
    }),
  
  getTenantSettings: (tenantId: string) =>
    request<TenantSettings>(`${API_BASE}/tenants/${tenantId}/settings`),
  
  updateTenantSettings: (tenantId: string, data: Partial<TenantSettings>) =>
    request<TenantSettings>(`${API_BASE}/tenants/${tenantId}/settings`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  importContactsCSV: async (tenantId: string, file: File, globalTags: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('globalTags', globalTags);
    
    const response = await fetch(`${API_BASE}/tenants/${tenantId}/contacts/import`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }
    
    return response.json() as Promise<{ imported: number; failed: number; total: number }>;
  },
  
  getContacts: (tenantId: string, params?: { tag?: string; search?: string; page?: number }) => {
    const query = new URLSearchParams();
    if (params?.tag) query.set('tag', params.tag);
    if (params?.search) query.set('search', params.search);
    if (params?.page) query.set('page', params.page.toString());
    return request<{ contacts: Contact[]; pagination: { page: number; total: number; pages: number } }>(
      `${API_BASE}/tenants/${tenantId}/contacts?${query}`
    );
  },
  
  createContact: (tenantId: string, data: Partial<Contact>) =>
    request<Contact>(`${API_BASE}/tenants/${tenantId}/contacts`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  importContacts: (tenantId: string, contacts: Partial<Contact>[]) =>
    request<{ imported: number; failed: number }>(`${API_BASE}/tenants/${tenantId}/contacts/import`, {
      method: 'POST',
      body: JSON.stringify({ contacts }),
    }),
  
  getContact: (tenantId: string, contactId: string) =>
    request<Contact>(`${API_BASE}/tenants/${tenantId}/contacts/${contactId}`),
  
  addContactTag: (tenantId: string, contactId: string, tag: string) =>
    request<Contact>(`${API_BASE}/tenants/${tenantId}/contacts/${contactId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tagNames: [tag] }),
    }),
  
  removeContactTag: (tenantId: string, contactId: string, tag: string) =>
    request<{ success: boolean }>(`${API_BASE}/tenants/${tenantId}/contacts/${contactId}/tags/${tag}`, {
      method: 'DELETE',
    }),
  
  getTagsLegacy: (tenantId: string) =>
    request<string[]>(`${API_BASE}/tenants/${tenantId}/tags/legacy`),
  
  getSegments: (tenantId: string) =>
    request<Segment[]>(`${API_BASE}/tenants/${tenantId}/segments`),
  
  createSegment: (tenantId: string, data: { name: string; contactIds?: string[] }) =>
    request<Segment>(`${API_BASE}/tenants/${tenantId}/segments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  getSegment: (tenantId: string, segmentId: string) =>
    request<Segment>(`${API_BASE}/tenants/${tenantId}/segments/${segmentId}`),
  
  deleteSegment: (tenantId: string, segmentId: string) =>
    request<{ success: boolean }>(`${API_BASE}/tenants/${tenantId}/segments/${segmentId}`, {
      method: 'DELETE',
    }),
  
  getCampaigns: (tenantId: string) =>
    request<Campaign[]>(`${API_BASE}/tenants/${tenantId}/campaigns`),
  
  createCampaign: (tenantId: string, data: { name: string; type?: string; description?: string; segmentId?: string; steps?: { bodyTemplate: string; delayMinutes?: number; useAiAssist?: boolean }[] }) =>
    request<Campaign>(`${API_BASE}/tenants/${tenantId}/campaigns`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  scheduleCampaign: (tenantId: string, campaignId: string, startAt?: string) =>
    request<Campaign>(`${API_BASE}/tenants/${tenantId}/campaigns/${campaignId}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ startAt }),
    }),
  
  aiImproveMessage: (tenantId: string, text: string, goal?: string) =>
    request<{ text: string }>(`${API_BASE}/tenants/${tenantId}/campaigns/ai-improve`, {
      method: 'POST',
      body: JSON.stringify({ text, goal }),
    }),
  
  getConversations: (tenantId: string, params?: { status?: string; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.search) query.set('search', params.search);
    return request<Conversation[]>(`${API_BASE}/tenants/${tenantId}/conversations?${query}`);
  },
  
  getConversation: (tenantId: string, conversationId: string) =>
    request<Conversation>(`${API_BASE}/tenants/${tenantId}/conversations/${conversationId}`),
  
  createConversation: (tenantId: string, contactId: string) =>
    request<Conversation>(`${API_BASE}/tenants/${tenantId}/conversations`, {
      method: 'POST',
      body: JSON.stringify({ contactId }),
    }),
  
  startConversation: async (tenantId: string, contactId: string, message: string): Promise<{ conversationId: string }> => {
    const conversation = await request<Conversation>(`${API_BASE}/tenants/${tenantId}/conversations`, {
      method: 'POST',
      body: JSON.stringify({ contactId }),
    });
    await request<{ message: Message }>(`${API_BASE}/tenants/${tenantId}/conversations/${conversation.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: message }),
    });
    return { conversationId: conversation.id };
  },
  
  sendMessage: (tenantId: string, conversationId: string, body: string, fromNumber?: string) =>
    request<{ message: Message }>(`${API_BASE}/tenants/${tenantId}/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body, fromNumber }),
    }),
  
  suggestReplies: (tenantId: string, conversationId: string) =>
    request<{ suggestions: { text: string }[] }>(`${API_BASE}/tenants/${tenantId}/conversations/${conversationId}/suggest`, {
      method: 'POST',
    }),
  
  updateConversation: (tenantId: string, conversationId: string, data: { status?: string; aiAgentEnabled?: boolean }) =>
    request<Conversation>(`${API_BASE}/tenants/${tenantId}/conversations/${conversationId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  
  updateContact: (tenantId: string, contactId: string, data: { aiAgentEnabled?: boolean; firstName?: string; lastName?: string; email?: string; address?: string; city?: string; state?: string; zip?: string; customerType?: string }) =>
    request<Contact>(`${API_BASE}/tenants/${tenantId}/contacts/${contactId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  
  getSuppressions: (tenantId: string) =>
    request<Suppression[]>(`${API_BASE}/tenants/${tenantId}/suppressions`),
  
  createSuppression: (tenantId: string, phone: string, reason?: string) =>
    request<Suppression>(`${API_BASE}/tenants/${tenantId}/suppressions`, {
      method: 'POST',
      body: JSON.stringify({ phone, reason }),
    }),
  
  getAiPersonas: (tenantId: string) =>
    request<AiPersona[]>(`${API_BASE}/tenants/${tenantId}/ai-personas`),
  
  createAiPersona: (tenantId: string, data: Partial<AiPersona>) =>
    request<AiPersona>(`${API_BASE}/tenants/${tenantId}/ai-personas`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  getKBArticles: (tenantId: string) =>
    request<KBArticle[]>(`${API_BASE}/tenants/${tenantId}/kb-articles`),
  
  createKBArticle: (tenantId: string, data: Partial<KBArticle>) =>
    request<KBArticle>(`${API_BASE}/tenants/${tenantId}/kb-articles`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  getAnalyticsSummary: (tenantId: string, range: string = '30d') =>
    request<AnalyticsSummary>(`${API_BASE}/tenants/${tenantId}/analytics/summary?range=${range}`),
  
  getAnalyticsTimeline: (tenantId: string, range: string = '30d') =>
    request<TimelineDataPoint[]>(`${API_BASE}/tenants/${tenantId}/analytics/timeline?range=${range}`),
  
  getAnalyticsCampaigns: (tenantId: string, range: string = '30d') =>
    request<CampaignAnalytics[]>(`${API_BASE}/tenants/${tenantId}/analytics/campaigns?range=${range}`),
  
  getAnalyticsOptOuts: (tenantId: string, range: string = '30d') =>
    request<OptOutAnalytics>(`${API_BASE}/tenants/${tenantId}/analytics/opt-outs?range=${range}`),

  getIntegrations: (tenantId: string) =>
    request<{
      twilioConfigured: boolean;
      twilioAccountSid: string | null;
      twilioMessagingServiceSid: string | null;
      twilioValidatedAt: string | null;
    }>(`${API_BASE}/tenants/${tenantId}/integrations`),

  saveTwilioIntegration: (tenantId: string, data: { accountSid: string; authToken: string; messagingServiceSid?: string }) =>
    request<{ success: boolean; twilioConfigured: boolean; twilioValidatedAt: string }>(`${API_BASE}/tenants/${tenantId}/integrations/twilio`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  removeTwilioIntegration: (tenantId: string) =>
    request<{ success: boolean }>(`${API_BASE}/tenants/${tenantId}/integrations/twilio`, {
      method: 'DELETE',
    }),

  testTwilioIntegration: (tenantId: string) =>
    request<{ success: boolean; accountName?: string; status?: string; error?: string }>(`${API_BASE}/tenants/${tenantId}/integrations/twilio/test`, {
      method: 'POST',
    }),

  updateCampaignCompliance: (tenantId: string, campaignId: string, data: {
    consentVerified: boolean;
    optOutIncluded: boolean;
    quietHoursOk: boolean;
    contentReviewed: boolean;
    notes?: string;
  }) =>
    request<Campaign>(`${API_BASE}/tenants/${tenantId}/campaigns/${campaignId}/compliance`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getConsentRecords: (tenantId: string, options?: { contactId?: string; phone?: string }) =>
    request<Array<{
      id: string;
      tenantId: string;
      contactId: string;
      phone: string;
      consentGiven: boolean;
      consentSource: string;
      sourceDetails?: string;
      consentText?: string;
      givenAt: string;
      revokedAt?: string;
    }>>(`${API_BASE}/tenants/${tenantId}/consent?${new URLSearchParams(options as Record<string, string>).toString()}`),

  createConsentRecord: (tenantId: string, data: {
    contactId: string;
    phone: string;
    consentSource: string;
    sourceDetails?: string;
    consentText?: string;
  }) =>
    request<{ id: string }>(`${API_BASE}/tenants/${tenantId}/consent`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getConsentStats: (tenantId: string) =>
    request<{
      totalConsented: number;
      totalRevoked: number;
      recentConsents: number;
      bySource: Array<{ source: string; count: number }>;
    }>(`${API_BASE}/tenants/${tenantId}/consent/stats`),

  getTags: (tenantId: string) =>
    request<Tag[]>(`${API_BASE}/tenants/${tenantId}/tags`),

  createTag: (tenantId: string, data: { name: string; color?: string }) =>
    request<Tag>(`${API_BASE}/tenants/${tenantId}/tags`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteTag: (tenantId: string, tagId: string) =>
    request<{ success: boolean }>(`${API_BASE}/tenants/${tenantId}/tags/${tagId}`, {
      method: 'DELETE',
    }),

  addTagsToContact: (tenantId: string, contactId: string, tagNames: string[]) =>
    request<Contact>(`${API_BASE}/tenants/${tenantId}/contacts/${contactId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tagNames }),
    }),

  previewSegment: (tenantId: string, tagFilter: { mode: string; tagIds: string[] }) =>
    request<{ totalCount: number; preview: Array<{ id: string; firstName: string; lastName: string; phone: string; tags: string[] }> }>(
      `${API_BASE}/tenants/${tenantId}/segments/preview`,
      { method: 'POST', body: JSON.stringify({ tagFilter }) }
    ),

  getComplianceAnalytics: (tenantId: string, range: string = '30d') =>
    request<{
      summary: {
        totalOptOuts: number;
        totalComplaints: number;
        totalCarrierBlocked: number;
        totalQuietHoursBlocked: number;
        totalSuppressed: number;
        totalRateLimited: number;
        optOutRate: number;
        complaintRate: number;
        blockedRate: number;
      };
      alerts: Array<{ type: string; message: string; severity: 'warning' | 'critical' }>;
      trend: Array<{ date: string; optOuts: number; complaints: number; blocked: number }>;
      recentOptOuts: Array<{ id: string; phone: string; reason: string; createdAt: string }>;
    }>(`${API_BASE}/tenants/${tenantId}/analytics/compliance?range=${range}`),

  getSequences: (tenantId: string) =>
    request<any[]>(`${API_BASE}/tenants/${tenantId}/sequences`),

  createSequence: (tenantId: string, data: { name: string; description?: string; steps?: any[] }) =>
    request<any>(`${API_BASE}/tenants/${tenantId}/sequences`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getSequence: (tenantId: string, sequenceId: string) =>
    request<any>(`${API_BASE}/tenants/${tenantId}/sequences/${sequenceId}`),

  updateSequence: (tenantId: string, sequenceId: string, data: any) =>
    request<any>(`${API_BASE}/tenants/${tenantId}/sequences/${sequenceId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteSequence: (tenantId: string, sequenceId: string) =>
    request<{ success: boolean }>(`${API_BASE}/tenants/${tenantId}/sequences/${sequenceId}`, {
      method: 'DELETE',
    }),

  enrollInSequence: (tenantId: string, sequenceId: string, contactIds: string[]) =>
    request<{ enrolled: number; skipped: number }>(`${API_BASE}/tenants/${tenantId}/sequences/${sequenceId}/enroll`, {
      method: 'POST',
      body: JSON.stringify({ contactIds }),
    }),

  getTemplates: (tenantId: string, category?: string) => {
    const params = category ? `?category=${category}` : '';
    return request<any[]>(`${API_BASE}/tenants/${tenantId}/templates${params}`);
  },

  createTemplate: (tenantId: string, data: { name: string; category?: string; bodyTemplate: string; mediaUrl?: string }) =>
    request<any>(`${API_BASE}/tenants/${tenantId}/templates`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateTemplate: (tenantId: string, templateId: string, data: { name: string; category?: string; bodyTemplate: string; mediaUrl?: string }) =>
    request<any>(`${API_BASE}/tenants/${tenantId}/templates/${templateId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteTemplate: (tenantId: string, templateId: string) =>
    request<{ success: boolean }>(`${API_BASE}/tenants/${tenantId}/templates/${templateId}`, {
      method: 'DELETE',
    }),

  seedSystemTemplates: () =>
    request<{ message: string; count: number }>(`${API_BASE}/templates/seed`, { method: 'POST' }),

  getTrackedLinks: (tenantId: string) =>
    request<any[]>(`${API_BASE}/tenants/${tenantId}/links`),

  createTrackedLink: (tenantId: string, originalUrl: string, options?: { campaignId?: string }) =>
    request<any>(`${API_BASE}/tenants/${tenantId}/links`, {
      method: 'POST',
      body: JSON.stringify({ originalUrl, ...options }),
    }),

  getLinkAnalytics: (tenantId: string, linkId: string) =>
    request<{ link: any; totalClicks: number; uniqueContacts: number }>(`${API_BASE}/tenants/${tenantId}/links/${linkId}/analytics`),

  getBranding: (tenantId: string) =>
    request<any>(`${API_BASE}/tenants/${tenantId}/branding`),

  updateBranding: (tenantId: string, data: any) =>
    request<any>(`${API_BASE}/tenants/${tenantId}/branding`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getBilling: (tenantId: string) =>
    request<{ plan: any; usage: any; availablePlans: any[] }>(`${API_BASE}/tenants/${tenantId}/billing`),

  upgradePlan: (tenantId: string, planType: string) =>
    request<{ success: boolean; plan: any; message: string }>(`${API_BASE}/tenants/${tenantId}/billing/upgrade`, {
      method: 'POST',
      body: JSON.stringify({ planType }),
    }),

  getUsageHistory: (tenantId: string) =>
    request<any[]>(`${API_BASE}/tenants/${tenantId}/billing/usage-history`),

  getCampaignVariants: (tenantId: string, campaignId: string) =>
    request<any[]>(`${API_BASE}/tenants/${tenantId}/campaigns/${campaignId}/variants`),

  createCampaignVariant: (tenantId: string, campaignId: string, data: { name: string; bodyTemplate: string; splitPercent?: number }) =>
    request<any>(`${API_BASE}/tenants/${tenantId}/campaigns/${campaignId}/variants`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getABResults: (tenantId: string, campaignId: string) =>
    request<any[]>(`${API_BASE}/tenants/${tenantId}/campaigns/${campaignId}/ab-results`),

  getServiceTitanConfig: (tenantId: string) =>
    request<ServiceTitanConfig | null>(`${API_BASE}/tenants/${tenantId}/servicetitan-config`),

  saveServiceTitanConfig: (tenantId: string, data: {
    tenantApiBaseUrl: string;
    serviceTitanTenantId: string;
    appKey?: string;
    clientId: string;
    clientSecret?: string;
    bookingProvider: string;
    bookingProviderId?: string;
    enabled: boolean;
  }) =>
    request<ServiceTitanConfig>(`${API_BASE}/tenants/${tenantId}/servicetitan-config`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  testServiceTitanConnection: (tenantId: string) =>
    request<{ 
      ok: boolean; 
      error?: string;
      details?: {
        oauth: boolean;
        apiAccess: boolean;
        bookingsAccess: boolean;
      };
    }>(`${API_BASE}/tenants/${tenantId}/servicetitan-test`, {
      method: 'POST',
    }),

  syncServiceTitanContacts: (tenantId: string) =>
    request<{
      success: boolean;
      totalContacts: number;
      matchedContacts: number;
      newlyTagged: number;
      errors: number;
    }>(`${API_BASE}/tenants/${tenantId}/servicetitan/sync-contacts`, {
      method: 'POST',
    }),

  importServiceTitanContacts: (tenantId: string) =>
    request<{
      success: boolean;
      totalFetched: number;
      imported: number;
      skippedDuplicates: number;
      errors: number;
    }>(`${API_BASE}/tenants/${tenantId}/servicetitan/import-contacts`, {
      method: 'POST',
    }),

  getServiceTitanSyncStatus: (tenantId: string) =>
    request<{
      taggedCount: number;
      totalContacts: number;
      lastSync?: string;
    }>(`${API_BASE}/tenants/${tenantId}/servicetitan/sync-status`),

  testServiceTitanAvailability: (tenantId: string) =>
    request<{
      success: boolean;
      slots: Array<{
        date: string;
        dayOfWeek: string;
        startTime: string;
        endTime: string;
        displayText: string;
      }>;
      error?: string;
      source?: string;
    }>(`${API_BASE}/tenants/${tenantId}/servicetitan/test-availability`, {
      method: 'POST',
    }),

  getAIAgentConfig: (tenantId: string) =>
    request<AIAgentConfig>(`${API_BASE}/tenants/${tenantId}/ai-agent/config`),

  updateAIAgentConfig: (tenantId: string, data: Partial<AIAgentConfig>) =>
    request<AIAgentConfig>(`${API_BASE}/tenants/${tenantId}/ai-agent/config`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

export interface AIAgentConfig {
  id: string;
  tenantId: string;
  enabled: boolean;
  autoRespond: boolean;
  maxMessagesPerSession: number;
  qualificationThreshold: number;
  defaultBusinessUnitId?: string | null;
  defaultJobTypeId?: string | null;
  defaultCampaignId?: string | null;
  responseDelaySeconds: number;
  createdAt: string;
  updatedAt: string;
}
