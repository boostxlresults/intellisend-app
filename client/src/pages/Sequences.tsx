import { useState, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import { api } from '../api/client';

interface SequenceStep {
  id?: string;
  order: number;
  delayMinutes: number;
  delayUnit: string;
  bodyTemplate: string;
  mediaUrl?: string;
}

interface Sequence {
  id: string;
  name: string;
  description?: string;
  status: string;
  triggerType: string;
  steps: SequenceStep[];
  _count?: { enrollments: number };
  createdAt: string;
}

const styles = {
  container: {
    padding: '32px 40px',
    maxWidth: '1200px',
    margin: '0 auto',
  } as React.CSSProperties,
  header: {
    marginBottom: '32px',
  } as React.CSSProperties,
  headerTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  } as React.CSSProperties,
  title: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#111827',
    letterSpacing: '-0.025em',
    margin: 0,
  } as React.CSSProperties,
  subtitle: {
    fontSize: '15px',
    color: '#6B7280',
    margin: '4px 0 0 0',
  } as React.CSSProperties,
  primaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 20px',
    background: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 1px 3px rgba(59, 130, 246, 0.3), 0 4px 12px rgba(59, 130, 246, 0.15)',
    transition: 'all 0.2s ease',
  } as React.CSSProperties,
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 16px',
    background: 'white',
    color: '#374151',
    border: '1px solid #E5E7EB',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  } as React.CSSProperties,
  formCard: {
    background: 'white',
    borderRadius: '16px',
    border: '1px solid #E5E7EB',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 6px 16px rgba(0,0,0,0.04)',
    padding: '28px',
    marginBottom: '32px',
  } as React.CSSProperties,
  formTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#111827',
    marginBottom: '24px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  } as React.CSSProperties,
  formGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '20px',
    marginBottom: '24px',
  } as React.CSSProperties,
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: '500',
    color: '#374151',
    marginBottom: '8px',
  } as React.CSSProperties,
  input: {
    width: '100%',
    padding: '12px 14px',
    border: '1px solid #E5E7EB',
    borderRadius: '10px',
    fontSize: '14px',
    color: '#111827',
    background: '#FAFAFA',
    transition: 'all 0.15s ease',
    outline: 'none',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  textarea: {
    width: '100%',
    padding: '12px 14px',
    border: '1px solid #E5E7EB',
    borderRadius: '10px',
    fontSize: '14px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    color: '#111827',
    background: '#FAFAFA',
    minHeight: '100px',
    resize: 'vertical' as const,
    lineHeight: '1.6',
    transition: 'all 0.15s ease',
    outline: 'none',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  stepsSection: {
    marginBottom: '24px',
  } as React.CSSProperties,
  stepsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  } as React.CSSProperties,
  stepsTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
  } as React.CSSProperties,
  addStepBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 14px',
    background: '#EFF6FF',
    color: '#3B82F6',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  } as React.CSSProperties,
  stepCard: {
    background: 'white',
    border: '1px solid #E5E7EB',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '16px',
    position: 'relative' as const,
  } as React.CSSProperties,
  stepHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  } as React.CSSProperties,
  stepNumber: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    background: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)',
    color: 'white',
    borderRadius: '50%',
    fontSize: '13px',
    fontWeight: '600',
  } as React.CSSProperties,
  stepTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  } as React.CSSProperties,
  stepLabel: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#111827',
  } as React.CSSProperties,
  removeBtn: {
    padding: '6px 12px',
    background: '#FEF2F2',
    color: '#DC2626',
    border: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  } as React.CSSProperties,
  delayRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px',
    padding: '12px 16px',
    background: '#F9FAFB',
    borderRadius: '8px',
  } as React.CSSProperties,
  delayLabel: {
    fontSize: '13px',
    color: '#6B7280',
    fontWeight: '500',
  } as React.CSSProperties,
  delayInput: {
    width: '80px',
    padding: '8px 12px',
    border: '1px solid #E5E7EB',
    borderRadius: '8px',
    fontSize: '14px',
    textAlign: 'center' as const,
    outline: 'none',
  } as React.CSSProperties,
  delaySelect: {
    padding: '8px 12px',
    border: '1px solid #E5E7EB',
    borderRadius: '8px',
    fontSize: '14px',
    background: 'white',
    outline: 'none',
  } as React.CSSProperties,
  formActions: {
    display: 'flex',
    gap: '12px',
    marginTop: '24px',
    paddingTop: '24px',
    borderTop: '1px solid #F3F4F6',
  } as React.CSSProperties,
  sequencesList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  } as React.CSSProperties,
  sequenceCard: {
    background: 'white',
    borderRadius: '14px',
    border: '1px solid #E5E7EB',
    padding: '20px 24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    transition: 'all 0.2s ease',
  } as React.CSSProperties,
  sequenceInfo: {
    flex: 1,
  } as React.CSSProperties,
  sequenceName: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#111827',
    margin: 0,
  } as React.CSSProperties,
  sequenceDesc: {
    fontSize: '13px',
    color: '#6B7280',
    margin: '4px 0 0 0',
  } as React.CSSProperties,
  sequenceMeta: {
    display: 'flex',
    gap: '24px',
    alignItems: 'center',
  } as React.CSSProperties,
  metaItem: {
    textAlign: 'center' as const,
  } as React.CSSProperties,
  metaValue: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#111827',
  } as React.CSSProperties,
  metaLabel: {
    fontSize: '11px',
    color: '#9CA3AF',
    textTransform: 'uppercase' as const,
    fontWeight: '500',
  } as React.CSSProperties,
  statusBadge: {
    padding: '6px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
  } as React.CSSProperties,
  emptyState: {
    background: 'linear-gradient(135deg, #F9FAFB 0%, #F3F4F6 100%)',
    borderRadius: '16px',
    padding: '60px 40px',
    textAlign: 'center' as const,
    border: '2px dashed #E5E7EB',
  } as React.CSSProperties,
  emptyIcon: {
    fontSize: '48px',
    marginBottom: '16px',
  } as React.CSSProperties,
  emptyTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '8px',
  } as React.CSSProperties,
  emptyText: {
    fontSize: '14px',
    color: '#6B7280',
    marginBottom: '24px',
    maxWidth: '400px',
    margin: '0 auto 24px',
    lineHeight: '1.6',
  } as React.CSSProperties,
  timeline: {
    position: 'relative' as const,
    paddingLeft: '24px',
  } as React.CSSProperties,
  timelineLine: {
    position: 'absolute' as const,
    left: '13px',
    top: '40px',
    bottom: '20px',
    width: '2px',
    background: '#E5E7EB',
  } as React.CSSProperties,
};

