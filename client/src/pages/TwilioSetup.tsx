import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import { api } from '../api/client';

interface SetupStep {
  id: number;
  title: string;
  description: string;
  completed: boolean;
}

export default function TwilioSetup() {
  const navigate = useNavigate();
  const { selectedTenant } = useTenant();
  const [currentStep, setCurrentStep] = useState(1);
  const [twilioConfigured, setTwilioConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  
  const [formData, setFormData] = useState({
    accountSid: '',
    authToken: '',
    messagingServiceSid: '',
  });

  const steps: SetupStep[] = [
    { id: 1, title: 'Create Twilio Account', description: 'Sign up for Twilio and verify your account', completed: currentStep > 1 },
    { id: 2, title: 'Register for A2P 10DLC', description: 'Required for business SMS in the US', completed: currentStep > 2 },
    { id: 3, title: 'Create Messaging Service', description: 'Set up your messaging service and phone numbers', completed: currentStep > 3 },
    { id: 4, title: 'Connect to IntelliSend', description: 'Enter your credentials and configure webhooks', completed: twilioConfigured },
  ];

  useEffect(() => {
    if (selectedTenant) {
      api.getIntegrations(selectedTenant.id).then(result => {
        if (result.twilioConfigured) {
          setTwilioConfigured(true);
          setCurrentStep(5);
        }
      }).catch(() => {});
    }
  }, [selectedTenant]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSaveCredentials = async () => {
    if (!selectedTenant) return;
    setSaving(true);
    setTestResult(null);
    try {
      await api.saveTwilioIntegration(selectedTenant.id, formData);
      setTwilioConfigured(true);
      setTestResult({ success: true, message: 'Twilio credentials saved and validated successfully!' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to save credentials';
      setTestResult({ success: false, message });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!selectedTenant) return;
    setTesting(true);
    try {
      const result = await api.testTwilioIntegration(selectedTenant.id);
      if (result.success) {
        setTestResult({ success: true, message: `Connection successful! Account: ${result.accountName}` });
      } else {
        setTestResult({ success: false, message: result.error || 'Connection test failed' });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Test failed';
      setTestResult({ success: false, message });
    } finally {
      setTesting(false);
    }
  };

  if (!selectedTenant) {
    return (
      <div className="card">
        <p className="empty-state">Please select a tenant to configure Twilio integration.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h2>Twilio Setup Wizard</h2>
        <button className="btn btn-secondary" onClick={() => navigate('/settings')}>
          Back to Settings
        </button>
      </div>

      <div className="card" style={{ marginBottom: '24px' }}>
        <h3 style={{ marginBottom: '16px' }}>Setup Progress</h3>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          {steps.map((step, index) => (
            <div key={step.id} style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: step.completed ? '#38a169' : currentStep === step.id ? '#3182ce' : '#e2e8f0',
                color: step.completed || currentStep === step.id ? 'white' : '#718096',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 600,
                fontSize: '14px',
              }}>
                {step.completed ? '✓' : step.id}
              </div>
              {index < steps.length - 1 && (
                <div style={{ flex: 1, height: '2px', background: step.completed ? '#38a169' : '#e2e8f0', margin: '0 8px' }} />
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {steps.map(step => (
            <div key={step.id} style={{ flex: 1, fontSize: '12px', color: '#718096' }}>
              {step.title}
            </div>
          ))}
        </div>
      </div>

      {currentStep === 1 && (
        <div className="card">
          <h3>Step 1: Create a Twilio Account</h3>
          <p style={{ color: '#718096', marginBottom: '16px' }}>
            If you don't already have a Twilio account, you'll need to create one first.
          </p>
          
          <div style={{ background: '#f7fafc', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
            <h4 style={{ marginBottom: '12px' }}>Instructions:</h4>
            <ol style={{ marginLeft: '20px', lineHeight: '1.8' }}>
              <li>Go to <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noopener noreferrer" style={{ color: '#3182ce' }}>twilio.com/try-twilio</a></li>
              <li>Sign up with your email and create a password</li>
              <li>Verify your email address and phone number</li>
              <li>Complete your account profile with business information</li>
              <li>Upgrade from trial to a paid account (required for A2P messaging)</li>
            </ol>
          </div>

          <div style={{ background: '#fffaf0', padding: '16px', borderRadius: '8px', marginBottom: '16px', borderLeft: '4px solid #ed8936' }}>
            <strong style={{ color: '#c05621' }}>Important:</strong>
            <p style={{ color: '#744210', marginTop: '8px' }}>
              You must upgrade to a paid Twilio account to send business SMS messages. Trial accounts have significant limitations and cannot be used with A2P 10DLC.
            </p>
          </div>

          <button className="btn btn-primary" onClick={() => setCurrentStep(2)}>
            I have a Twilio account - Continue
          </button>
        </div>
      )}

      {currentStep === 2 && (
        <div className="card">
          <h3>Step 2: Register for A2P 10DLC</h3>
          <p style={{ color: '#718096', marginBottom: '16px' }}>
            A2P 10DLC (Application-to-Person 10-Digit Long Code) registration is <strong>required by US carriers</strong> for business SMS messaging.
          </p>

          <div style={{ background: '#ebf8ff', padding: '16px', borderRadius: '8px', marginBottom: '16px', borderLeft: '4px solid #3182ce' }}>
            <strong style={{ color: '#2c5282' }}>What is A2P 10DLC?</strong>
            <p style={{ color: '#2a4365', marginTop: '8px' }}>
              It's a system that allows businesses to send SMS messages through standard 10-digit phone numbers while meeting carrier requirements for business messaging. Without registration, your messages may be blocked or filtered as spam.
            </p>
          </div>
          
          <div style={{ background: '#f7fafc', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
            <h4 style={{ marginBottom: '12px' }}>Registration Steps in Twilio Console:</h4>
            <ol style={{ marginLeft: '20px', lineHeight: '1.8' }}>
              <li>Go to <a href="https://console.twilio.com/us1/develop/sms/regulatory-compliance" target="_blank" rel="noopener noreferrer" style={{ color: '#3182ce' }}>Twilio Console &gt; Messaging &gt; Regulatory Compliance</a></li>
              <li><strong>Register your Brand</strong> - Provide your business details (EIN, business name, address)</li>
              <li><strong>Create a Campaign</strong> - Describe your use case (e.g., "Appointment reminders for home services")</li>
              <li>Select campaign type: Usually "Low Volume Standard" for most businesses</li>
              <li>Wait for approval (typically 1-7 business days)</li>
            </ol>
          </div>

          <div style={{ background: '#f0fff4', padding: '16px', borderRadius: '8px', marginBottom: '16px', borderLeft: '4px solid #38a169' }}>
            <strong style={{ color: '#276749' }}>Tips for Faster Approval:</strong>
            <ul style={{ marginLeft: '20px', marginTop: '8px', color: '#22543d' }}>
              <li>Use your official business name exactly as registered</li>
              <li>Provide clear, specific use case descriptions</li>
              <li>Include sample messages that match your actual content</li>
              <li>Mention your opt-out compliance (STOP to unsubscribe)</li>
            </ul>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn btn-secondary" onClick={() => setCurrentStep(1)}>Back</button>
            <button className="btn btn-primary" onClick={() => setCurrentStep(3)}>
              I've registered for A2P 10DLC - Continue
            </button>
          </div>
        </div>
      )}

      {currentStep === 3 && (
        <div className="card">
          <h3>Step 3: Create a Messaging Service</h3>
          <p style={{ color: '#718096', marginBottom: '16px' }}>
            A Messaging Service groups your phone numbers and handles message routing, compliance, and webhooks.
          </p>
          
          <div style={{ background: '#f7fafc', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
            <h4 style={{ marginBottom: '12px' }}>Create Messaging Service:</h4>
            <ol style={{ marginLeft: '20px', lineHeight: '1.8' }}>
              <li>Go to <a href="https://console.twilio.com/us1/develop/sms/services" target="_blank" rel="noopener noreferrer" style={{ color: '#3182ce' }}>Twilio Console &gt; Messaging &gt; Services</a></li>
              <li>Click "Create Messaging Service"</li>
              <li>Name it (e.g., "IntelliSend - [Your Business Name]")</li>
              <li>Select use case: "Notifications" or "Marketing"</li>
              <li>Add a Sender (phone number) - buy one if needed</li>
              <li>Link your A2P 10DLC campaign to this service</li>
            </ol>
          </div>

          <div style={{ background: '#f7fafc', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
            <h4 style={{ marginBottom: '12px' }}>Configure Webhooks (for receiving replies):</h4>
            <ol style={{ marginLeft: '20px', lineHeight: '1.8' }}>
              <li>In your Messaging Service settings, go to "Integration"</li>
              <li>Set "Incoming Messages" webhook URL to:</li>
            </ol>
            <code style={{ display: 'block', background: '#edf2f7', padding: '12px', borderRadius: '6px', marginTop: '8px', fontSize: '13px', wordBreak: 'break-all' }}>
              https://api.intellisend.net/webhooks/twilio/inbound
            </code>
            <ol start={3} style={{ marginLeft: '20px', lineHeight: '1.8', marginTop: '8px' }}>
              <li>Set HTTP method to POST</li>
              <li>Set "Status Callback URL" to:</li>
            </ol>
            <code style={{ display: 'block', background: '#edf2f7', padding: '12px', borderRadius: '6px', marginTop: '8px', fontSize: '13px', wordBreak: 'break-all' }}>
              https://api.intellisend.net/webhooks/twilio/status
            </code>
          </div>

          <div style={{ background: '#fffaf0', padding: '16px', borderRadius: '8px', marginBottom: '16px', borderLeft: '4px solid #ed8936' }}>
            <strong style={{ color: '#c05621' }}>Where to Find Your Credentials:</strong>
            <ul style={{ marginLeft: '20px', marginTop: '8px', color: '#744210' }}>
              <li><strong>Account SID & Auth Token:</strong> <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" style={{ color: '#3182ce' }}>Twilio Console Dashboard</a> (top of page)</li>
              <li><strong>Messaging Service SID:</strong> Starts with "MG..." - found in your Messaging Service settings</li>
            </ul>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn btn-secondary" onClick={() => setCurrentStep(2)}>Back</button>
            <button className="btn btn-primary" onClick={() => setCurrentStep(4)}>
              I've created my Messaging Service - Continue
            </button>
          </div>
        </div>
      )}

      {currentStep === 4 && (
        <div className="card">
          <h3>Step 4: Connect to IntelliSend</h3>
          <p style={{ color: '#718096', marginBottom: '16px' }}>
            Enter your Twilio credentials to connect your account. We'll validate them before saving.
          </p>
          
          <div style={{ maxWidth: '500px' }}>
            <div className="form-group">
              <label>Account SID *</label>
              <input
                type="text"
                name="accountSid"
                value={formData.accountSid}
                onChange={handleInputChange}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              />
              <p style={{ fontSize: '11px', color: '#718096', marginTop: '4px' }}>
                Found on your <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" style={{ color: '#3182ce' }}>Twilio Console Dashboard</a>
              </p>
            </div>

            <div className="form-group">
              <label>Auth Token *</label>
              <input
                type="password"
                name="authToken"
                value={formData.authToken}
                onChange={handleInputChange}
                placeholder="Your Auth Token (click 'Show' in Twilio Console)"
              />
              <p style={{ fontSize: '11px', color: '#718096', marginTop: '4px' }}>
                Click "Show" next to Auth Token on your Twilio Dashboard to reveal it
              </p>
            </div>

            <div className="form-group">
              <label>Messaging Service SID *</label>
              <input
                type="text"
                name="messagingServiceSid"
                value={formData.messagingServiceSid}
                onChange={handleInputChange}
                placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              />
              <p style={{ fontSize: '11px', color: '#718096', marginTop: '4px' }}>
                Found in <a href="https://console.twilio.com/us1/develop/sms/services" target="_blank" rel="noopener noreferrer" style={{ color: '#3182ce' }}>Messaging &gt; Services</a> - starts with "MG"
              </p>
            </div>
          </div>

          {testResult && (
            <div style={{
              padding: '12px 16px',
              borderRadius: '6px',
              marginBottom: '16px',
              background: testResult.success ? '#f0fff4' : '#fff5f5',
              borderLeft: `4px solid ${testResult.success ? '#38a169' : '#e53e3e'}`,
            }}>
              <span style={{ color: testResult.success ? '#276749' : '#c53030' }}>
                {testResult.message}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn btn-secondary" onClick={() => setCurrentStep(3)}>Back</button>
            <button
              className="btn btn-primary"
              onClick={handleSaveCredentials}
              disabled={saving || !formData.accountSid || !formData.authToken}
            >
              {saving ? 'Validating...' : 'Save & Validate Credentials'}
            </button>
            {twilioConfigured && (
              <button className="btn btn-secondary" onClick={handleTestConnection} disabled={testing}>
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
            )}
          </div>
        </div>
      )}

      {currentStep === 5 && twilioConfigured && (
        <div className="card">
          <div style={{ textAlign: 'center', padding: '24px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#10003;</div>
            <h3 style={{ color: '#38a169', marginBottom: '16px' }}>Twilio Integration Complete!</h3>
            <p style={{ color: '#718096', marginBottom: '24px' }}>
              Your Twilio account is connected and ready to send messages.
            </p>
            
            <div style={{ background: '#f7fafc', padding: '16px', borderRadius: '8px', marginBottom: '24px', textAlign: 'left' }}>
              <h4 style={{ marginBottom: '12px' }}>Next Steps:</h4>
              <ul style={{ marginLeft: '20px', lineHeight: '1.8' }}>
                <li>Import your contacts</li>
                <li>Create your first campaign</li>
                <li>Configure your tenant settings (timezone, quiet hours)</li>
                <li>Add phone numbers to your account in Settings</li>
              </ul>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={() => navigate('/settings')}>
                Go to Settings
              </button>
              <button className="btn btn-primary" onClick={() => navigate('/contacts')}>
                Import Contacts
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
