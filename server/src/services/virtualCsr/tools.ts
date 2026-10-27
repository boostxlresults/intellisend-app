import type Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../../index';
import * as stApi from './stApi';

/**
 * Virtual CSR tools: definitions, permission policy, guards and executors.
 *
 * Permission model (enforced here, not in the prompt):
 *   read      - always runs
 *   internal  - always runs (hand-off, no ServiceTitan writes)
 *   write     - shadow: proposed for approval; supervised/autonomous: runs
 *   sensitive - shadow and supervised: proposed for approval; autonomous: runs
 *   reply     - ends the turn
 *
 * There is deliberately no tool for refunds, payments, discounts, cancelling
 * jobs or memberships, or changing prices. The agent cannot do what it has
 * no tool for.
 */

export type AgentMode = 'shadow' | 'supervised' | 'autonomous';
type Tier = 'read' | 'internal' | 'write' | 'sensitive' | 'reply';

export interface BookableJobType {
  key: string;
  label: string;
  jobTypeId: number;
  businessUnitId: number;
  whenToUse: string;
}

export interface OfferedSlot {
  slotId: string;
  startUtc: string;
  endUtc: string;
  jobTypeKey: string;
  label: string;
}

/** Everything the agent has legitimately learned in this conversation. */
export interface KnownIds {
  customers: Set<number>;
  locationOwner: Map<number, number>; // locationId -> customerId
  jobs: Set<number>;
  slots: Map<string, OfferedSlot>;
}

export interface ToolContext {
  tenantId: string;
  conversationId: string;
  contactId: string;
  contactPhone: string;
  turnId: string;
  mode: AgentMode;
  timezone: string;
  campaignId: number | null;
  jobTypes: BookableJobType[];
  known: KnownIds;
  emergencyAlertPhone: string | null;
}

export interface ToolOutcome {
  status: 'READ' | 'EXECUTED' | 'PROPOSED' | 'BLOCKED' | 'FAILED';
  result: Record<string, unknown>;
  error?: string;
  endsTurn?: { kind: 'reply'; text: string } | { kind: 'no_reply'; reason: string };
}

// ------------------------------------------------------------------ helpers

function fmtWindow(startUtc: string, endUtc: string, tz: string): string {
  const s = new Date(startUtc);
  const e = new Date(endUtc);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' }).format(s);
  const t = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
    .format(d).replace(':00', '');
  return `${day}, ${t(s)} to ${t(e)}`;
}

function localDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function rememberCustomers(known: KnownIds, customers: Array<{ id: number }>, locations: Array<{ id: number; customerId: number }> = []) {
  customers.forEach((c) => known.customers.add(c.id));
  locations.forEach((l) => known.locationOwner.set(l.id, l.customerId));
}

