import { Pool } from 'pg';

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

/** IntelliSend tenant that the mirror's customers belong to. */
export function getMirrorTenantId(): string | null {
  return process.env.MIRROR_TENANT_ID || null;
}
