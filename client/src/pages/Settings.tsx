import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import { api, TenantNumber, Suppression, AiPersona, TenantSettings, ServiceTitanConfig } from '../api/client';

interface TwilioIntegration {
  twilioConfigured: boolean;
  twilioAccountSid: string | null;
  twilioMessagingServiceSid: string | null;
  twilioValidatedAt: string | null;
}

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
  const navigate = useNavigate();
  const { selectedTenant, refreshTenants } = useTenant();
  const [numbers, setNumbers] = useState<TenantNumber[]>([]);
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [personas, setPersonas] = useState<AiPersona[]>([]);
  const [tenantSettings, setTenantSettings] = useState<TenantSettings | null>(null);
  const [twilioIntegration, setTwilioIntegration] = useState<TwilioIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddNumber, setShowAddNumber] = useState(false);
  const [showAddSuppression, setShowAddSuppression] = useState(false);
  const [showAddPersona, setShowAddPersona] = useState(false);
  const [showAddTenant, setShowAddTenant] = useState(false);
  const [showTwilioSetup, setShowTwilioSetup] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingTwilio, setSavingTwilio] = useState(false);
  const [testingTwilio, setTestingTwilio] = useState(false);
  const [stConfig, setStConfig] = useState<ServiceTitanConfig | null>(null);
  const [savingStConfig, setSavingStConfig] = useState(false);
  const [testingStConnection, setTestingStConnection] = useState(false);
  const [stForm, setStForm] = useState({
    tenantApiBaseUrl: '',
    serviceTitanTenantId: '',
    appKey: '',
    clientId: '',
    clientSecret: '',
    bookingProvider: 'IntelliSend-SMS',
    enabled: false,
  });

  const fetchData = async () => {
    if (!selectedTenant) return;
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        api.getTenantNumbers(selectedTenant.id),
        api.getSuppressions(selectedTenant.id),
        api.getAiPersonas(selectedTenant.id),
        api.getTenantSettings(selectedTenant.id),
        api.getIntegrations(selectedTenant.id),
        api.getServiceTitanConfig(selectedTenant.id),
      ]);
      
      const [numsResult, suppsResult, persResult, settingsResult, integrationsResult, stConfigResult] = results;
      
      if (numsResult.status === 'fulfilled') setNumbers(numsResult.value);
      if (suppsResult.status === 'fulfilled') setSuppressions(suppsResult.value);
      if (persResult.status === 'fulfilled') setPersonas(persResult.value);
      if (settingsResult.status === 'fulfilled') setTenantSettings(settingsResult.value);
      if (integrationsResult.status === 'fulfilled') setTwilioIntegration(integrationsResult.value);
      if (stConfigResult.status === 'fulfilled' && stConfigResult.value) {
        const stConfigData = stConfigResult.value;
        setStConfig(stConfigData);
        setStForm({
          tenantApiBaseUrl: stConfigData.tenantApiBaseUrl || '',
          serviceTitanTenantId: stConfigData.serviceTitanTenantId || '',
          appKey: stConfigData.appKey || '',
          clientId: stConfigData.clientId || '',
          clientSecret: '',
          bookingProvider: stConfigData.bookingProvider || 'IntelliSend-SMS',
          enabled: stConfigData.enabled || false,
        });
      }
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
    if (!selectedTenant) return;
    setSavingSettings(true);
    const formData = new FormData(e.currentTarget);
    try {
      await api.updateTenantSettings(selectedTenant.id, {
        timezone: formData.get('timezone') as string,
        quietHoursStart: formData.get('quietHoursStart') as unknown as number,
        quietHoursEnd: formData.get('quietHoursEnd') as unknown as number,
        defaultFromNumberId: formData.get('defaultFromNumberId') as string || undefined,
        sendRatePerMinute: parseInt(formData.get('sendRatePerMinute') as string) || 30,
        sendJitterMinMs: parseInt(formData.get('sendJitterMinMs') as string) || 1000,
        sendJitterMaxMs: parseInt(formData.get('sendJitterMaxMs') as string) || 5000,
      });
      const refreshedSettings = await api.getTenantSettings(selectedTenant.id);
      setTenantSettings(refreshedSettings);
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

  const handleSaveTwilio = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedTenant) return;
    setSavingTwilio(true);
    const formData = new FormData(e.currentTarget);
    try {
      await api.saveTwilioIntegration(selectedTenant.id, {
        accountSid: formData.get('accountSid') as string,
        authToken: formData.get('authToken') as string,
        messagingServiceSid: formData.get('messagingServiceSid') as string || undefined,
      });
      setShowTwilioSetup(false);
      fetchData();
      alert('Twilio integration saved successfully!');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to save Twilio integration: ' + message);
    } finally {
      setSavingTwilio(false);
    }
  };

  const handleTestTwilio = async () => {
    if (!selectedTenant) return;
    setTestingTwilio(true);
    try {
      const result = await api.testTwilioIntegration(selectedTenant.id);
      if (result.success) {
        alert(`Twilio connection successful!\nAccount: ${result.accountName}\nStatus: ${result.status}`);
      } else {
        alert('Twilio test failed: ' + result.error);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to test Twilio: ' + message);
    } finally {
      setTestingTwilio(false);
    }
  };

  const handleRemoveTwilio = async () => {
    if (!selectedTenant) return;
    if (!confirm('Are you sure you want to remove the Twilio integration?')) return;
    try {
      await api.removeTwilioIntegration(selectedTenant.id);
      fetchData();
      alert('Twilio integration removed.');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to remove Twilio: ' + message);
    }
  };

  const handleSaveServiceTitan = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedTenant) return;
    setSavingStConfig(true);
    try {
      const savedConfig = await api.saveServiceTitanConfig(selectedTenant.id, {
        tenantApiBaseUrl: stForm.tenantApiBaseUrl,
        serviceTitanTenantId: stForm.serviceTitanTenantId,
        appKey: stForm.appKey || undefined,
        clientId: stForm.clientId,
        clientSecret: stForm.clientSecret || undefined,
        bookingProvider: stForm.bookingProvider,
        enabled: stForm.enabled,
      });
      setStConfig(savedConfig);
      setStForm(prev => ({ ...prev, clientSecret: '' }));
      alert('ServiceTitan configuration saved successfully!');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to save ServiceTitan configuration: ' + message);
    } finally {
      setSavingStConfig(false);
    }
  };

  const handleTestServiceTitan = async () => {
    if (!selectedTenant) return;
    setTestingStConnection(true);
    try {
      const result = await api.testServiceTitanConnection(selectedTenant.id);
      if (result.ok) {
        alert(
          'ServiceTitan connection successful!\n\n' +
          '✓ OAuth Authentication: Passed\n' +
          '✓ API Access: Passed\n' +
          '✓ Bookings API: Passed\n\n' +
          'Your integration is ready to create bookings.'
        );
      } else {
        const details = result.details || { oauth: false, apiAccess: false, bookingsAccess: false };
        const statusLines = [
          `${details.oauth ? '✓' : '✗'} OAuth Authentication: ${details.oauth ? 'Passed' : 'Failed'}`,
          `${details.apiAccess ? '✓' : '✗'} API Access: ${details.apiAccess ? 'Passed' : 'Failed'}`,
          `${details.bookingsAccess ? '✓' : '✗'} Bookings API: ${details.bookingsAccess ? 'Passed' : 'Failed'}`,
        ];
        alert(
          'ServiceTitan test failed:\n\n' +
          statusLines.join('\n') +
          '\n\nError: ' + (result.error || 'Unknown error')
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to test ServiceTitan: ' + message);
    } finally {
      setTestingStConnection(false);
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
              
              <h4 style={{ marginTop: '24px', marginBottom: '12px', color: '#2d3748' }}>Send Rate Settings</h4>
              <div style={{ display: 'flex', gap: '16px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Messages Per Minute</label>
                  <input 
                    type="number" 
                    name="sendRatePerMinute" 
                    defaultValue={tenantSettings?.sendRatePerMinute || 30}
                    min="1"
                    max="120"
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Min Jitter (ms)</label>
                  <input 
                    type="number" 
                    name="sendJitterMinMs" 
                    defaultValue={tenantSettings?.sendJitterMinMs || 1000}
                    min="0"
                    max="30000"
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Max Jitter (ms)</label>
                  <input 
                    type="number" 
                    name="sendJitterMaxMs" 
                    defaultValue={tenantSettings?.sendJitterMaxMs || 5000}
                    min="1000"
                    max="60000"
                  />
                </div>
              </div>
              <p style={{ fontSize: '12px', color: '#718096', marginBottom: '16px' }}>
                Controls message spacing to avoid carrier spam detection. Jitter adds random delay between messages. Default: 30 messages/minute with 1-5 second random spacing.
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
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {numbers.map(num => (
                    <tr key={num.id}>
                      <td>{num.phoneNumber}</td>
                      <td>{num.label || '-'}</td>
                      <td>{num.isDefault ? 'Yes' : 'No'}</td>
                      <td>
                        <button
                          className="btn btn-small"
                          style={{ background: '#e53e3e', color: 'white', padding: '4px 8px', fontSize: '12px' }}
                          onClick={async () => {
                            if (!selectedTenant) return;
                            if (!confirm(`Delete ${num.phoneNumber}?`)) return;
                            try {
                              await api.deleteTenantNumber(selectedTenant.id, num.id);
                              fetchData();
                            } catch (err) {
                              alert('Failed to delete number');
                            }
                          }}
                        >
                          Delete
                        </button>
                      </td>
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

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3>Twilio Integration</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                {!twilioIntegration?.twilioConfigured && (
                  <button className="btn btn-primary btn-small" onClick={() => navigate('/settings/twilio')}>
                    Setup Wizard
                  </button>
                )}
              </div>
            </div>
            {twilioIntegration?.twilioConfigured ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <span style={{ color: '#38a169', fontSize: '20px' }}>&#10003;</span>
                  <span style={{ fontWeight: 500 }}>Twilio Connected</span>
                </div>
                <table className="table" style={{ marginBottom: '16px' }}>
                  <tbody>
                    <tr>
                      <td style={{ fontWeight: 500 }}>Account SID</td>
                      <td>{twilioIntegration.twilioAccountSid}</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500 }}>Messaging Service SID</td>
                      <td>{twilioIntegration.twilioMessagingServiceSid || 'Not configured'}</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500 }}>Last Validated</td>
                      <td>{twilioIntegration.twilioValidatedAt ? new Date(twilioIntegration.twilioValidatedAt).toLocaleString() : 'Never'}</td>
                    </tr>
                  </tbody>
                </table>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button className="btn btn-secondary btn-small" onClick={handleTestTwilio} disabled={testingTwilio}>
                    {testingTwilio ? 'Testing...' : 'Test Connection'}
                  </button>
                  <button className="btn btn-secondary btn-small" onClick={() => setShowTwilioSetup(true)}>
                    Update
                  </button>
                  <button className="btn btn-secondary btn-small" onClick={handleRemoveTwilio} style={{ color: '#e53e3e' }}>
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p style={{ color: '#718096', marginBottom: '12px' }}>
                  Connect your Twilio account to send and receive SMS messages. You'll need your Account SID, Auth Token, and optionally a Messaging Service SID.
                </p>
                <p style={{ fontSize: '12px', color: '#a0aec0' }}>
                  Get your credentials from <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" style={{ color: '#3182ce' }}>console.twilio.com</a>
                </p>
              </div>
            )}
          </div>

          <div className="card">
            <h3 style={{ marginBottom: '16px' }}>ServiceTitan Integration</h3>
            <p style={{ color: '#718096', marginBottom: '16px', fontSize: '14px' }}>
              Connect ServiceTitan to automatically create Bookings when customers reply to SMS campaigns. This notifies your CSR team that a conversation needs attention.
            </p>
            <details style={{ marginBottom: '20px', padding: '12px', background: '#f7fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#2d3748' }}>Setup Instructions (click to expand)</summary>
              <div style={{ marginTop: '12px', fontSize: '13px', color: '#4a5568', lineHeight: '1.7' }}>
                <p style={{ fontWeight: 600, marginBottom: '8px' }}>Step 1: Developer Portal Setup</p>
                <ol style={{ marginLeft: '20px', marginBottom: '12px' }}>
                  <li>Go to <a href="https://developer.servicetitan.io" target="_blank" rel="noopener noreferrer" style={{ color: '#3182ce' }}>developer.servicetitan.io</a> and sign in</li>
                  <li>Create an app (or use existing) under "My Apps"</li>
                  <li>Under "API Scopes", enable <strong>CRM &gt; Bookings</strong> (Read + Write)</li>
                  <li>Copy your <strong>App Key</strong> (starts with <code style={{ background: '#e2e8f0', padding: '1px 4px', borderRadius: '3px' }}>ak1.</code>)</li>
                  <li>Add your Tenant ID under "Tenants"</li>
                </ol>
                <p style={{ fontWeight: 600, marginBottom: '8px' }}>Step 2: ServiceTitan Account Setup</p>
                <ol style={{ marginLeft: '20px', marginBottom: '12px' }}>
                  <li>In ServiceTitan, go to <strong>Settings → Integrations → Booking Provider Tags</strong></li>
                  <li>Create a tag (e.g., "IntelliSend-SMS")</li>
                  <li>Go to <strong>Settings → Integrations → API Application Access</strong></li>
                  <li>Click <strong>Connect New App</strong> and find your app</li>
                  <li><span style={{ color: '#c53030', fontWeight: 600 }}>IMPORTANT:</span> Set <strong>"Restriction by Booking Provider"</strong> to <strong>"No Restriction"</strong></li>
                  <li>Click <strong>Allow Access</strong> and copy your <strong>Client ID</strong> and <strong>Client Secret</strong></li>
                </ol>
                <p style={{ fontWeight: 600, marginBottom: '8px' }}>Step 3: Enter Credentials Below</p>
                <p style={{ marginBottom: '0' }}>Enter the App Key from the Developer Portal, and the Client ID/Secret from ServiceTitan Settings. Then click "Test Connection" to verify everything works.</p>
              </div>
            </details>
            <form onSubmit={handleSaveServiceTitan}>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={stForm.enabled}
                    onChange={(e) => setStForm(prev => ({ ...prev, enabled: e.target.checked }))}
                  />
                  <span>Enable ServiceTitan Bookings Integration</span>
                </label>
              </div>
              
              <div className="form-group">
                <label>API Base URL</label>
                <input
                  type="text"
                  value={stForm.tenantApiBaseUrl}
                  onChange={(e) => setStForm(prev => ({ ...prev, tenantApiBaseUrl: e.target.value }))}
                  placeholder="https://api.servicetitan.io"
                />
                <p style={{ fontSize: '11px', color: '#718096', marginTop: '4px', lineHeight: '1.5' }}>
                  <strong>Production accounts:</strong> Use <code style={{ background: '#f0f0f0', padding: '1px 4px', borderRadius: '3px' }}>https://api.servicetitan.io</code><br />
                  <strong>Integration/Sandbox accounts:</strong> Use <code style={{ background: '#f0f0f0', padding: '1px 4px', borderRadius: '3px' }}>https://api-integration.servicetitan.io</code><br />
                  <span style={{ color: '#a0aec0', fontSize: '10px' }}>Check your ServiceTitan Developer Portal to confirm which environment your credentials are for.</span>
                </p>
              </div>
              
              <div className="form-group">
                <label>ServiceTitan Tenant ID</label>
                <input
                  type="text"
                  value={stForm.serviceTitanTenantId}
                  onChange={(e) => setStForm(prev => ({ ...prev, serviceTitanTenantId: e.target.value }))}
                  placeholder="Your ST Tenant ID"
                />
              </div>
              
              <div className="form-group">
                <label>App Key</label>
                <input
                  type="text"
                  value={stForm.appKey}
                  onChange={(e) => setStForm(prev => ({ ...prev, appKey: e.target.value }))}
                  placeholder="ak1.xxxxxxxx"
                />
                <p style={{ fontSize: '11px', color: '#718096', marginTop: '4px' }}>
                  From Developer Portal → My Apps → Your App → "Application Key" (starts with <code style={{ background: '#f0f0f0', padding: '1px 4px', borderRadius: '3px' }}>ak1.</code>)
                </p>
              </div>
              
              <div style={{ display: 'flex', gap: '16px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Client ID</label>
                  <input
                    type="text"
                    value={stForm.clientId}
                    onChange={(e) => setStForm(prev => ({ ...prev, clientId: e.target.value }))}
                    placeholder="From ServiceTitan Settings"
                  />
                  <p style={{ fontSize: '10px', color: '#a0aec0', marginTop: '2px' }}>
                    From ST Settings → Integrations → API App Access
                  </p>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Client Secret</label>
                  <input
                    type="password"
                    value={stForm.clientSecret}
                    onChange={(e) => setStForm(prev => ({ ...prev, clientSecret: e.target.value }))}
                    placeholder={stConfig ? '(leave blank to keep existing)' : 'Client Secret'}
                  />
                </div>
              </div>
              
              <div className="form-group">
                <label>Booking Provider Name</label>
                <input
                  type="text"
                  value={stForm.bookingProvider}
                  onChange={(e) => setStForm(prev => ({ ...prev, bookingProvider: e.target.value }))}
                  placeholder="IntelliSend-SMS"
                />
                <p style={{ fontSize: '11px', color: '#718096', marginTop: '4px' }}>
                  Tag name for bookings created by IntelliSend (appears in ST booking source)
                </p>
              </div>
              
              <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button type="submit" className="btn btn-primary" disabled={savingStConfig}>
                  {savingStConfig ? 'Saving...' : 'Save Configuration'}
                </button>
                {stConfig && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleTestServiceTitan}
                    disabled={testingStConnection}
                  >
                    {testingStConnection ? 'Testing...' : 'Test Connection'}
                  </button>
                )}
              </div>
              
              {stConfig?.enabled && (
                <div style={{ marginTop: '16px', padding: '12px', background: '#f0fff4', borderRadius: '6px', border: '1px solid #9ae6b4' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#38a169', fontSize: '20px' }}>&#10003;</span>
                    <span style={{ fontWeight: 500, color: '#276749' }}>ServiceTitan Integration Active</span>
                  </div>
                  <p style={{ fontSize: '12px', color: '#2f855a', marginTop: '8px' }}>
                    Inbound SMS replies will automatically create ServiceTitan Bookings to alert your team.
                  </p>
                </div>
              )}
            </form>
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

      {showTwilioSetup && (
        <div className="modal-overlay" onClick={() => setShowTwilioSetup(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{twilioIntegration?.twilioConfigured ? 'Update Twilio Integration' : 'Configure Twilio Integration'}</h3>
            <form onSubmit={handleSaveTwilio}>
              <div className="form-group">
                <label>Account SID *</label>
                <input type="text" name="accountSid" required placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
                <p style={{ fontSize: '11px', color: '#718096', marginTop: '4px' }}>
                  Found in your Twilio Console dashboard
                </p>
              </div>
              <div className="form-group">
                <label>Auth Token *</label>
                <input type="password" name="authToken" required placeholder="Your Twilio Auth Token" />
                <p style={{ fontSize: '11px', color: '#718096', marginTop: '4px' }}>
                  Found in your Twilio Console dashboard (click to reveal)
                </p>
              </div>
              <div className="form-group">
                <label>Messaging Service SID (Optional)</label>
                <input type="text" name="messagingServiceSid" placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
                <p style={{ fontSize: '11px', color: '#718096', marginTop: '4px' }}>
                  If you use a Messaging Service for sending SMS
                </p>
              </div>
              <div style={{ background: '#f7fafc', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>
                <p style={{ fontSize: '12px', color: '#4a5568', marginBottom: '8px' }}>
                  <strong>Webhook URL for Twilio:</strong>
                </p>
                <code style={{ fontSize: '11px', background: '#edf2f7', padding: '4px 8px', borderRadius: '4px', display: 'block', wordBreak: 'break-all' }}>
                  https://api.intellisend.net/webhooks/twilio/inbound
                </code>
                <p style={{ fontSize: '11px', color: '#718096', marginTop: '8px' }}>
                  Configure this URL in your Twilio Messaging Service settings for incoming messages.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowTwilioSetup(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={savingTwilio}>
                  {savingTwilio ? 'Validating...' : 'Save & Validate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
