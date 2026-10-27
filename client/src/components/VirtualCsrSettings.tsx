import { useEffect, useState } from 'react';
import { api, BookableJobTypeConfig, VirtualCsrConfig } from '../api/client';

const MODE_HELP: Record<string, string> = {
  shadow: 'Practice: drafts every reply and every ServiceTitan change. A CSR approves, edits or rejects each one. Nothing reaches a customer or ServiceTitan without a person.',
  supervised: 'Sends replies and books jobs on its own. Creating new customer accounts waits for a CSR.',
  autonomous: 'Acts on its own within its safety rules. Refunds, payments, cancellations and complaints always go to a person.',
};

const inputStyle = { width: '100%', boxSizing: 'border-box' as const, padding: '8px', border: '1px solid #cbd5e0', borderRadius: '6px' };

export default function VirtualCsrSettings({ tenantId }: { tenantId: string }) {
  const [cfg, setCfg] = useState<VirtualCsrConfig | null>(null);
  const [jobTypes, setJobTypes] = useState<BookableJobTypeConfig[]>([]);
  const [setup, setSetup] = useState<{ jobTypes: Array<{ id: number; name: string; businessUnitIds: number[] }>; businessUnits: Array<{ id: number; name: string }> } | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getVirtualCsrConfig(tenantId).then((c) => {
      setCfg(c);
      setJobTypes(Array.isArray(c.bookableJobTypes) ? c.bookableJobTypes : []);
    }).catch((e) => console.error('Failed to load virtual CSR config:', e));
  }, [tenantId]);

  const loadSetup = async () => {
    setSetupError(null);
    try {
      setSetup(await api.getVirtualCsrBookingSetup(tenantId));
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : 'Could not reach ServiceTitan');
    }
  };

  if (!cfg) return null;

  const update = (patch: Partial<VirtualCsrConfig>) => setCfg({ ...cfg, ...patch });
  const updateRow = (i: number, patch: Partial<BookableJobTypeConfig>) =>
    setJobTypes(jobTypes.map((j, idx) => (idx === i ? { ...j, ...patch } : j)));

  const save = async () => {
    setSaving(true);
    try {
      await api.saveVirtualCsrConfig(tenantId, {
        agentEngine: cfg.agentEngine,
        agentMode: cfg.agentMode,
        botName: cfg.botName,
        csrInstructions: cfg.csrInstructions,
        emergencyAlertPhone: cfg.emergencyAlertPhone,
        defaultCampaignId: cfg.defaultCampaignId,
        bookableJobTypes: jobTypes.filter((j) => j.label && j.jobTypeId && j.businessUnitId),
      });
      alert('Virtual CSR settings saved.');
    } catch (e) {
      alert('Failed to save: ' + (e instanceof Error ? e.message : 'unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const warnings: string[] = [];
  if (cfg.agentEngine === 'claude') {
    if (!cfg.enabled) warnings.push('The AI agent is turned off in "AI Booking Agent" below. Turn it on for the virtual CSR to answer texts.');
    if (!cfg.anthropicKeyConfigured) warnings.push('ANTHROPIC_API_KEY is not set on the server.');
    if (jobTypes.length === 0) warnings.push('No bookable job types yet: the agent will hand every booking request to a person.');
    if (!cfg.defaultCampaignId) warnings.push('No ServiceTitan campaign set for agent bookings: booking is blocked until one is set.');
    if (!cfg.emergencyAlertPhone) warnings.push('No emergency alert phone: emergencies will only be flagged in the inbox.');
  }

  return (
    <div className="card">
      <h3 style={{ marginBottom: '8px' }}>Virtual CSR (Claude)</h3>
      <p style={{ color: '#718096', fontSize: '14px', marginBottom: '16px' }}>
        A Claude agent that answers texts like a trained CSR: looks customers up in ServiceTitan, checks real
        availability on the dispatch board, and books jobs as unassigned for dispatch to assign. Model: {cfg.model}.
      </p>

      <div className="form-group">
        <label>Which agent answers texts</label>
        <div style={{ display: 'flex', gap: '10px' }}>
          {(['legacy', 'claude'] as const).map((e) => (
            <button key={e} type="button" className={`btn ${cfg.agentEngine === e ? 'btn-primary' : 'btn-secondary'}`} style={{ flex: 1 }}
              onClick={() => update({ agentEngine: e })}>
              {e === 'legacy' ? 'Original booking agent' : 'Claude virtual CSR'}
            </button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label>Mode</label>
        <select value={cfg.agentMode} onChange={(e) => update({ agentMode: e.target.value as VirtualCsrConfig['agentMode'] })} style={inputStyle}>
          <option value="shadow">Practice (every reply reviewed)</option>
          <option value="supervised">Supervised (new accounts reviewed)</option>
          <option value="autonomous">Autonomous</option>
        </select>
        <p style={{ fontSize: '12px', color: '#718096', marginTop: '6px' }}>{MODE_HELP[cfg.agentMode]}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        <div className="form-group">
          <label>Name customers see</label>
          <input style={inputStyle} value={cfg.botName ?? ''} placeholder="Alex" onChange={(e) => update({ botName: e.target.value })} />
        </div>
        <div className="form-group">
          <label>ServiceTitan campaign ID for agent bookings</label>
          <input style={inputStyle} value={cfg.defaultCampaignId ?? ''} placeholder="e.g. 12345678" onChange={(e) => update({ defaultCampaignId: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Text emergencies to</label>
          <input style={inputStyle} value={cfg.emergencyAlertPhone} placeholder="(520) 555-0100" onChange={(e) => update({ emergencyAlertPhone: e.target.value })} />
        </div>
      </div>

      <div className="form-group">
        <label>Business rules</label>
        <textarea
          rows={8}
          style={{ ...inputStyle, fontFamily: 'inherit' }}
          value={cfg.csrInstructions}
          onChange={(e) => update({ csrInstructions: e.target.value })}
          placeholder={'Write these the way you would train a new CSR. For example:\n- Members get priority: offer the earliest window first.\n- Water heater replacements over 10 years old: book a comfort advisor, not a tech.\n- Never book roofing in July or August afternoons.'}
        />
      </div>

      <div className="form-group">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <label style={{ margin: 0 }}>Job types the agent may book</label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button type="button" className="btn btn-secondary btn-small" onClick={loadSetup}>Load from ServiceTitan</button>
            <button type="button" className="btn btn-secondary btn-small"
              onClick={() => setJobTypes([...jobTypes, { label: '', jobTypeId: 0, businessUnitId: 0, whenToUse: '' }])}>
              Add job type
            </button>
          </div>
        </div>
        {setupError && <p style={{ fontSize: '12px', color: '#C53030' }}>{setupError}</p>}
        {jobTypes.length === 0 && <p style={{ fontSize: '13px', color: '#a0aec0' }}>None yet.</p>}
        {jobTypes.map((j, i) => (
          <div key={i} style={{ border: '1px solid #E2E8F0', borderRadius: '6px', padding: '10px', marginBottom: '8px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '8px', alignItems: 'end' }}>
              <div>
                <label style={{ fontSize: '12px' }}>Label</label>
                <input style={inputStyle} value={j.label} placeholder="AC repair" onChange={(e) => updateRow(i, { label: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: '12px' }}>ServiceTitan job type</label>
                {setup ? (
                  <select style={inputStyle} value={j.jobTypeId || ''} onChange={(e) => updateRow(i, { jobTypeId: Number(e.target.value) })}>
                    <option value="">Pick one</option>
                    {setup.jobTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                ) : (
                  <input style={inputStyle} value={j.jobTypeId || ''} placeholder="Job type ID" onChange={(e) => updateRow(i, { jobTypeId: Number(e.target.value) })} />
                )}
              </div>
              <div>
                <label style={{ fontSize: '12px' }}>Business unit</label>
                {setup ? (
                  <select style={inputStyle} value={j.businessUnitId || ''} onChange={(e) => updateRow(i, { businessUnitId: Number(e.target.value) })}>
                    <option value="">Pick one</option>
                    {setup.businessUnits.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                ) : (
                  <input style={inputStyle} value={j.businessUnitId || ''} placeholder="Business unit ID" onChange={(e) => updateRow(i, { businessUnitId: Number(e.target.value) })} />
                )}
              </div>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setJobTypes(jobTypes.filter((_, idx) => idx !== i))}>Remove</button>
            </div>
            <div style={{ marginTop: '8px' }}>
              <label style={{ fontSize: '12px' }}>When to use it</label>
              <input style={inputStyle} value={j.whenToUse} placeholder="AC is not cooling, blowing warm air, making noise, or leaking water"
                onChange={(e) => updateRow(i, { whenToUse: e.target.value })} />
            </div>
          </div>
        ))}
      </div>

      {warnings.length > 0 && (
        <div style={{ background: '#FFFAF0', border: '1px solid #FBD38D', borderRadius: '6px', padding: '10px', fontSize: '13px', marginBottom: '12px' }}>
          {warnings.map((w) => <div key={w}>• {w}</div>)}
        </div>
      )}

      <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save virtual CSR settings'}</button>
    </div>
  );
}
