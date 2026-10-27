import { Pool } from 'pg';
import { prisma } from '../../index';

/**
 * Read-only connection to the ServiceTitan mirror (Supabase `idesign-prod`).
 *
 * MIRROR_DATABASE_URL must use the `intellisend_reader` login created by
 * mirror/001_audience_schema.sql. That login can only SELECT from the
 * `audience` views and call audience.refresh(); it cannot read raw
 * ServiceTitan data or write anything.
 */
let pool: Pool | null = null;

export function isMirrorConfigured(): boolean {
  return !!process.env.MIRROR_DATABASE_URL;
}

export function getMirrorPool(): Pool {
  if (!process.env.MIRROR_DATABASE_URL) {
    throw new Error('MIRROR_DATABASE_URL is not set');
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.MIRROR_DATABASE_URL,
      max: 2,
      ssl: { rejectUnauthorized: false },
      // The hourly refresh rebuilds the audience layer (~70s today).
      statement_timeout: 10 * 60 * 1000,
    });
    pool.on('error', (err) => {
      console.error('[Mirror] Idle client error:', err.message);
    });
  }
  return pool;
}

/** ServiceTitan tenant the mirror holds (Intelligent Design). */
const MIRROR_ST_TENANT_ID = process.env.MIRROR_ST_TENANT_ID || '227669022';

let cachedTenantId: string | null = process.env.MIRROR_TENANT_ID || null;

/**
 * IntelliSend tenant that the mirror's customers belong to.
 *
 * MIRROR_TENANT_ID wins if set. Otherwise it is the IntelliSend tenant whose
 * enabled ServiceTitan connection points at the mirrored ServiceTitan tenant,
 * or, failing that, the only tenant with ServiceTitan enabled.
 */
export async function resolveMirrorTenantId(): Promise<string | null> {
  if (cachedTenantId) return cachedTenantId;
  const enabled = await prisma.serviceTitanConfig.findMany({
    where: { enabled: true },
    select: { tenantId: true, serviceTitanTenantId: true },
  });
  const match = enabled.find((c) => String(c.serviceTitanTenantId).trim() === MIRROR_ST_TENANT_ID);
  cachedTenantId = match?.tenantId ?? (enabled.length === 1 ? enabled[0].tenantId : null);
  if (!cachedTenantId) {
    console.warn(`[Mirror] Could not determine which IntelliSend tenant owns ServiceTitan tenant ${MIRROR_ST_TENANT_ID}; set MIRROR_TENANT_ID`);
  }
  return cachedTenantId;
}

/** Last resolved tenant (null until resolveMirrorTenantId has run). */
export function getMirrorTenantId(): string | null {
  return cachedTenantId;
}
