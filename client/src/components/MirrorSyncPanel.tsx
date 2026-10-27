import { useEffect, useState } from 'react';
import { api, MirrorSyncStatus } from '../api/client';

/**
 * Status of the hourly ServiceTitan mirror sync: last runs, what changed,
 * and the system tags it maintains. Renders nothing when the mirror is not
 * configured for this account.
 */
export default function MirrorSyncPanel({ tenantId }: { tenantId: string }) {
  const [status, setStatus] = useState<MirrorSyncStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [showTags, setShowTags] = useState(false);

  const load = async () => {
    try {
      setStatus(await api.getMirrorSyncStatus(tenantId));
    } catch (error) {
      console.error('Failed to load mirror sync status:', error);
    }
  };

  useEffect(() => {
    load();
  }, [tenantId]);

  // Poll while a run is in progress.
  useEffect(() => {
    if (status?.runs[0]?.status !== 'RUNNING' && !starting) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [status, starting]);

  if (!status || !status.managesTenant) return null;

  const last = status.runs[0];
  const lastSuccess = status.runs.find(r => r.status === 'SUCCESS');
  const running = last?.status === 'RUNNING';

  const runNow = async () => {
    setStarting(true);
    try {
      await api.runMirrorSync(tenantId);
      setTimeout(load, 1500);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Could not start the sync: ' + message);
    } finally {
      setTimeout(() => setStarting(false), 3000);
    }
  };

  const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : 'never');

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0 }}>ServiceTitan Mirror Sync</h3>
        <button className="btn btn-primary btn-small" onClick={runNow} disabled={running || starting}>
          {running || starting ? 'Syncing...' : 'Sync now'}
        </button>
      </div>
      <p style={{ color: '#718096', fontSize: '14px', marginBottom: '16px' }}>
        Every hour, customers with a textable phone are pulled from the ServiceTitan mirror and tagged by
        lifecycle segment, SMS tier, value and cross-sell flags. Tags marked <em>auto</em> are kept up to date
        automatically and cannot be edited by hand. Dynamic segments are recalculated after each sync.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <Stat label="Synced contacts" value={status.managedContacts.toLocaleString()} />
        <Stat label="Last successful sync" value={fmt(lastSuccess?.finishedAt)} />
        <Stat label="Mirror data as of" value={fmt(lastSuccess?.stats?.mirrorRefreshedAt)} />
        <Stat label="Schedule" value={status.enabled ? 'Hourly' : 'Paused'} />
      </div>

      {last?.status === 'FAILED' && (
        <div style={{ background: '#FFF5F5', border: '1px solid #FED7D7', color: '#C53030', padding: '10px', borderRadius: '6px', fontSize: '13px', marginBottom: '12px' }}>
          Last sync failed at {fmt(last.finishedAt)}: {last.error}
        </div>
      )}

      {lastSuccess?.stats && (
        <p style={{ fontSize: '13px', color: '#4a5568', marginBottom: '12px' }}>
          Last run: {lastSuccess.stats.contactsCreated.toLocaleString()} created,{' '}
          {lastSuccess.stats.contactsUpdated.toLocaleString()} updated,{' '}
          {lastSuccess.stats.contactsAdopted.toLocaleString()} linked to existing contacts,{' '}
          {lastSuccess.stats.tagLinksAdded.toLocaleString()} tags added,{' '}
          {lastSuccess.stats.tagLinksRemoved.toLocaleString()} tags removed,{' '}
          {lastSuccess.stats.suppressionsAdded.toLocaleString()} new do-not-text numbers suppressed.
        </p>
      )}

      <button className="btn btn-secondary btn-small" onClick={() => setShowTags(!showTags)}>
        {showTags ? 'Hide' : 'Show'} synced tags ({status.systemTags.length})
      </button>
      {showTags && (
        <table className="data-table" style={{ marginTop: '12px' }}>
          <thead>
            <tr>
              <th>Tag</th>
              <th style={{ textAlign: 'right' }}>Contacts</th>
            </tr>
          </thead>
          <tbody>
            {status.systemTags.filter(t => !t.name.startsWith('ZIP-')).map(t => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td style={{ textAlign: 'right' }}>{t.contactCount.toLocaleString()}</td>
              </tr>
            ))}
            <tr>
              <td style={{ color: '#718096' }}>ZIP tags</td>
              <td style={{ textAlign: 'right', color: '#718096' }}>
                {status.systemTags.filter(t => t.name.startsWith('ZIP-')).length} ZIP codes
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#f7fafc', borderRadius: '6px', padding: '10px 12px' }}>
      <div style={{ fontSize: '12px', color: '#718096' }}>{label}</div>
      <div style={{ fontSize: '15px', fontWeight: 600 }}>{value}</div>
    </div>
  );
}
