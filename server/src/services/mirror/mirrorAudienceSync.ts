import crypto from 'crypto';
import { CustomerType } from '@prisma/client';
import { prisma } from '../../index';
import { normalizePhone } from '../../utils/phoneNormalize';
import { refreshAllDynamicSegments } from '../segmentResolver';
import { getMirrorPool } from './mirrorClient';
import { MirrorProfileRow, colorForTag, desiredTagNames } from './systemTags';

/**
 * ServiceTitan mirror -> IntelliSend audience sync.
 *
 * Reads audience.customer_profile from the mirror and, for one IntelliSend
 * tenant:
 *   1. Creates or updates a contact per ServiceTitan customer that has a
 *      textable phone, keyed on ServiceTitan customer ID.
 *   2. Adds and removes system tags so every contact's tags match what the
 *      mirror says right now.
 *   3. Adds every ServiceTitan doNotText number to the suppression list.
 *      (Never removes suppressions: an opt-out is permanent until a human
 *      clears it.)
 *   4. Re-resolves every DYNAMIC segment.
 *
 * It never deletes contacts and never touches tags that are not system tags.
 */

const CHUNK = 1000;
const STALE_RUN_MINUTES = 45;

let running = false;

export interface MirrorSyncStats {
  profileRows: number;
  contactsCreated: number;
  contactsUpdated: number;
  contactsAdopted: number;
  contactsUnchanged: number;
  managedNoLongerQualifying: number;
  tagsCreated: number;
  tagLinksAdded: number;
  tagLinksRemoved: number;
  suppressionsAdded: number;
  dynamicSegmentsRefreshed: number;
  dynamicSegmentsFailed: number;
  mirrorRefreshedAt: string | null;
  durationMs: number;
}

function chunk<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function customerTypeFor(row: MirrorProfileRow): CustomerType {
  switch (row.lifecycle_segment) {
    case '1_active_member':
    case '4_recent':
      return 'CUSTOMER';
    case '2_lapsed_member':
    case '5_warm':
    case '6_dormant':
      return 'PAST_CUSTOMER';
    case '3_open_estimate':
      return row.completed_jobs > 0 ? 'CUSTOMER' : 'LEAD';
    default:
      return 'LEAD';
  }
}

function contactFields(row: MirrorProfileRow) {
  const street = [row.street, row.unit].filter((s) => s && s.trim()).join(' ').trim();
  return {
    firstName: (row.first_name || '').trim(),
    lastName: (row.last_name || '').trim(),
    phone: normalizePhone(row.best_phone),
    email: row.email || null,
    address: street || null,
    city: row.city || null,
    state: row.state || null,
    zip: row.zip || null,
    customerType: customerTypeFor(row),
    smsTier: row.sms_tier,
    consentClass: row.sms_tier === 'A' ? 'st_service' : 'st_call_history',
  };
}

function fingerprint(fields: ReturnType<typeof contactFields>): string {
  return crypto.createHash('sha1').update(JSON.stringify(fields)).digest('hex');
}

async function fetchProfiles(refresh: boolean): Promise<{ rows: MirrorProfileRow[]; doNotText: string[]; refreshedAt: string | null }> {
  const pool = getMirrorPool();
  const client = await pool.connect();
  try {
    if (refresh) {
      await client.query('select audience.refresh()');
    }
    const profiles = await client.query(`
      select customer_id::text as customer_id, first_name, last_name, customer_type, best_phone, sms_tier,
             email, street, unit, city, state, zip, lifecycle_segment, completed_jobs::int as completed_jobs,
             is_high_value, is_hvac_only, is_plumbing_only, has_aging_install,
             (open_estimate_total is not null) as has_open_estimate, refreshed_at
      from audience.customer_profile
      where not do_not_service and best_phone is not null and sms_tier in ('A', 'B')
    `);
    const dnt = await client.query('select phone from audience.do_not_text_phones');
    const refreshedAt = profiles.rows[0]?.refreshed_at ? new Date(profiles.rows[0].refreshed_at).toISOString() : null;
    return {
      rows: profiles.rows as MirrorProfileRow[],
      doNotText: dnt.rows.map((r: { phone: string }) => r.phone),
      refreshedAt,
    };
  } finally {
    client.release();
  }
}