/** Resolve "pending:<actionId>" placeholders from a create_customer proposal once it has executed. */
async function resolveId(value: unknown, field: 'customerId' | 'locationId'): Promise<number> {
  if (typeof value === 'number') return value;
  const s = String(value);
  if (s.startsWith('pending:')) {
    const action = await prisma.csrAgentAction.findUnique({ where: { id: s.slice(8) } });
    const r = action?.result as any;
    if (!action || !['EXECUTED', 'APPROVED_EXECUTED'].includes(action.status) || !r?.[field]) {
      throw new Error('This depends on a new customer account that has not been created yet');
    }
    return Number(r[field]);
  }
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${field}`);
  return n;
}

// ---------------------------------------------------------------- definitions

const TIERS: Record<string, Tier> = {
  lookup_customer_by_phone: 'read',
  search_customers: 'read',
  get_customer_details: 'read',
  check_availability: 'read',
  book_appointment: 'write',
  create_customer: 'sensitive',
  add_customer_contact: 'write',
  add_note: 'write',
  hand_off_to_human: 'internal',
  send_reply: 'reply',
  end_without_reply: 'reply',
};

export function toolDefinitions(jobTypes: BookableJobType[]): Anthropic.Tool[] {
  const jobTypeKeys = jobTypes.map((j) => j.key);
  return [
    {
      name: 'lookup_customer_by_phone',
      description: 'Find ServiceTitan customers by phone number. Defaults to the number this customer is texting from. Use this first in every new conversation.',
      input_schema: {
        type: 'object',
        properties: { phone: { type: 'string', description: 'Optional 10-digit phone. Omit to use the texting number.' } },
      },
    },
    {
      name: 'search_customers',
      description: 'Search ServiceTitan customers by name or by service address. Use when the phone lookup finds nothing or the customer says they have an account under another number.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          street: { type: 'string', description: 'Street address, e.g. "1234 E Speedway"' },
          zip: { type: 'string' },
        },
      },
    },
    {
      name: 'get_customer_details',
      description: 'Service locations, active memberships, recent jobs and open estimates for a customer you already found.',
      input_schema: {
        type: 'object',
        properties: { customer_id: { type: 'number' } },
        required: ['customer_id'],
      },
    },
    {
      name: 'check_availability',
      description: 'Real open arrival windows from the dispatch board for one kind of job. Only offer windows this tool returns.',
      input_schema: {
        type: 'object',
        properties: {
          job_type_key: { type: 'string', enum: jobTypeKeys.length ? jobTypeKeys : ['none'] },
          from_date: { type: 'string', description: 'YYYY-MM-DD, local time. Defaults to today.' },
          days: { type: 'number', description: 'How many days to look ahead (1-14). Default 5.' },
        },
        required: ['job_type_key'],
      },
    },
    {
      name: 'book_appointment',
      description: 'Book the job on the dispatch board as unassigned (dispatch assigns the technician). Only after the customer has picked a window AND confirmed the service address.',
      input_schema: {
        type: 'object',
        properties: {
          customer_id: { type: ['number', 'string'], description: 'From a lookup, or the pending ID returned by create_customer' },
          location_id: { type: ['number', 'string'] },
          slot_id: { type: 'string', description: 'slot_id returned by check_availability' },
          job_type_key: { type: 'string', enum: jobTypeKeys.length ? jobTypeKeys : ['none'] },
          summary: { type: 'string', description: 'What the technician needs to know, in plain words: the problem, symptoms, access notes, pets, gate codes.' },
          priority: { type: 'string', enum: ['Normal', 'High', 'Urgent'] },
        },
        required: ['customer_id', 'location_id', 'slot_id', 'job_type_key', 'summary'],
      },
    },
    {
      name: 'create_customer',
      description: 'Create a new ServiceTitan account. Only after searching by phone AND address found no match. Uses the number they are texting from.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'First and last name' },
          street: { type: 'string' }, unit: { type: 'string' },
          city: { type: 'string' }, state: { type: 'string' }, zip: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['name', 'street', 'city', 'state', 'zip'],
      },
    },
    {
      name: 'add_customer_contact',
      description: 'Add a phone or email to an existing account after the customer confirms it.',
      input_schema: {
        type: 'object',
        properties: {
          customer_id: { type: 'number' },
          type: { type: 'string', enum: ['MobilePhone', 'Phone', 'Email'] },
          value: { type: 'string' },
        },
        required: ['customer_id', 'type', 'value'],
      },
    },
    {
      name: 'add_note',
      description: 'Add a note to a job or customer in ServiceTitan so the office and technician see it.',
      input_schema: {
        type: 'object',
        properties: {
          target: { type: 'string', enum: ['job', 'customer'] },
          id: { type: 'number', description: 'Job ID or customer ID' },
          text: { type: 'string' },
        },
        required: ['target', 'id', 'text'],
      },
    },
    {
      name: 'hand_off_to_human',
      description: 'Bring in a person. Use for emergencies, anger or complaints, billing or refund questions, cancellations, anything you are unsure about, or when the customer asks for a person.',
      input_schema: {
        type: 'object',
        properties: {
          urgency: { type: 'string', enum: ['emergency', 'soon', 'normal'] },
          reason: { type: 'string' },
          summary_for_csr: { type: 'string', description: 'Everything the CSR needs so the customer never repeats themselves.' },
        },
        required: ['urgency', 'reason', 'summary_for_csr'],
      },
    },
    {
      name: 'send_reply',
      description: 'Send your text message to the customer. This ends your turn. Keep it short, warm and clear: one to three sentences.',
      input_schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
    {
      name: 'end_without_reply',
      description: 'End the turn without texting back, when no reply is needed (for example the customer said "thanks" after everything was settled).',
      input_schema: {
        type: 'object',
        properties: { reason: { type: 'string' } },
        required: ['reason'],
      },
    },
  ];
}

// ---------------------------------------------------------------- guards

/** Validate a write before it runs or is proposed. Returns an error string to block it. */
async function guard(tool: string, input: any, c: ToolContext): Promise<string | null> {
  const isPending = (v: unknown) => typeof v === 'string' && v.startsWith('pending:');
  switch (tool) {
    case 'book_appointment': {
      if (!c.campaignId) return 'No ServiceTitan campaign is configured for agent bookings. Hand off to a human.';
      const jt = c.jobTypes.find((j) => j.key === input.job_type_key);
      if (!jt) return `Unknown job type "${input.job_type_key}".`;
      const slot = c.known.slots.get(String(input.slot_id));
      if (!slot) return 'That slot_id was not offered in this conversation. Call check_availability first.';
      if (slot.jobTypeKey !== jt.key) return 'That slot was checked for a different kind of job. Check availability again for this job type.';
      if (new Date(slot.startUtc).getTime() < Date.now()) return 'That window has already started or passed. Offer new windows.';
      if (isPending(input.customer_id) || isPending(input.location_id)) {
        if (input.customer_id !== input.location_id) return 'Pending customer and location IDs must come from the same create_customer call.';
        return null;
      }
      const cid = Number(input.customer_id);
      const lid = Number(input.location_id);
      if (!c.known.customers.has(cid)) return 'That customer was not found by a lookup in this conversation.';
      if (c.known.locationOwner.get(lid) !== cid) return 'That location does not belong to that customer. Call get_customer_details.';
      return null;
    }
    case 'add_customer_contact':
      return c.known.customers.has(Number(input.customer_id)) ? null : 'That customer was not found by a lookup in this conversation.';
    case 'add_note':
      if (input.target === 'customer') return c.known.customers.has(Number(input.id)) ? null : 'That customer was not found in this conversation.';
      return c.known.jobs.has(Number(input.id)) ? null : 'That job was not booked or looked up in this conversation.';
    case 'create_customer': {
      // Must have actually searched before creating, to avoid duplicates.
      const searched = await prisma.csrAgentAction.count({
        where: { conversationId: c.conversationId, tool: { in: ['lookup_customer_by_phone', 'search_customers'] }, status: 'READ' },
      });
      if (searched === 0) return 'Search by phone and by address before creating a new account.';
      return null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------- executors

async function execute(tool: string, input: any, c: ToolContext, actionId: string): Promise<Record<string, unknown>> {
  switch (tool) {
    case 'lookup_customer_by_phone': {
      const customers = await stApi.findCustomersByPhone(c.tenantId, input.phone || c.contactPhone);
      const withLocs = await Promise.all(customers.slice(0, 5).map(async (cu) => ({
        ...cu, locations: await stApi.getLocations(c.tenantId, cu.id),
      })));
      rememberCustomers(c.known, withLocs, withLocs.flatMap((w) => w.locations));
      return {
        found: withLocs.length,
        customers: withLocs.map((w) => ({
          customer_id: w.id, name: w.name, type: w.type, do_not_service: w.doNotService ?? false,
          locations: w.locations.map((l) => ({ location_id: l.id, address: l.address })),
        })),
      };
    }
    case 'search_customers': {
      const customers = await stApi.searchCustomers(c.tenantId, input);
      const withLocs = await Promise.all(customers.slice(0, 5).map(async (cu) => ({
        ...cu, locations: await stApi.getLocations(c.tenantId, cu.id),
      })));
      rememberCustomers(c.known, withLocs, withLocs.flatMap((w) => w.locations));
      return {
        found: withLocs.length,
        customers: withLocs.map((w) => ({
          customer_id: w.id, name: w.name,
          locations: w.locations.map((l) => ({ location_id: l.id, address: l.address })),
        })),
      };
    }
    case 'get_customer_details': {
      const cid = Number(input.customer_id);
      if (!c.known.customers.has(cid)) throw new Error('Look the customer up first.');
      const snap = await stApi.getCustomerSnapshot(c.tenantId, cid);
      snap.locations.forEach((l) => c.known.locationOwner.set(l.locationId, cid));
      snap.recentJobs.forEach((j) => c.known.jobs.add(j.jobId));
      const tags = await prisma.contactTag.findMany({
        where: { contact: { tenantId: c.tenantId, stCustomerId: String(cid) }, tag: { isSystem: true, name: { startsWith: 'ST ' } } },
        select: { tag: { select: { name: true } } },
      });
      return { ...snap, intellisend_segments: tags.map((t) => t.tag.name) };
    }
    case 'check_availability': {
      const jt = c.jobTypes.find((j) => j.key === input.job_type_key);
      if (!jt) throw new Error(`Unknown job type ${input.job_type_key}`);
      const days = Math.min(Math.max(Number(input.days) || 5, 1), 14);
      const from = input.from_date && /^\d{4}-\d{2}-\d{2}$/.test(input.from_date) ? input.from_date : localDate(new Date(), c.timezone);
      const until = localDate(new Date(new Date(`${from}T12:00:00Z`).getTime() + days * 86_400_000), c.timezone);
      const windows = await stApi.getCapacity(c.tenantId, {
        businessUnitId: jt.businessUnitId, jobTypeId: jt.jobTypeId,
        startsOnOrAfter: from, endsOnOrBefore: until,
      });
      const open = windows
        .filter((w) => w.isAvailable && w.openAvailability > 0 && new Date(w.startUtc).getTime() > Date.now() + 60 * 60_000)
        .sort((a, b) => a.startUtc.localeCompare(b.startUtc))
        .slice(0, 8);
      const slots = open.map((w, i) => {
        const slot: OfferedSlot = {
          slotId: `${actionId.slice(0, 8)}-${i + 1}`,
          startUtc: w.startUtc, endUtc: w.endUtc, jobTypeKey: jt.key,
          label: fmtWindow(w.startUtc, w.endUtc, c.timezone),
        };
        c.known.slots.set(slot.slotId, slot);
        return slot;
      });
      return {
        job_type: jt.label,
        windows: slots.map((s) => ({ slot_id: s.slotId, arrival_window: s.label })),
        note: slots.length === 0 ? 'No open windows in that range. Try later dates or hand off.' : 'Offer two or three of these, never invent others.',
        _slots: slots,
      };
    }
    case 'book_appointment': {
      const jt = c.jobTypes.find((j) => j.key === input.job_type_key)!;
      const slot = c.known.slots.get(String(input.slot_id))!;
      const customerId = await resolveId(input.customer_id, 'customerId');
      const locationId = await resolveId(input.location_id, 'locationId');
      // Re-check the board right before booking: the window may have filled.
      const day = localDate(new Date(slot.startUtc), c.timezone);
      const fresh = await stApi.getCapacity(c.tenantId, {
        businessUnitId: jt.businessUnitId, jobTypeId: jt.jobTypeId, startsOnOrAfter: day, endsOnOrBefore: day,
      });
      const still = fresh.find((w) => w.startUtc === slot.startUtc && w.endUtc === slot.endUtc);
      if (!still || !still.isAvailable || still.openAvailability <= 0) {
        throw new Error(`The ${slot.label} window just filled up. Check availability again and offer new windows.`);
      }
      const job = await stApi.createUnassignedJob(c.tenantId, {
        customerId, locationId, businessUnitId: jt.businessUnitId, jobTypeId: jt.jobTypeId,
        campaignId: c.campaignId!, summary: `${input.summary}\n\n(Booked by text via IntelliSend virtual CSR)`,
        startUtc: slot.startUtc, endUtc: slot.endUtc, priority: input.priority,
      });
      c.known.jobs.add(job.jobId);
      await prisma.conversation.update({ where: { id: c.conversationId }, data: { serviceTitanJobId: String(job.jobId) } });
      return { booked: true, job_id: job.jobId, job_number: job.jobNumber, arrival_window: slot.label, _jobs: [job.jobId] };
    }
    case 'create_customer': {
      const r = await stApi.createCustomer(c.tenantId, {
        name: input.name, phone: c.contactPhone, email: input.email,
        address: { street: input.street, unit: input.unit, city: input.city, state: input.state, zip: input.zip },
      });
      c.known.customers.add(r.customerId);
      c.known.locationOwner.set(r.locationId, r.customerId);
      return { created: true, customerId: r.customerId, locationId: r.locationId, customer_id: r.customerId, location_id: r.locationId };
    }
    case 'add_customer_contact':
      await stApi.addCustomerContact(c.tenantId, Number(input.customer_id), input.type, input.value);
      return { added: true };
    case 'add_note':
      if (input.target === 'job') await stApi.addJobNote(c.tenantId, Number(input.id), input.text);
      else await stApi.addCustomerNote(c.tenantId, Number(input.id), input.text);
      return { added: true };
    default:
      throw new Error(`Unknown tool ${tool}`);
  }
}

/** Rebuild what the agent has learned from earlier turns in this conversation. */
export async function hydrateKnown(conversationId: string): Promise<KnownIds> {
  const known: KnownIds = { customers: new Set(), locationOwner: new Map(), jobs: new Set(), slots: new Map() };
  const actions = await prisma.csrAgentAction.findMany({
    where: {
      conversationId,
      status: { in: ['READ', 'EXECUTED', 'APPROVED_EXECUTED'] },
      createdAt: { gt: new Date(Date.now() - 14 * 86_400_000) },
    },
    orderBy: { createdAt: 'asc' },
  });
  for (const a of actions) {
    const r = a.result as any;
    if (!r) continue;
    for (const cu of r.customers ?? []) {
      known.customers.add(cu.customer_id);
      for (const l of cu.locations ?? []) known.locationOwner.set(l.location_id, cu.customer_id);
    }
    if (a.tool === 'get_customer_details') {
      const cid = Number((a.input as any)?.customer_id);
      for (const l of r.locations ?? []) known.locationOwner.set(l.locationId, cid);
      for (const j of r.recentJobs ?? []) known.jobs.add(j.jobId);
    }
    if (r.customerId && r.locationId) {
      known.customers.add(r.customerId);
      known.locationOwner.set(r.locationId, r.customerId);
    }
    for (const s of r._slots ?? []) known.slots.set(s.slotId, s);
    for (const j of r._jobs ?? []) known.jobs.add(j);
  }
  return known;
}

/** Strip internal bookkeeping fields before showing a result to the model. */
function forModel(result: Record<string, unknown>): Record<string, unknown> {
  const { _slots, _jobs, ...rest } = result as any;
  return rest;
}

/**
 * Run (or propose) one tool call under the permission policy and record it.
 * Returns what to send back to the model.
 */
export async function runTool(tool: string, input: any, c: ToolContext, seq: number): Promise<{ outcome: ToolOutcome; modelResult: Record<string, unknown> }> {
  const tier = TIERS[tool];
  const action = await prisma.csrAgentAction.create({
    data: { turnId: c.turnId, tenantId: c.tenantId, conversationId: c.conversationId, seq, tool, input: input ?? {}, status: 'PENDING' },
  });

  const finish = async (outcome: ToolOutcome) => {
    await prisma.csrAgentAction.update({
      where: { id: action.id },
      data: {
        status: outcome.status,
        result: outcome.result as any,
        error: outcome.error,
        executedAt: ['READ', 'EXECUTED'].includes(outcome.status) ? new Date() : undefined,
      },
    });
    return { outcome, modelResult: forModel(outcome.result) };
  };

  if (!tier) return finish({ status: 'BLOCKED', result: { error: 'Unknown tool' }, error: 'Unknown tool' });

  if (tier === 'reply') {
    if (tool === 'send_reply') {
      const text = String(input?.text ?? '').trim();
      if (!text) return finish({ status: 'BLOCKED', result: { error: 'Reply text is empty' }, error: 'empty reply' });
      return finish({ status: 'READ', result: { ok: true }, endsTurn: { kind: 'reply', text } });
    }
    return finish({ status: 'READ', result: { ok: true }, endsTurn: { kind: 'no_reply', reason: String(input?.reason ?? '') } });
  }

  if (tier === 'internal') {
    // hand_off_to_human: always takes effect immediately, in every mode.
    // The turn continues so the agent can tell the customer a person is on it.
    return finish({
      status: 'EXECUTED',
      result: { handed_off: true, urgency: input?.urgency, next: 'Send one short reply telling the customer a team member is on it.' },
    });
  }

  if (tier === 'write' || tier === 'sensitive') {
    const blocked = await guard(tool, input, c);
    if (blocked) return finish({ status: 'BLOCKED', result: { error: blocked }, error: blocked });

    const needsApproval = c.mode === 'shadow' || (tier === 'sensitive' && c.mode === 'supervised');
    if (needsApproval) {
      const placeholder: Record<string, unknown> = tool === 'create_customer'
        ? { customer_id: `pending:${action.id}`, location_id: `pending:${action.id}` }
        : {};
      const note = c.mode === 'shadow'
        ? 'Queued for staff review (practice mode). Continue the conversation as though it will go through.'
        : 'This needs a staff member to approve. Tell the customer a team member will confirm shortly; do not promise the result.';
      return finish({ status: 'PROPOSED', result: { proposed: true, note, ...placeholder } });
    }
  }

  try {
    const result = await execute(tool, input ?? {}, c, action.id);
    return finish({ status: tier === 'read' ? 'READ' : 'EXECUTED', result });
  } catch (err: any) {
    const detail = err instanceof stApi.STError ? `${err.message}${err.body ? `: ${err.body}` : ''}` : err.message;
    return finish({ status: 'FAILED', result: { error: err.message }, error: detail });
  }
}

/** Execute a previously proposed action after a CSR approves it. */
export async function executeApprovedAction(actionId: string, c: ToolContext): Promise<{ ok: boolean; error?: string }> {
  const action = await prisma.csrAgentAction.findUnique({ where: { id: actionId } });
  if (!action || action.status !== 'PROPOSED') return { ok: false, error: 'Action is not awaiting approval' };
  const input = action.input as any;
  const blocked = await guard(action.tool, input, c);
  if (blocked) {
    await prisma.csrAgentAction.update({ where: { id: actionId }, data: { status: 'FAILED', error: blocked } });
    return { ok: false, error: blocked };
  }
  try {
    const result = await execute(action.tool, input, c, action.id);
    await prisma.csrAgentAction.update({
      where: { id: actionId },
      data: { status: 'APPROVED_EXECUTED', result: result as any, executedAt: new Date() },
    });
    return { ok: true };
  } catch (err: any) {
    const detail = err instanceof stApi.STError ? `${err.message}${err.body ? `: ${err.body}` : ''}` : err.message;
    await prisma.csrAgentAction.update({ where: { id: actionId }, data: { status: 'FAILED', error: detail } });
    return { ok: false, error: err.message };
  }
}
