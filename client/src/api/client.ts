const API_BASE = '/api';

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
  tags?: ContactTag[];
  conversations?: Conversation[];
}

export interface ContactTag {
  id: string;
  contactId: string;
  tag: string;
}

export interface Conversation {
  id: string;
  tenantId: string;
  contactId: string;
  status: 'OPEN' | 'CLOSED';
  lastMessageAt: string;
  contact?: Contact;
  messages?: Message[];
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

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
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
    request<ContactTag>(`${API_BASE}/tenants/${tenantId}/contacts/${contactId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tag }),
    }),
  
  removeContactTag: (tenantId: string, contactId: string, tag: string) =>
    request<{ success: boolean }>(`${API_BASE}/tenants/${tenantId}/contacts/${contactId}/tags/${tag}`, {
      method: 'DELETE',
    }),
  
  getSegments: (tenantId: string) =>
    request<Segment[]>(`${API_BASE}/tenants/${tenantId}/segments`),
  
  createSegment: (tenantId: string, data: { name: string; contactIds?: string[] }) =>
    request<Segment>(`${API_BASE}/tenants/${tenantId}/segments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  getSegment: (tenantId: string, segmentId: string) =>
    request<Segment>(`${API_BASE}/tenants/${tenantId}/segments/${segmentId}`),
  
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
  
  sendMessage: (tenantId: string, conversationId: string, body: string, fromNumber?: string) =>
    request<{ message: Message }>(`${API_BASE}/tenants/${tenantId}/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body, fromNumber }),
    }),
  
  suggestReplies: (tenantId: string, conversationId: string) =>
    request<{ suggestions: { text: string }[] }>(`${API_BASE}/tenants/${tenantId}/conversations/${conversationId}/suggest`, {
      method: 'POST',
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
};