async function ensureSystemTags(tenantId: string, names: Set<string>): Promise<{ idByName: Map<string, string>; created: number }> {
  const existing = await prisma.tag.findMany({
    where: { tenantId, name: { in: [...names] } },
    select: { id: true, name: true, isSystem: true },
  });
  const idByName = new Map(existing.map((t) => [t.name, t.id]));

  const toFlag = existing.filter((t) => !t.isSystem).map((t) => t.id);
  if (toFlag.length > 0) {
    await prisma.tag.updateMany({ where: { id: { in: toFlag } }, data: { isSystem: true } });
  }

  const missing = [...names].filter((n) => !idByName.has(n));
  if (missing.length > 0) {
    await prisma.tag.createMany({
      data: missing.map((name) => ({ tenantId, name, color: colorForTag(name), isSystem: true })),
      skipDuplicates: true,
    });
    const created = await prisma.tag.findMany({
      where: { tenantId, name: { in: missing } },
      select: { id: true, name: true },
    });
    created.forEach((t) => idByName.set(t.name, t.id));
  }
  return { idByName, created: missing.length };
}

export async function runMirrorAudienceSync(
  tenantId: string,
  trigger: 'scheduled' | 'manual'
): Promise<{ runId: string | null; stats?: MirrorSyncStats; skipped?: string; error?: string }> {
  if (running) return { runId: null, skipped: 'A mirror sync is already running in this process' };

  const recent = await prisma.mirrorSyncRun.findFirst({
    where: { tenantId, status: 'RUNNING', startedAt: { gt: new Date(Date.now() - STALE_RUN_MINUTES * 60_000) } },
  });
  if (recent) return { runId: null, skipped: `Run ${recent.id} is still in progress` };

  running = true;
  const started = Date.now();
  const run = await prisma.mirrorSyncRun.create({ data: { tenantId, status: 'RUNNING', trigger } });

  try {
    const stats: MirrorSyncStats = {
      profileRows: 0, contactsCreated: 0, contactsUpdated: 0, contactsAdopted: 0, contactsUnchanged: 0,
      managedNoLongerQualifying: 0, tagsCreated: 0, tagLinksAdded: 0, tagLinksRemoved: 0,
      suppressionsAdded: 0, dynamicSegmentsRefreshed: 0, dynamicSegmentsFailed: 0,
      mirrorRefreshedAt: null, durationMs: 0,
    };

    // 1. Read the mirror
    const { rows, doNotText, refreshedAt } = await fetchProfiles(process.env.MIRROR_REFRESH !== 'false');
    stats.profileRows = rows.length;
    stats.mirrorRefreshedAt = refreshedAt;
    if (rows.length === 0) {
      throw new Error('Mirror returned 0 profile rows; refusing to strip tags from every contact');
    }

    // 2. System tags
    const desiredByCustomer = new Map<string, string[]>();
    const allNames = new Set<string>();
    for (const row of rows) {
      const names = desiredTagNames(row);
      desiredByCustomer.set(row.customer_id, names);
      names.forEach((n) => allNames.add(n));
    }
    const { idByName, created: tagsCreated } = await ensureSystemTags(tenantId, allNames);
    stats.tagsCreated = tagsCreated;

    // 3. Contacts
    const existing = await prisma.contact.findMany({
      where: { tenantId },
      select: { id: true, phone: true, stCustomerId: true, mirrorFingerprint: true },
    });
    const byStId = new Map<string, { id: string; fp: string | null }>();
    const unmanagedByPhone = new Map<string, string>();
    for (const c of existing) {
      if (c.stCustomerId) byStId.set(c.stCustomerId, { id: c.id, fp: c.mirrorFingerprint });
      else {
        const p = normalizePhone(c.phone);
        if (p && !unmanagedByPhone.has(p)) unmanagedByPhone.set(p, c.id);
      }
    }

    const now = new Date();
    const contactIdByCustomer = new Map<string, string>();
    const creates: any[] = [];
    const updates: Array<{ id: string; data: any }> = [];

    for (const row of rows) {
      const fields = contactFields(row);
      if (!fields.phone) continue;
      const fp = fingerprint(fields);
      const managed = byStId.get(row.customer_id);

      if (managed) {
        contactIdByCustomer.set(row.customer_id, managed.id);
        if (managed.fp === fp) {
          stats.contactsUnchanged++;
        } else {
          updates.push({ id: managed.id, data: { ...fields, mirrorFingerprint: fp, mirrorSyncedAt: now } });
          stats.contactsUpdated++;
        }
        continue;
      }

      const adoptId = unmanagedByPhone.get(fields.phone);
      if (adoptId) {
        // Existing IntelliSend contact with the same number and no ServiceTitan
        // link: attach it so its conversation history carries over. Consent
        // fields (consentTimestamp etc.) are left as they are.
        unmanagedByPhone.delete(fields.phone);
        contactIdByCustomer.set(row.customer_id, adoptId);
        updates.push({ id: adoptId, data: { ...fields, stCustomerId: row.customer_id, mirrorFingerprint: fp, mirrorSyncedAt: now } });
        stats.contactsAdopted++;
        continue;
      }

      const id = crypto.randomUUID();
      contactIdByCustomer.set(row.customer_id, id);
      creates.push({
        id, tenantId, ...fields, stCustomerId: row.customer_id,
        leadSource: 'ServiceTitan Mirror', mirrorFingerprint: fp, mirrorSyncedAt: now,
      });
    }

    for (const batch of chunk(creates)) {
      const res = await prisma.contact.createMany({ data: batch, skipDuplicates: true });
      stats.contactsCreated += res.count;
    }
    for (const batch of chunk(updates, 200)) {
      await prisma.$transaction(batch.map((u) => prisma.contact.update({ where: { id: u.id }, data: u.data })));
    }

    // 4. Tag diff, limited to system tags on mirror-managed contacts
    const systemTagIds = (await prisma.tag.findMany({
      where: { tenantId, isSystem: true },
      select: { id: true },
    })).map((t) => t.id);

    const managedContacts = await prisma.contact.findMany({
      where: { tenantId, stCustomerId: { not: null } },
      select: { id: true, stCustomerId: true },
    });

    const currentLinks = await prisma.contactTag.findMany({
      where: { tagId: { in: systemTagIds }, contact: { tenantId, stCustomerId: { not: null } } },
      select: { contactId: true, tagId: true },
    });
    const have = new Map<string, Set<string>>();
    for (const l of currentLinks) {
      if (!have.has(l.contactId)) have.set(l.contactId, new Set());
      have.get(l.contactId)!.add(l.tagId);
    }

    const adds: Array<{ contactId: string; tagId: string }> = [];
    const removesByTag = new Map<string, string[]>();

    for (const c of managedContacts) {
      const names = c.stCustomerId ? desiredByCustomer.get(c.stCustomerId) : undefined;
      if (!names) stats.managedNoLongerQualifying++;
      const want = new Set((names ?? []).map((n) => idByName.get(n)!).filter(Boolean));
      const current = have.get(c.id) ?? new Set<string>();
      want.forEach((tagId) => { if (!current.has(tagId)) adds.push({ contactId: c.id, tagId }); });
      current.forEach((tagId) => {
        if (!want.has(tagId)) {
          if (!removesByTag.has(tagId)) removesByTag.set(tagId, []);
          removesByTag.get(tagId)!.push(c.id);
        }
      });
    }

    for (const batch of chunk(adds)) {
      const res = await prisma.contactTag.createMany({ data: batch, skipDuplicates: true });
      stats.tagLinksAdded += res.count;
    }
    for (const [tagId, contactIds] of removesByTag) {
      for (const ids of chunk(contactIds)) {
        const res = await prisma.contactTag.deleteMany({ where: { tagId, contactId: { in: ids } } });
        stats.tagLinksRemoved += res.count;
      }
    }

    // 5. Suppressions from ServiceTitan doNotText (add only)
    const dntPhones = [...new Set(doNotText.map((p) => normalizePhone(p)).filter(Boolean))];
    for (const batch of chunk(dntPhones)) {
      const res = await prisma.suppression.createMany({
        data: batch.map((phone) => ({ tenantId, phone, reason: 'ServiceTitan doNotText' })),
        skipDuplicates: true,
      });
      stats.suppressionsAdded += res.count;
    }

    // 6. Dynamic segments
    const seg = await refreshAllDynamicSegments(tenantId);
    stats.dynamicSegmentsRefreshed = seg.refreshed;
    stats.dynamicSegmentsFailed = seg.failed;

    stats.durationMs = Date.now() - started;
    await prisma.mirrorSyncRun.update({
      where: { id: run.id },
      data: { status: 'SUCCESS', finishedAt: new Date(), stats: stats as any },
    });
    console.log(`[Mirror Sync] ${trigger} run ${run.id} done in ${stats.durationMs}ms`, JSON.stringify(stats));
    return { runId: run.id, stats };
  } catch (err: any) {
    console.error(`[Mirror Sync] Run ${run.id} failed: ${err.message}`);
    await prisma.mirrorSyncRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', finishedAt: new Date(), error: String(err.message).slice(0, 2000) },
    }).catch(() => undefined);
    return { runId: run.id, error: err.message };
  } finally {
    running = false;
  }
}
