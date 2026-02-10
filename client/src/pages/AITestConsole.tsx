import { useState, useEffect, useRef } from 'react';
import { useTenant } from '../context/TenantContext';
import { api } from '../api/client';

interface ChatMessage {
  role: 'customer' | 'ai';
  content: string;
  timestamp?: string;
}

interface SessionDebug {
  state?: string;
  outcome?: string;
  lastIntent?: string;
  messageCount?: number;
  processingTimeMs?: number;
  serviceTitanContext?: {
    existingCustomer?: boolean;
    addressOnFile?: boolean;
    isMember?: boolean;
    enterpriseContext?: string;
  };
}

interface ScenarioResult {
  scenarioId: string;
  scenarioName: string;
  passed: boolean;
  steps: {
    stepNumber: number;
    input: string;
    expectedIntent?: string;
    actualIntent?: string;
    aiResponse: string;
    passed: boolean;
    reason?: string;
    processingTimeMs?: number;
  }[];
  totalTime?: number;
}

export default function AITestConsole() {
  const { selectedTenant } = useTenant();
  const [activeTab, setActiveTab] = useState<'chat' | 'scenarios'>('chat');

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [sessionDebug, setSessionDebug] = useState<SessionDebug>({});
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [scenarios, setScenarios] = useState<any[]>([]);
  const [scenarioResults, setScenarioResults] = useState<ScenarioResult[]>([]);
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [loadingScenarios, setLoadingScenarios] = useState(false);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    if (activeTab === 'scenarios' && selectedTenant) {
      fetchScenarios();
    }
  }, [activeTab, selectedTenant]);

  const fetchScenarios = async () => {
    if (!selectedTenant) return;
    setLoadingScenarios(true);
    try {
      const data = await api.getAITestScenarios(selectedTenant.id);
      setScenarios(data);
    } catch (error) {
      console.error('Failed to fetch scenarios:', error);
    } finally {
      setLoadingScenarios(false);
    }
  };

  const handleStartSession = async () => {
    if (!selectedTenant) return;
    setStarting(true);
    try {
      const nameParts = customerName.trim().split(/\s+/);
      const result = await api.startAITest(selectedTenant.id, {
        mockFirstName: nameParts[0] || undefined,
        mockLastName: nameParts.slice(1).join(' ') || undefined,
        mockPhone: customerPhone || undefined,
      });
      setConversationId(result.conversationId);
      setSessionStarted(true);
      setMessages([]);
      setSessionDebug({
        state: result.session?.state || 'STARTED',
        outcome: result.session?.outcome || 'PENDING',
        messageCount: 0,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to start test session: ' + message);
    } finally {
      setStarting(false);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedTenant || !conversationId || !inputMessage.trim()) return;
    const msg = inputMessage.trim();
    setInputMessage('');
    setMessages(prev => [...prev, { role: 'customer', content: msg, timestamp: new Date().toISOString() }]);
    setSending(true);
    try {
      const result = await api.sendAITestMessage(selectedTenant.id, {
        conversationId,
        message: msg,
      });
      const responseText = result.aiResponse?.responseText || '(No response — AI chose not to reply)';
      setMessages(prev => [...prev, {
        role: 'ai',
        content: responseText,
        timestamp: new Date().toISOString(),
      }]);
      setSessionDebug({
        state: result.session?.state || result.aiResponse?.newState,
        outcome: result.session?.outcome || result.aiResponse?.outcome,
        lastIntent: result.session?.lastIntent,
        messageCount: result.session?.messageCount || (sessionDebug.messageCount || 0) + 1,
        processingTimeMs: result.processingTimeMs,
        serviceTitanContext: result.session ? {
          existingCustomer: result.session.stExistingCustomer,
          addressOnFile: !!result.session.stAddressOnFile,
          isMember: result.session.stIsMember,
          enterpriseContext: result.session.stEnterpriseContext,
        } : undefined,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setMessages(prev => [...prev, { role: 'ai', content: `Error: ${message}` }]);
    } finally {
      setSending(false);
    }
  };

  const handleResetSession = async () => {
    if (!selectedTenant || !conversationId) return;
    try {
      await api.resetAITest(selectedTenant.id, { conversationId });
    } catch (error) {
      console.error('Reset error:', error);
    }
    setConversationId(null);
    setSessionStarted(false);
    setMessages([]);
    setSessionDebug({});
    setInputMessage('');
  };

  const mapScenarioResult = (raw: any, id: string | number): ScenarioResult => ({
    scenarioId: String(raw.scenarioId ?? id),
    scenarioName: raw.scenario || raw.name || `Scenario ${id}`,
    passed: raw.allPassed ?? (raw.failed === 0),
    steps: (raw.results || []).map((step: any, i: number) => ({
      stepNumber: step.step || i + 1,
      input: step.customerMessage || step.input || '',
      expectedIntent: step.expectedIntent,
      actualIntent: step.actualIntent,
      aiResponse: step.aiResponse || '(no response)',
      passed: step.passed,
      reason: step.failReason || step.reason,
      processingTimeMs: step.processingTimeMs,
    })),
  });

  const handleRunScenario = async (scenarioId: string) => {
    if (!selectedTenant) return;
    setRunningScenario(scenarioId);
    try {
      const raw = await api.runAITestScenario(selectedTenant.id, { scenarioId: Number(scenarioId) });
      const mapped = mapScenarioResult(raw, scenarioId);
      setScenarioResults(prev => {
        const filtered = prev.filter(r => r.scenarioId !== String(scenarioId));
        return [...filtered, mapped];
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to run scenario: ' + message);
    } finally {
      setRunningScenario(null);
    }
  };

  const handleRunAll = async () => {
    if (!selectedTenant) return;
    setRunningAll(true);
    setScenarioResults([]);
    try {
      const result = await api.runAllAITestScenarios(selectedTenant.id);
      const mapped = (result.scenarios || []).map((s: any) => mapScenarioResult(s, s.scenarioId));
      setScenarioResults(mapped);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to run all scenarios: ' + message);
    } finally {
      setRunningAll(false);
    }
  };

  const passedCount = scenarioResults.filter(r => r.passed).length;
  const totalCount = scenarioResults.length;

  if (!selectedTenant) {
    return <p className="empty-state">Select a tenant to use the AI Test Console</p>;
  }

  return (
    <div>
      <div className="page-header">
        <h2>AI Test Console</h2>
      </div>

      <div style={{ display: 'flex', gap: '0', marginBottom: '20px' }}>
        <button
          onClick={() => setActiveTab('chat')}
          style={{
            padding: '10px 24px',
            border: '1px solid #cbd5e0',
            borderRight: 'none',
            borderRadius: '6px 0 0 6px',
            background: activeTab === 'chat' ? '#4299e1' : '#fff',
            color: activeTab === 'chat' ? '#fff' : '#4a5568',
            cursor: 'pointer',
            fontWeight: activeTab === 'chat' ? '600' : '400',
          }}
        >
          Interactive Chat
        </button>
        <button
          onClick={() => setActiveTab('scenarios')}
          style={{
            padding: '10px 24px',
            border: '1px solid #cbd5e0',
            borderRadius: '0 6px 6px 0',
            background: activeTab === 'scenarios' ? '#4299e1' : '#fff',
            color: activeTab === 'scenarios' ? '#fff' : '#4a5568',
            cursor: 'pointer',
            fontWeight: activeTab === 'scenarios' ? '600' : '400',
          }}
        >
          Automated Scenarios
        </button>
      </div>

      {activeTab === 'chat' && (
        <div>
          {!sessionStarted ? (
            <div className="card">
              <h3 style={{ marginBottom: '16px' }}>Start Test Session</h3>
              <p style={{ color: '#718096', marginBottom: '16px' }}>
                Configure a mock customer to test the AI agent's responses. Leave fields empty for defaults.
              </p>
              <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Customer Name</label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    placeholder="e.g., John Smith"
                    style={{ padding: '10px', border: '1px solid #cbd5e0', borderRadius: '6px', width: '100%' }}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Customer Phone</label>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={e => setCustomerPhone(e.target.value)}
                    placeholder="e.g., +15551234567"
                    style={{ padding: '10px', border: '1px solid #cbd5e0', borderRadius: '6px', width: '100%' }}
                  />
                </div>
              </div>
              <button
                className="btn btn-primary"
                onClick={handleStartSession}
                disabled={starting}
              >
                {starting ? 'Starting...' : 'Start Test Session'}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '20px' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '500px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ margin: 0 }}>Chat</h3>
                    <button
                      className="btn btn-secondary"
                      onClick={handleResetSession}
                      style={{ padding: '6px 12px', fontSize: '13px' }}
                    >
                      Reset Session
                    </button>
                  </div>
                  <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    padding: '16px',
                    marginBottom: '12px',
                    background: '#f7fafc',
                  }}>
                    {messages.length === 0 && (
                      <p style={{ color: '#a0aec0', textAlign: 'center', marginTop: '40px' }}>
                        Send a message to start the conversation
                      </p>
                    )}
                    {messages.map((msg, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          justifyContent: msg.role === 'customer' ? 'flex-end' : 'flex-start',
                          marginBottom: '10px',
                        }}
                      >
                        <div style={{
                          maxWidth: '75%',
                          padding: '10px 14px',
                          borderRadius: msg.role === 'customer' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                          background: msg.role === 'customer' ? '#4299e1' : '#fff',
                          color: msg.role === 'customer' ? '#fff' : '#2d3748',
                          border: msg.role === 'ai' ? '1px solid #e2e8f0' : 'none',
                          fontSize: '14px',
                          lineHeight: '1.5',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                        }}>
                          <div style={{ fontSize: '11px', color: msg.role === 'customer' ? 'rgba(255,255,255,0.7)' : '#a0aec0', marginBottom: '4px' }}>
                            {msg.role === 'customer' ? 'Customer' : 'AI Agent'}
                          </div>
                          {msg.content}
                        </div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      value={inputMessage}
                      onChange={e => setInputMessage(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                      placeholder="Type a customer message..."
                      disabled={sending}
                      style={{ flex: 1, padding: '10px', border: '1px solid #cbd5e0', borderRadius: '6px' }}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={handleSendMessage}
                      disabled={sending || !inputMessage.trim()}
                    >
                      {sending ? 'Sending...' : 'Send'}
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ width: '320px', flexShrink: 0 }}>
                <div className="card">
                  <h3 style={{ marginBottom: '16px', fontSize: '15px' }}>Debug Panel</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <DebugRow label="Session State" value={sessionDebug.state || '—'} />
                    <DebugRow label="Outcome" value={sessionDebug.outcome || '—'} valueColor={
                      sessionDebug.outcome === 'BOOKED' ? '#48bb78' :
                      sessionDebug.outcome === 'FAILED' ? '#fc8181' : '#718096'
                    } />
                    <DebugRow label="Last Intent" value={sessionDebug.lastIntent || '—'} />
                    <DebugRow label="Message Count" value={String(sessionDebug.messageCount ?? '—')} />
                    <DebugRow label="Processing Time" value={sessionDebug.processingTimeMs ? `${sessionDebug.processingTimeMs}ms` : '—'} />

                    {sessionDebug.serviceTitanContext && (
                      <>
                        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '12px', marginTop: '4px' }}>
                          <div style={{ fontSize: '13px', fontWeight: '600', color: '#4a5568', marginBottom: '8px' }}>ServiceTitan Context</div>
                        </div>
                        <DebugRow label="Existing Customer" value={sessionDebug.serviceTitanContext.existingCustomer ? 'Yes' : 'No'} valueColor={sessionDebug.serviceTitanContext.existingCustomer ? '#48bb78' : '#718096'} />
                        <DebugRow label="Address on File" value={sessionDebug.serviceTitanContext.addressOnFile ? 'Yes' : 'No'} valueColor={sessionDebug.serviceTitanContext.addressOnFile ? '#48bb78' : '#718096'} />
                        <DebugRow label="Member" value={sessionDebug.serviceTitanContext.isMember ? 'Yes' : 'No'} valueColor={sessionDebug.serviceTitanContext.isMember ? '#48bb78' : '#718096'} />
                        {sessionDebug.serviceTitanContext.enterpriseContext && (
                          <DebugRow label="Enterprise" value={sessionDebug.serviceTitanContext.enterpriseContext} />
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'scenarios' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <button
              className="btn btn-primary"
              onClick={handleRunAll}
              disabled={runningAll || scenarios.length === 0}
            >
              {runningAll ? 'Running All...' : 'Run All Scenarios'}
            </button>
            {totalCount > 0 && (
              <div style={{
                padding: '8px 16px',
                borderRadius: '6px',
                background: passedCount === totalCount ? '#f0fff4' : '#fffaf0',
                border: `1px solid ${passedCount === totalCount ? '#c6f6d5' : '#feebc8'}`,
                fontWeight: '600',
                color: passedCount === totalCount ? '#276749' : '#c05621',
              }}>
                {passedCount}/{totalCount} scenarios passed
              </div>
            )}
          </div>

          {loadingScenarios ? (
            <p>Loading scenarios...</p>
          ) : scenarios.length === 0 ? (
            <div className="card">
              <p className="empty-state" style={{ textAlign: 'center', padding: '40px' }}>
                No test scenarios available. Configure scenarios in the backend to get started.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {scenarios.map((scenario: any) => {
                const sid = String(scenario.id);
                const result = scenarioResults.find(r => r.scenarioId === sid);
                const isRunning = runningScenario === sid;
                return (
                  <div key={scenario.id} className="card" style={{ padding: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: result ? '12px' : '0' }}>
                      <div>
                        <h4 style={{ margin: '0 0 4px 0' }}>{scenario.name}</h4>
                        {scenario.description && (
                          <p style={{ margin: 0, color: '#718096', fontSize: '13px' }}>{scenario.description}</p>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {result && (
                          <span style={{
                            padding: '4px 10px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: '600',
                            background: result.passed ? '#f0fff4' : '#fff5f5',
                            color: result.passed ? '#276749' : '#c53030',
                            border: `1px solid ${result.passed ? '#c6f6d5' : '#fed7d7'}`,
                          }}>
                            {result.passed ? 'PASSED' : 'FAILED'}
                          </span>
                        )}
                        <button
                          className="btn btn-secondary"
                          onClick={() => handleRunScenario(sid)}
                          disabled={isRunning || runningAll}
                          style={{ padding: '6px 14px', fontSize: '13px' }}
                        >
                          {isRunning ? 'Running...' : 'Run'}
                        </button>
                      </div>
                    </div>

                    {result && result.steps && (
                      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
                        {result.steps.map((step, i) => (
                          <div key={i} style={{
                            padding: '10px',
                            marginBottom: '8px',
                            borderRadius: '6px',
                            background: step.passed ? '#f0fff4' : '#fff5f5',
                            border: `1px solid ${step.passed ? '#c6f6d5' : '#fed7d7'}`,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                              <span style={{ fontSize: '16px' }}>{step.passed ? '✅' : '❌'}</span>
                              <span style={{ fontWeight: '600', fontSize: '13px' }}>Step {step.stepNumber}</span>
                              {step.processingTimeMs && (
                                <span style={{ fontSize: '12px', color: '#718096', marginLeft: 'auto' }}>
                                  {step.processingTimeMs}ms
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '13px', marginBottom: '4px' }}>
                              <span style={{ color: '#718096' }}>Input:</span> {step.input}
                            </div>
                            <div style={{ fontSize: '13px', marginBottom: '4px' }}>
                              <span style={{ color: '#718096' }}>AI Response:</span> {step.aiResponse}
                            </div>
                            {step.expectedIntent && (
                              <div style={{ fontSize: '12px', color: '#718096' }}>
                                Expected: {step.expectedIntent} | Actual: {step.actualIntent || '—'}
                              </div>
                            )}
                            {!step.passed && step.reason && (
                              <div style={{ fontSize: '12px', color: '#c53030', marginTop: '4px' }}>
                                Reason: {step.reason}
                              </div>
                            )}
                          </div>
                        ))}
                        {result.totalTime && (
                          <div style={{ fontSize: '12px', color: '#718096', textAlign: 'right' }}>
                            Total time: {result.totalTime}ms
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DebugRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: '13px', color: '#718096' }}>{label}</span>
      <span style={{ fontSize: '13px', fontWeight: '600', color: valueColor || '#2d3748' }}>{value}</span>
    </div>
  );
}
