import { prisma } from '../../index';
import { getServiceTitanToken } from '../serviceTitanClient';

/**
 * Minimal ServiceTitan client for the virtual CSR.
 *
 * Kept separate from the legacy agent's helpers on purpose: those invent
 * time windows when capacity is unavailable and build appointment times
 * without a timezone. This client only ever offers windows ServiceTitan's
 * Capacity API returned, books with the exact UTC times it returned, and
 * surfaces every error instead of falling back.
 */

export class STError extends Error {
  constructor(message: string, public status?: number, public body?: string) {
    super(message);
  }
}

interface STContext {
  baseUrl: string;
  tenant: string;
  headers: Record<string, string>;
}

async function ctx(tenantId: string): Promise<STContext> {
  const config = await prisma.serviceTitanConfig.findUnique({ where: { tenantId } });
  if (!config || !config.enabled) throw new STError('ServiceTitan is not configured for this account');
  const token = await getServiceTitanToken(config);
  return {
    baseUrl: config.tenantApiBaseUrl.replace(/\/$/, ''),
    tenant: config.serviceTitanTenantId,
    headers: {
      Authorization: `Bearer ${token}`,
      'ST-App-Key': config.appKey,
      'Content-Type': 'application/json',
    },
  };
}

async function st<T>(tenantId: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const c = await ctx(tenantId);
  const url = `${c.baseUrl}/${path.replace('{tenant}', c.tenant)}`;
  const res = await fetch(url, {
    method,
    headers: c.headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new STError(`ServiceTitan ${method} ${path.split('?')[0]} failed (${res.status})`, res.status, text.slice(0, 1000));
  }
  return (text ? JSON.parse(text) : {}) as T;
}

const tenPhone = (phone: string) => {
  const d = phone.replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
};

// ---------------------------------------------------------------- reads

export interface STAddress { street?: string; unit?: string; city?: string; state?: string; zip?: string }
export interface STCustomerSummary { id: number; name: string; type: string; address?: STAddress; doNotService?: boolean }
export interface STLocationSummary { id: number; customerId: number; name: string; address?: STAddress }

export async function findCustomersByPhone(tenantId: string, phone: string): Promise<STCustomerSummary[]> {
  const r = await st<{ data: STCustomerSummary[] }>(tenantId, 'GET',
    `crm/v2/tenant/{tenant}/customers?phone=${encodeURIComponent(tenPhone(phone))}&active=True&pageSize=10`);
  return r.data ?? [];
}

export async function searchCustomers(tenantId: string, q: { name?: string; street?: string; zip?: string }): Promise<STCustomerSummary[]> {
  if (q.street || q.zip) {
    const params = new URLSearchParams({ active: 'True', pageSize: '10' });
    if (q.street) params.set('street', q.street);
    if (q.zip) params.set('zip', q.zip);
    const locs = await st<{ data: STLocationSummary[] }>(tenantId, 'GET', `crm/v2/tenant/{tenant}/locations?${params}`);
    const ids = [...new Set((locs.data ?? []).map((l) => l.customerId))].slice(0, 10);
    if (ids.length === 0) return [];
    const r = await st<{ data: STCustomerSummary[] }>(tenantId, 'GET', `crm/v2/tenant/{tenant}/customers?ids=${ids.join(',')}`);
    return r.data ?? [];
  }
  if (q.name) {
    const r = await st<{ data: STCustomerSummary[] }>(tenantId, 'GET',
      `crm/v2/tenant/{tenant}/customers?name=${encodeURIComponent(q.name)}&active=True&pageSize=10`);
    return r.data ?? [];
  }
  return [];
}

export async function getLocations(tenantId: string, customerId: number): Promise<STLocationSummary[]> {
  const r = await st<{ data: STLocationSummary[] }>(tenantId, 'GET',
    `crm/v2/tenant/{tenant}/locations?customerId=${customerId}&active=True&pageSize=20`);
  return r.data ?? [];
}

export async function getCustomerSnapshot(tenantId: string, customerId: number) {
  const [locations, memberships, jobs, estimates] = await Promise.all([
    getLocations(tenantId, customerId),
    st<{ data: any[] }>(tenantId, 'GET', `memberships/v2/tenant/{tenant}/memberships?customerIds=${customerId}&status=Active&pageSize=10`).catch(() => ({ data: [] })),
    st<{ data: any[] }>(tenantId, 'GET', `jpm/v2/tenant/{tenant}/jobs?customerId=${customerId}&pageSize=5&sort=-createdOn`).catch(() => ({ data: [] })),
    st<{ data: any[] }>(tenantId, 'GET', `sales/v2/tenant/{tenant}/estimates?customerId=${customerId}&status=Open&pageSize=5`).catch(() => ({ data: [] })),
  ]);
  return {
    locations: locations.map((l) => ({ locationId: l.id, name: l.name, address: l.address })),
    activeMemberships: (memberships.data ?? []).map((m) => ({ membershipTypeId: m.membershipTypeId, from: m.from, to: m.to, locationId: m.locationId })),
    recentJobs: (jobs.data ?? []).map((j) => ({
      jobId: j.id, status: j.jobStatus, summary: String(j.summary ?? '').replace(/<[^>]+>/g, '').slice(0, 200),
      createdOn: j.createdOn, completedOn: j.completedOn, businessUnitId: j.businessUnitId, jobTypeId: j.jobTypeId,
    })),
    openEstimates: (estimates.data ?? []).map((e) => ({ estimateId: e.id, name: e.name, subtotal: e.subtotal, createdOn: e.createdOn })),
  };
}

export interface CapacityWindow {
  startUtc: string;
  endUtc: string;
  isAvailable: boolean;
  openAvailability: number;
  businessUnitIds: number[];
}

/**
 * Open arrival windows straight from the dispatch board via the Capacity API.
 * Never invents windows: an error here must stop the booking.
 */
export async function getCapacity(
  tenantId: string,
  opts: { businessUnitId: number; jobTypeId?: number; startsOnOrAfter: string; endsOnOrBefore: string }
): Promise<CapacityWindow[]> {
  const r = await st<{ availabilities?: any[] }>(tenantId, 'POST', 'dispatch/v2/tenant/{tenant}/capacity', {
    startsOnOrAfter: opts.startsOnOrAfter,
    endsOnOrBefore: opts.endsOnOrBefore,
    businessUnitIds: [opts.businessUnitId],
    jobTypeId: opts.jobTypeId,
    skillBasedAvailability: true,
  });
  return (r.availabilities ?? [])
    .map((a) => ({
      startUtc: a.startUtc,
      endUtc: a.endUtc,
      isAvailable: !!a.isAvailable,
      openAvailability: Number(a.openAvailability ?? 0),
      businessUnitIds: a.businessUnitIds ?? [],
    }))
    .filter((w) => w.startUtc && w.endUtc);
}

// ---------------------------------------------------------------- writes

export async function createCustomer(
  tenantId: string,
  data: { name: string; phone: string; email?: string; address: Required<Pick<STAddress, 'street' | 'city' | 'state' | 'zip'>> & { unit?: string } }
): Promise<{ customerId: number; locationId: number }> {
  const address = { ...data.address, country: 'USA' };
  const contacts: any[] = [{ type: 'MobilePhone', value: tenPhone(data.phone), memo: 'Added by IntelliSend virtual CSR' }];
  if (data.email) contacts.push({ type: 'Email', value: data.email });
  const r = await st<{ id: number; locations?: Array<{ id: number }> }>(tenantId, 'POST', 'crm/v2/tenant/{tenant}/customers', {
    name: data.name,
    type: 'Residential',
    address,
    contacts,
    locations: [{ name: data.name, address, contacts: [] }],
  });
  let locationId = r.locations?.[0]?.id;
  if (!locationId) locationId = (await getLocations(tenantId, r.id))[0]?.id;
  if (!locationId) throw new STError('Customer was created but ServiceTitan returned no location');
  return { customerId: r.id, locationId };
}

/** Creates the job with one appointment and no technician, so it lands unassigned on the board. */
export async function createUnassignedJob(
  tenantId: string,
  data: { customerId: number; locationId: number; businessUnitId: number; jobTypeId: number; campaignId: number; summary: string; startUtc: string; endUtc: string; priority?: 'Normal' | 'High' | 'Urgent' }
): Promise<{ jobId: number; appointmentId: number | null; jobNumber?: string }> {
  const r = await st<{ id: number; jobNumber?: string; firstAppointmentId?: number }>(tenantId, 'POST', 'jpm/v2/tenant/{tenant}/jobs', {
    customerId: data.customerId,
    locationId: data.locationId,
    businessUnitId: data.businessUnitId,
    jobTypeId: data.jobTypeId,
    campaignId: data.campaignId,
    priority: data.priority ?? 'Normal',
    summary: data.summary,
    appointments: [{
      start: data.startUtc,
      end: data.endUtc,
      arrivalWindowStart: data.startUtc,
      arrivalWindowEnd: data.endUtc,
    }],
  });
  return { jobId: r.id, appointmentId: r.firstAppointmentId ?? null, jobNumber: r.jobNumber };
}

export async function addJobNote(tenantId: string, jobId: number, text: string) {
  return st(tenantId, 'POST', `jpm/v2/tenant/{tenant}/jobs/${jobId}/notes`, { text, pinToTop: false });
}

export async function addCustomerNote(tenantId: string, customerId: number, text: string) {
  return st(tenantId, 'POST', `crm/v2/tenant/{tenant}/customers/${customerId}/notes`, { text, pinToTop: false });
}

export async function addCustomerContact(tenantId: string, customerId: number, type: 'MobilePhone' | 'Phone' | 'Email', value: string) {
  return st(tenantId, 'POST', `crm/v2/tenant/{tenant}/customers/${customerId}/contacts`, {
    type,
    value: type === 'Email' ? value : tenPhone(value),
    memo: 'Confirmed by customer over text (IntelliSend virtual CSR)',
  });
}

// ---------------------------------------------------------------- setup helpers

/** Active job types and business units, for configuring what the agent may book. */
export async function listBookingSetup(tenantId: string) {
  const [jobTypes, businessUnits] = await Promise.all([
    st<{ data: any[] }>(tenantId, 'GET', 'jpm/v2/tenant/{tenant}/job-types?active=True&pageSize=500'),
    st<{ data: any[] }>(tenantId, 'GET', 'settings/v2/tenant/{tenant}/business-units?active=True&pageSize=100'),
  ]);
  return {
    jobTypes: (jobTypes.data ?? []).map((j) => ({ id: j.id, name: j.name, businessUnitIds: j.businessUnitIds ?? [] })),
    businessUnits: (businessUnits.data ?? []).map((b) => ({ id: b.id, name: b.name })),
  };
}