export default function Sequences() {
  const { selectedTenant: currentTenant } = useTenant();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [newSequence, setNewSequence] = useState({
    name: '',
    description: '',
    steps: [{ order: 1, delayMinutes: 0, delayUnit: 'minutes', bodyTemplate: '' }] as SequenceStep[],
  });

  useEffect(() => {
    if (currentTenant) {
      loadSequences();
    }
  }, [currentTenant]);

  const loadSequences = async () => {
    if (!currentTenant) return;
    try {
      const data = await api.getSequences(currentTenant.id);
      setSequences(data);
    } catch (error) {
      console.error('Error loading sequences:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSequence = async () => {
    if (!currentTenant || !newSequence.name) return;
    try {
      await api.createSequence(currentTenant.id, newSequence);
      setShowForm(false);
      setNewSequence({
        name: '',
        description: '',
        steps: [{ order: 1, delayMinutes: 0, delayUnit: 'minutes', bodyTemplate: '' }],
      });
      loadSequences();
    } catch (error) {
      console.error('Error creating sequence:', error);
    }
  };

  const addStep = () => {
    setNewSequence(prev => ({
      ...prev,
      steps: [...prev.steps, { order: prev.steps.length + 1, delayMinutes: 1, delayUnit: 'days', bodyTemplate: '' }],
    }));
  };

  const updateStep = (index: number, updates: Partial<SequenceStep>) => {
    setNewSequence(prev => ({
      ...prev,
      steps: prev.steps.map((step, i) => i === index ? { ...step, ...updates } : step),
    }));
  };

  const removeStep = (index: number) => {
    if (newSequence.steps.length <= 1) return;
    setNewSequence(prev => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i + 1 })),
    }));
  };

  const getStatusStyle = (status: string) => {
    if (status === 'ACTIVE') return { background: '#DCFCE7', color: '#166534' };
    if (status === 'PAUSED') return { background: '#FEF3C7', color: '#B45309' };
    return { background: '#F3F4F6', color: '#6B7280' };
  };

  if (!currentTenant) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>🔄</div>
          <div style={styles.emptyTitle}>Select a Tenant</div>
          <div style={styles.emptyText}>Please select a tenant from the dropdown above to manage sequences.</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={{ textAlign: 'center', padding: '60px', color: '#6B7280' }}>
          Loading sequences...
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerTop}>
          <div>
            <h1 style={styles.title}>Drip Sequences</h1>
            <p style={styles.subtitle}>Create automated multi-step message sequences</p>
          </div>
          <button
            onClick={() => { setShowForm(true); }}
            style={styles.primaryBtn}
            onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseOut={(e) => { e.currentTarget.style.transform = 'none'; }}
          >
            <span style={{ fontSize: '16px' }}>+</span> Create Sequence
          </button>
        </div>
      </div>

      {showForm && (
        <div style={styles.formCard}>
          <div style={styles.formTitle}>
            <span style={{ fontSize: '20px' }}>✨</span>
            New Sequence
          </div>
          
          <div style={styles.formGrid}>
            <div>
              <label style={styles.label}>Sequence Name</label>
              <input
                type="text"
                value={newSequence.name}
                onChange={(e) => setNewSequence(prev => ({ ...prev, name: e.target.value }))}
                style={styles.input}
                placeholder="e.g., New Customer Welcome"
                onFocus={(e) => { e.target.style.borderColor = '#3B82F6'; e.target.style.background = 'white'; }}
                onBlur={(e) => { e.target.style.borderColor = '#E5E7EB'; e.target.style.background = '#FAFAFA'; }}
              />
            </div>
            <div>
              <label style={styles.label}>Description (Optional)</label>
              <input
                type="text"
                value={newSequence.description}
                onChange={(e) => setNewSequence(prev => ({ ...prev, description: e.target.value }))}
                style={styles.input}
                placeholder="Brief description of this sequence"
                onFocus={(e) => { e.target.style.borderColor = '#3B82F6'; e.target.style.background = 'white'; }}
                onBlur={(e) => { e.target.style.borderColor = '#E5E7EB'; e.target.style.background = '#FAFAFA'; }}
              />
            </div>
          </div>

          <div style={styles.stepsSection}>
            <div style={styles.stepsHeader}>
              <div style={styles.stepsTitle}>Sequence Steps</div>
              <button
                onClick={addStep}
                style={styles.addStepBtn}
                onMouseOver={(e) => { e.currentTarget.style.background = '#DBEAFE'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = '#EFF6FF'; }}
              >
                + Add Step
              </button>
            </div>

            <div style={styles.timeline}>
              {newSequence.steps.length > 1 && <div style={styles.timelineLine} />}
              
              {newSequence.steps.map((step, index) => (
                <div key={index} style={styles.stepCard}>
                  <div style={styles.stepHeader}>
                    <div style={styles.stepTitle}>
                      <div style={styles.stepNumber}>{index + 1}</div>
                      <span style={styles.stepLabel}>
                        {index === 0 ? 'Initial Message' : `Follow-up ${index}`}
                      </span>
                    </div>
                    {index > 0 && (
                      <button
                        onClick={() => removeStep(index)}
                        style={styles.removeBtn}
                        onMouseOver={(e) => { e.currentTarget.style.background = '#FEE2E2'; }}
                        onMouseOut={(e) => { e.currentTarget.style.background = '#FEF2F2'; }}
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  {index > 0 && (
                    <div style={styles.delayRow}>
                      <span style={styles.delayLabel}>Send after waiting</span>
                      <input
                        type="number"
                        value={step.delayMinutes}
                        onChange={(e) => updateStep(index, { delayMinutes: parseInt(e.target.value) || 0 })}
                        style={styles.delayInput}
                        min="0"
                      />
                      <select
                        value={step.delayUnit}
                        onChange={(e) => updateStep(index, { delayUnit: e.target.value })}
                        style={styles.delaySelect}
                      >
                        <option value="minutes">Minutes</option>
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                      </select>
                    </div>
                  )}

                  <div>
                    <label style={styles.label}>Message Content</label>
                    <textarea
                      value={step.bodyTemplate}
                      onChange={(e) => updateStep(index, { bodyTemplate: e.target.value })}
                      style={styles.textarea}
                      placeholder="Hi {{firstName}}, thank you for your interest..."
                      onFocus={(e) => { e.target.style.borderColor = '#3B82F6'; e.target.style.background = 'white'; }}
                      onBlur={(e) => { e.target.style.borderColor = '#E5E7EB'; e.target.style.background = '#FAFAFA'; }}
                    />
                    <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '6px' }}>
                      Use {'{{firstName}}'}, {'{{companyName}}'}, {'{{agentName}}'} for personalization
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={styles.formActions}>
            <button
              onClick={handleCreateSequence}
              disabled={!newSequence.name || !newSequence.steps[0]?.bodyTemplate}
              style={{ 
                ...styles.primaryBtn, 
                opacity: (!newSequence.name || !newSequence.steps[0]?.bodyTemplate) ? 0.5 : 1 
              }}
            >
              Create Sequence
            </button>
            <button
              onClick={() => { 
                setShowForm(false); 
                setNewSequence({ name: '', description: '', steps: [{ order: 1, delayMinutes: 0, delayUnit: 'minutes', bodyTemplate: '' }] });
              }}
              style={styles.secondaryBtn}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {sequences.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>🔄</div>
          <div style={styles.emptyTitle}>No Sequences Yet</div>
          <div style={styles.emptyText}>
            Create automated drip sequences to engage your contacts with timed follow-up messages.
          </div>
          <button
            onClick={() => setShowForm(true)}
            style={styles.primaryBtn}
          >
            <span style={{ fontSize: '16px' }}>+</span> Create Your First Sequence
          </button>
        </div>
      ) : (
        <div style={styles.sequencesList}>
          {sequences.map((sequence) => (
            <div
              key={sequence.id}
              style={{
                ...styles.sequenceCard,
                ...(hoveredCard === sequence.id ? { 
                  borderColor: '#3B82F6', 
                  boxShadow: '0 4px 12px rgba(59, 130, 246, 0.1)' 
                } : {}),
              }}
              onMouseEnter={() => setHoveredCard(sequence.id)}
              onMouseLeave={() => setHoveredCard(null)}
            >
              <div style={styles.sequenceInfo}>
                <h3 style={styles.sequenceName}>{sequence.name}</h3>
                {sequence.description && (
                  <p style={styles.sequenceDesc}>{sequence.description}</p>
                )}
              </div>
              <div style={styles.sequenceMeta}>
                <div style={styles.metaItem}>
                  <div style={styles.metaValue}>{sequence.steps.length}</div>
                  <div style={styles.metaLabel}>Steps</div>
                </div>
                <div style={styles.metaItem}>
                  <div style={styles.metaValue}>{sequence._count?.enrollments || 0}</div>
                  <div style={styles.metaLabel}>Enrolled</div>
                </div>
                <div style={{ ...styles.statusBadge, ...getStatusStyle(sequence.status) }}>
                  {sequence.status}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
