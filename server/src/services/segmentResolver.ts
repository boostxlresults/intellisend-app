import { Prisma } from '@prisma/client';
import { prisma } from '../index';

export type TagMatchMode = 'ALL' | 'ANY' | 'NONE';

export interface TagFilter {
  mode: TagMatchMode;
  tagIds: string[];
}

const CHUNK = 1000;

function chunk<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Resolve which contacts match a tag filter, entirely in SQL.
 *
 * Replaces the old approach of loading every contact into memory for
 * ALL-mode matching, which does not scale past a few thousand contacts.
 * An empty tag list means "every contact in the tenant" (unchanged behavior).
 */
export async function resolveContactIds(
  tenantId: string,
  filter: TagFilter | null,
  excludedTagIds: string[] = []
): Promise<string[]> {
  const tagIds = filter?.tagIds?.filter(Boolean) ?? [];
  const mode: TagMatchMode = filter?.mode ?? 'ANY';

  let tagClause = Prisma.sql``;
  if (tagIds.length > 0) {
    if (mode === 'ALL') {
      tagClause = Prisma.sql`
        AND (
          SELECT COUNT(DISTINCT ct."tagId") FROM "ContactTag" ct
          WHERE ct."contactId" = c."id" AND ct."tagId" = ANY(${tagIds}::text[])
        ) = ${tagIds.length}`;
    } else if (mode === 'NONE') {
      tagClause = Prisma.sql`
        AND NOT EXISTS (
          SELECT 1 FROM "ContactTag" ct
          WHERE ct."contactId" = c."id" AND ct."tagId" = ANY(${tagIds}::text[])
        )`;
    } else {
      tagClause = Prisma.sql`
        AND EXISTS (
          SELECT 1 FROM "ContactTag" ct
          WHERE ct."contactId" = c."id" AND ct."tagId" = ANY(${tagIds}::text[])
        )`;
    }
  }

  const excluded = excludedTagIds.filter(Boolean);
  const excludeClause = excluded.length > 0
    ? Prisma.sql`
        AND NOT EXISTS (
          SELECT 1 FROM "ContactTag" ct
          WHERE ct."contactId" = c."id" AND ct."tagId" = ANY(${excluded}::text[])
        )`
    : Prisma.sql``;

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT c."id" FROM "Contact" c
    WHERE c."tenantId" = ${tenantId}
    ${tagClause}
    ${excludeClause}
  `;
  return rows.map((r) => r.id);
}

/** Parse the tag filter stored on a segment. Tolerates legacy/empty values. */
export function parseSegmentFilter(definitionJson: string | null): TagFilter | null {
  if (!definitionJson) return null;
  try {
    const parsed = JSON.parse(definitionJson);
    if (!parsed || !Array.isArray(parsed.tagIds)) return null;
    const mode: TagMatchMode = ['ALL', 'ANY', 'NONE'].includes(parsed.mode) ? parsed.mode : 'ANY';
    return { mode, tagIds: parsed.tagIds };
  } catch {
    return null;
  }
}

/**
 * Bring a DYNAMIC segment's member list in line with its tag filter.
 * STATIC segments are left untouched. Returns the current member count.
 */
export async function refreshSegmentMembers(segmentId: string): Promise<{ count: number; added: number; removed: number; skipped: boolean }> {
  const segment = await prisma.segment.findUnique({ where: { id: segmentId } });
  if (!segment) throw new Error(`Segment ${segmentId} not found`);

  if (segment.type !== 'DYNAMIC') {
    const count = await prisma.segmentMember.count({ where: { segmentId } });
    return { count, added: 0, removed: 0, skipped: true };
  }

  const filter = parseSegmentFilter(segment.definitionJson);
  if (!filter || filter.tagIds.length === 0) {
    // A dynamic segment with no tags would mean "everyone". Refuse to grow it
    // silently; keep whatever it has.
    const count = await prisma.segmentMember.count({ where: { segmentId } });
    console.warn(`[Segments] Dynamic segment ${segment.name} has no tag filter; leaving members unchanged`);
    return { count, added: 0, removed: 0, skipped: true };
  }

  const wanted = new Set(await resolveContactIds(segment.tenantId, filter, segment.excludedTagIds));
  const existing = await prisma.segmentMember.findMany({
    where: { segmentId },
    select: { contactId: true },
  });
  const have = new Set(existing.map((m) => m.contactId));

  const toAdd = [...wanted].filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !wanted.has(id));

  for (const ids of chunk(toRemove)) {
    await prisma.segmentMember.deleteMany({ where: { segmentId, contactId: { in: ids } } });
  }
  for (const ids of chunk(toAdd)) {
    await prisma.segmentMember.createMany({
      data: ids.map((contactId) => ({ segmentId, contactId })),
      skipDuplicates: true,
    });
  }

  return { count: wanted.size, added: toAdd.length, removed: toRemove.length, skipped: false };
}

/** Refresh every DYNAMIC segment for a tenant. Errors on one segment don't stop the rest. */
export async function refreshAllDynamicSegments(tenantId: string): Promise<{ refreshed: number; failed: number }> {
  const segments = await prisma.segment.findMany({
    where: { tenantId, type: 'DYNAMIC' },
    select: { id: true, name: true },
  });
  let refreshed = 0;
  let failed = 0;
  for (const s of segments) {
    try {
      await refreshSegmentMembers(s.id);
      refreshed++;
    } catch (err: any) {
      failed++;
      console.error(`[Segments] Failed to refresh dynamic segment ${s.name}: ${err.message}`);
    }
  }
  return { refreshed, failed };
}
