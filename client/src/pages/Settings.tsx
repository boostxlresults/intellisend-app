import { useState, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import { api, TenantNumber, Suppression, AiPersona, TenantSettings } from '../api/client';

const TIMEZONES = [
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Anchorage',
  'Pacific/Honolulu',
];

export default function Settings() {
  const { selectedTenant, refreshTenants } = useTenant();
  const [numbers, setNumbers] = useState<TenantNumber[]>([]);
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [personas, setPersonas] = useState<AiPersona[]>([]);
  const [tenantSettings, setTenantSettings] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddNumber, setShowAddNumber] = useState(false);
  const [showAddSuppression, setShowAddSuppression] = useState(false);
  const [showAddPersona, setShowAddPersona] = useState(false);
  const [showAddTenant, setShowAddTenant] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const fetchData = async () => {
    if (!selectedTenant) return;
    setLoading(true);
    try {
      const [nums, supps, pers, settings] = await Promise.all([
        api.getTenantNumbers(selectedTenant.id),
        api.getSuppressions(selectedTenant.id),
        api.getAiPersonas(selectedTenant.id),
        api.getTenantSettings(selectedTenant.id),
      ]);
      setNumbers(nums);
      setSuppressions(supps);
      setPersonas(pers);
      setTenantSettings(settings);
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedTenant]);

  const handleSaveSettings = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedTenant || !tenantSettings) return;
    setSavingSettings(true);
    const formData = new FormData(e.currentTarget);
    try {
      const updated = await api.updateTenantSettings(selectedTenant.id, {
        timezone: formData.get('timezone') as string,
        quietHoursStart: formData.get('quietHoursStart') as unknown as number,
        quietHoursEnd: formData.get('quietHoursEnd') as unknown as number,
        defaultFromNumberId: formData.get('defaultFromNumberId') as string || undefined,
      });
      setTenantSettings(updated);
      alert('Settings saved successfully!');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to save settings: ' + message);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddNumber = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedTenant) return;
    const formData = new FormData(e.currentTarget);
    try {
      await api.addTenantNumber(selectedTenant.id, {
        phoneNumber: formData.get('phoneNumber') as string,
        label: formData.get('label') as string || undefined,
        isDefault: formData.get('isDefault') === 'on',
      });
      setShowAddNumber(false);
      fetchData();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to add number: ' + message);
    }
  };

  const handleAddSuppression = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedTenant) return;
    const formData = new FormData(e.currentTarget);
    try {
      await api.createSuppression(
        selectedTenant.id,
        formData.get('phone') as string,
        formData.get('reason') as string || undefined
      );
      setShowAddSuppression(false);
      fetchData();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to add suppression: ' + message);
    }
  };

  const handleAddPersona = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedTenant) return;
    const formData = new FormData(e.currentTarget);
    try {
      await api.createAiPersona(selectedTenant.id, {
        name: formData.get('name') as string,
        description: formData.get('description') as string || undefined,
        systemPrompt: formData.get('systemPrompt') as string,
        canAutoReply: formData.get('canAutoReply') === 'on',
      });
      setShowAddPersona(false);
      fetchData();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to add persona: ' + message);
    }
  };

  const handleAddTenant = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    try {
      await api.createTenant({
        name: formData.get('name') as string,
        publicName: formData.get('publicName') as string,
        industry: formData.get('industry') as string || undefined,
      });
      setShowAddTenant(false);
      refreshTenants();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to create tenant: ' + message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Settings</h2>
        <button className="btn btn-primary" onClick={() => setShowAddTenant(true)}>
          Add New Tenant
        </button>
      </div>
      
      {!selectedTenant ? (
        <p className="empty-state">Select a tenant to view settings</p>
      ) : loading ? (
        <p>Loading settings...</p>
      ) : (
        <>
          <div className="card">
            <h3 style={{ marginBottom: '16px' }}>Tenant Settings</h3>
            <form onSubmit={handleSaveSettings}>
              <div className="form-group">
                <label>Timezone</label>
                <select 
                  name="timezone" 
                  defaultValue={tenantSettings?.timezone || 'America/Phoenix'}
                  style={{ padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e0', width: '100%' }}
                >
                  {TIMEZONES.map(tz => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '16px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Quiet Hours Start (24h)</label>
                  <input 
                    type="time" 
                    name="quietHoursStart" 
                    defaultValue={tenantSettings?.quietHoursStartFormatted || '20:00'}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Quiet Hours End (24h)</label>
                  <input 
                    type="time" 
                    name="quietHoursEnd" 
                    defaultValue={tenantSettings?.quietHoursEndFormatted || '08:00'}
                  />
                </div>
              </div>
              <p style={{ fontSize: '12px', color: '#718096', marginBottom: '16px' }}>
                No outbound SMS will be sent during quiet hours (overnight). For 8pm-8am, set Start=20:00 and End=08:00.
              </p>
              <div className="form-group">
                <label>Default From Number</label>
                <select 
                  name="defaultFromNumberId"
                  defaultValue={tenantSettings?.defaultFromNumberId || ''}
                  style={{ padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e0', width: '100%' }}
                >
                  <option value="">Use tenant default or any available</option>
                  {numbers.map(num => (
                    <option key={num.id} value={num.id}>
                      {num.phoneNumber} {num.label ? `(${num.label})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn btn-primary" disabled={savingSettings}>
                {savingSettings ? 'Saving...' : 'Save Settings'}
              </button>
            </form>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3>Phone Numbers</h3>
              <button className="btn btn-secondary btn-small" onClick={() => setShowAddNumber(true)}>
                Add Number
              </button>
            </div>
            {numbers.length === 0 ? (
              <p className="empty-state">No phone numbers configured</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Phone Number</th>
                    <th>Label</th>
                    <th>Default</th>
                  </tr>
                </thead>
                <tbody>
                  {numbers.map(num => (
                    <tr key={num.id}>
                      <td>{num.phoneNumber}</td>
                      <td>{num.label || '-'}</td>
                      <td>{num.isDefault ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3>Suppressions</h3>
              <button className="btn btn-secondary btn-small" onClick={() => setShowAddSuppression(true)}>
                Add Suppression
              </button>
            </div>
            {suppressions.length === 0 ? (
              <p className="empty-state">No suppressions</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Phone</th>
                    <th>Reason</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {suppressions.map(sup => (
                    <tr key={sup.id}>
                      <td>{sup.phone}</td>
                      <td>{sup.reason}</td>
                      <td>{new Date(sup.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3>AI Personas</h3>
              <button className="btn btn-secondary btn-small" onClick={() => setShowAddPersona(true)}>
                Add Persona
              </button>
            </div>
            {personas.length === 0 ? (
              <p className="empty-state">No AI personas configured</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Description</th>
                    <th>Auto-Reply</th>
                  </tr>
                </thead>
                <tbody>
                  {personas.map(persona => (
                    <tr key={persona.id}>
                      <td>{persona.name}</td>
                      <td>{persona.description || '-'}</td>
                      <td>{persona.canAutoReply ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
      
      {showAddNumber && (
        <div className="modal-overlay" onClick={() => setShowAddNumber(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Add Phone Number</h3>
            <form onSubmit={handleAddNumber}>
              <div className="form-group">
                <label>Phone Number *</label>
                <input type="tel" name="phoneNumber" required placeholder="+15551234567" />
              </div>
              <div className="form-group">
                <label>Label</label>
                <input type="text" name="label" placeholder="e.g., Main Line" />
              </div>
              <div className="form-group checkbox-group">
                <input type="checkbox" name="isDefault" id="isDefault" />
                <label htmlFor="isDefault">Set as default</label>
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddNumber(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Add</button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {showAddSuppression && (
        <div className="modal-overlay" onClick={() => setShowAddSuppression(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Add Suppression</h3>
            <form onSubmit={handleAddSuppression}>
              <div className="form-group">
                <label>Phone Number *</label>
                <input type="tel" name="phone" required placeholder="+15551234567" />
              </div>
              <div className="form-group">
                <label>Reason</label>
                <input type="text" name="reason" placeholder="e.g., STOP, complaint" />
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddSuppression(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Add</button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {showAddPersona && (
        <div className="modal-overlay" onClick={() => setShowAddPersona(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Add AI Persona</h3>
            <form onSubmit={handleAddPersona}>
              <div className="form-group">
                <label>Name *</label>
                <input type="text" name="name" required placeholder="e.g., Sales, Support" />
              </div>
              <div className="form-group">
                <label>Description</label>
                <input type="text" name="description" placeholder="Brief description of this persona" />
              </div>
              <div className="form-group">
                <label>System Prompt *</label>
                <textarea name="systemPrompt" required placeholder="You are a helpful assistant for..." />
              </div>
              <div className="form-group checkbox-group">
                <input type="checkbox" name="canAutoReply" id="canAutoReply" />
                <label htmlFor="canAutoReply">Enable auto-reply</label>
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddPersona(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Add</button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {showAddTenant && (
        <div className="modal-overlay" onClick={() => setShowAddTenant(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Add New Tenant</h3>
            <form onSubmit={handleAddTenant}>
              <div className="form-group">
                <label>Internal Name *</label>
                <input type="text" name="name" required placeholder="e.g., intelligent_design" />
              </div>
              <div className="form-group">
                <label>Public Name *</label>
                <input type="text" name="publicName" required placeholder="e.g., Intelligent Design" />
              </div>
              <div className="form-group">
                <label>Industry</label>
                <input type="text" name="industry" placeholder="e.g., Home Services" />
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddTenant(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
