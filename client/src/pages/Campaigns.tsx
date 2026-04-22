import { useState, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import { api, Campaign, Segment } from '../api/client';

type AiGoal = 'higher_reply_rate' | 'more_compliant' | 'shorter' | 'friendlier';
type CampaignType = 'BLAST' | 'PSA';

interface ComplianceChecklist {
  consentVerified: boolean;
  optOutIncluded: boolean;
  quietHoursOk: boolean;
  contentReviewed: boolean;
  notes: string;
}

interface Template {
  id: string;
  name: string;
  category: string;
  bodyTemplate: string;
}

// ── Character / segment counter ──────────────────────────────────────────────
function SmsCounter({ body }: { body: string }) {
  const len = body.length;
  const isUnicode = /[^\x00-\x7F]/.test(body);
  const segmentSize = isUnicode ? 70 : 160;
  const multiSegmentSize = isUnicode ? 67 : 153;
  let segments = 1;
  if (len > segmentSize) {
    segments = Math.ceil(len / multiSegmentSize);
  }
  const color = len > 320 ? '#e53e3e' : len > 160 ? '#ed8936' : '#718096';
  return (
    <p style={{ fontSize: '12px', color, marginTop: '4px' }}>
      {len} characters · {segments} SMS segment{segments > 1 ? 's' : ''}
      {isUnicode && ' · Unicode detected (shorter limit)'}
      {' '}· IntelliSend auto-appends "Reply STOP to unsubscribe"
    </p>
  );
}

// ── Campaign type card ────────────────────────────────────────────────────────
function TypeCard({
  type,
  selected,
  onClick,
}: {
  type: CampaignType;
  selected: boolean;
  onClick: () => void;
}) {
  const isBlast = type === 'BLAST';
  return (
    <div
      onClick={onClick}
      style={{
        flex: 1,
        border: `2px solid ${selected ? '#3182ce' : '#e2e8f0'}`,
        borderRadius: '10px',
        padding: '14px 16px',
        cursor: 'pointer',
        background: selected ? '#ebf8ff' : '#fff',
        transition: 'all 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <span style={{ fontSize: '20px' }}>{isBlast ? '📣' : '📢'}</span>
        <strong style={{ color: selected ? '#2b6cb0' : '#2d3748' }}>
          {isBlast ? 'Blast Campaign' : 'PSA Campaign'}
        </strong>
        {selected && (
          <span style={{ marginLeft: 'auto', color: '#3182ce', fontSize: '16px' }}>✓</span>
        )}
      </div>
      <p style={{ fontSize: '12px', color: '#718096', margin: 0 }}>
        {isBlast
          ? 'Send a promotional message to opted-in contacts. Requires TCPA compliance review.'
          : 'Send a public service announcement to cold contacts. Opt-in replies (Y) are auto-promoted to your warm segment.'}
      </p>
    </div>
  );
}

export default function Campaigns() {
  const { selectedTenant } = useTenant();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showComplianceModal, setShowComplianceModal] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

  // Form state
  const [campaignType, setCampaignType] = useState<CampaignType>('BLAST');
  const [campaignName, setCampaignName] = useState('');
  const [selectedSegments, setSelectedSegments] = useState<string[]>([]);
  const [psaOptInSegmentId, setPsaOptInSegmentId] = useState('');
  const [psaOptInCooldownHours, setPsaOptInCooldownHours] = useState(24);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [useAi, setUseAi] = useState(false);
  const [aiGoal, setAiGoal] = useState<AiGoal>('higher_reply_rate');
  const [improvedMessage, setImprovedMessage] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [sendAsMms, setSendAsMms] = useState(false);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [showEditStepModal, setShowEditStepModal] = useState(false);
  const [editStepBody, setEditStepBody] = useState('');
  const [editStepLoading, setEditStepLoading] = useState(false);
  const [compliance, setCompliance] = useState<ComplianceChecklist>({
    consentVerified: false,
    optOutIncluded: false,
    quietHoursOk: false,
    contentReviewed: false,
    notes: '',
  });

  const fetchCampaigns = async () => {
    if (!selectedTenant) return;
    setLoading(true);
    try {
      const data = await api.getCampaigns(selectedTenant.id);
      setCampaigns(data);
    } catch (error) {
      console.error('Failed to fetch campaigns:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSegments = async () => {
    if (!selectedTenant) return;
    try {
      const data = await api.getSegments(selectedTenant.id);
      setSegments(data);
    } catch (error) {
      console.error('Failed to fetch segments:', error);
    }
  };

  const fetchTemplates = async () => {
    if (!selectedTenant) return;
    try {
      const data = await api.getTemplates(selectedTenant.id);
      setTemplates(data);
    } catch (error) {
      console.error('Failed to fetch templates:', error);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, [selectedTenant]);

  const resetForm = () => {
    setCampaignType('BLAST');
    setCampaignName('');
    setSelectedSegments([]);
    setPsaOptInSegmentId('');
    setPsaOptInCooldownHours(24);
    setSelectedTemplate('');
    setMessageBody('');
    setUseAi(false);
    setImprovedMessage('');
    setImageUrl('');
    setSendAsMms(false);
  };

  const openCreateModal = async () => {
    await Promise.all([fetchSegments(), fetchTemplates()]);
    resetForm();
    setShowCreateModal(true);
  };

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId);
    if (templateId) {
      const template = templates.find(t => t.id === templateId);
      if (template) setMessageBody(template.bodyTemplate);
    }
  };

  const groupedTemplates = templates.reduce((acc, template) => {
    if (!acc[template.category]) acc[template.category] = [];
    acc[template.category].push(template);
    return acc;
  }, {} as Record<string, Template[]>);

  const handleAiImprove = async () => {
    if (!selectedTenant || !messageBody.trim()) return;
    setAiLoading(true);
    try {
      const result = await api.aiImproveMessage(selectedTenant.id, messageBody, aiGoal);
      setImprovedMessage(result.text);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('AI improvement failed: ' + message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleCreateCampaign = async (sendNow: boolean) => {
    if (!selectedTenant || !campaignName.trim() || selectedSegments.length === 0 || !messageBody.trim()) {
      alert('Please fill in all required fields');
      return;
    }
    if (campaignType === 'PSA' && !psaOptInSegmentId) {
      alert('PSA campaigns require an Opt-In Destination Segment. Please select one.');
      return;
    }
    try {
      const campaign = await api.createCampaign(selectedTenant.id, {
        name: campaignName,
        type: campaignType,
        segmentIds: selectedSegments,
        psaOptInSegmentId: campaignType === 'PSA' ? psaOptInSegmentId : undefined,
        psaOptInCooldownHours: campaignType === 'PSA' ? psaOptInCooldownHours : undefined,
        steps: [{
          bodyTemplate: improvedMessage || messageBody,
          delayMinutes: 0,
          useAiAssist: useAi,
          mediaUrl: imageUrl || undefined,
          sendAsMms: sendAsMms,
        }],
      } as any);

      if (sendNow) {
        setSelectedCampaign(campaign);
        setCompliance({
          consentVerified: campaignType === 'PSA', // PSA doesn't need prior consent
          optOutIncluded: false,
          quietHoursOk: false,
          contentReviewed: false,
          notes: '',
        });
        setShowCreateModal(false);
        setShowComplianceModal(true);
      } else {
        setShowCreateModal(false);
        fetchCampaigns();
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to create campaign: ' + message);
    }
  };

  const openComplianceReview = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setCompliance({
      consentVerified: (campaign as any).complianceConsentVerified || false,
      optOutIncluded: (campaign as any).complianceOptOutIncluded || false,
      quietHoursOk: (campaign as any).complianceQuietHoursOk || false,
      contentReviewed: (campaign as any).complianceContentReviewed || false,
      notes: (campaign as any).complianceNotes || '',
    });
    setShowComplianceModal(true);
  };

  const handleComplianceSubmit = async () => {
    if (!selectedTenant || !selectedCampaign) return;
    setComplianceLoading(true);
    try {
      await api.updateCampaignCompliance(selectedTenant.id, selectedCampaign.id, compliance);
      if (compliance.consentVerified && compliance.optOutIncluded && compliance.quietHoursOk && compliance.contentReviewed) {
        await api.scheduleCampaign(selectedTenant.id, selectedCampaign.id);
        alert('Compliance approved and campaign scheduled!');
      } else {
        alert('Compliance checklist saved. Complete all items to schedule the campaign.');
      }
      setShowComplianceModal(false);
      fetchCampaigns();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to update compliance: ' + message);
    } finally {
      setComplianceLoading(false);
    }
  };

  const allComplianceChecked = compliance.consentVerified && compliance.optOutIncluded && compliance.quietHoursOk && compliance.contentReviewed;

  const openEditStepModal = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setEditStepBody(campaign.steps?.[0]?.bodyTemplate || '');
    setShowEditStepModal(true);
  };

  const handleEditStepSubmit = async () => {
    if (!selectedTenant || !selectedCampaign || !selectedCampaign.steps?.[0]) return;
    if (!editStepBody.trim()) { alert('Message body cannot be empty.'); return; }
    setEditStepLoading(true);
    try {
      await api.updateCampaignStep(
        selectedTenant.id,
        selectedCampaign.id,
        selectedCampaign.steps[0].id,
        { bodyTemplate: editStepBody.trim() }
      );
      alert('Campaign message updated successfully!');
      setShowEditStepModal(false);
      fetchCampaigns();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to update campaign step: ' + message);
    } finally {
      setEditStepLoading(false);
    }
  };

  // ── Shared section heading style ─────────────────────────────────────────
  const sectionLabel: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#718096',
    marginBottom: '8px',
    marginTop: '20px',
  };

  const divider: React.CSSProperties = {
    borderTop: '1px solid #e2e8f0',
    margin: '20px 0 0',
  };

  return (
    <div>
      <div className="page-header">
        <h2>Campaigns</h2>
        <button className="btn btn-primary" onClick={openCreateModal}>
          + Create Campaign
        </button>
      </div>

      <div className="card">
        {loading ? (
          <p>Loading campaigns...</p>
        ) : campaigns.length === 0 ? (
          <p className="empty-state">No campaigns created yet</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Status</th>
                <th>Compliance</th>
                <th>Segment</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(campaign => {
                const c = campaign as any;
                const complianceComplete = c.complianceConsentVerified && c.complianceOptOutIncluded && c.complianceQuietHoursOk && c.complianceContentReviewed;
                return (
                  <tr key={campaign.id}>
                    <td>{campaign.name}</td>
                    <td>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 600,
                        background: campaign.type === 'PSA' ? '#fef3c7' : '#ebf8ff',
                        color: campaign.type === 'PSA' ? '#92400e' : '#2b6cb0',
                      }}>
                        {campaign.type === 'PSA' ? '📢 PSA' : '📣 BLAST'}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${campaign.status.toLowerCase()}`}>
                        {campaign.status}
                      </span>
                    </td>
                    <td>
                      {complianceComplete ? (
                        <span style={{ color: '#38a169' }}>✓ Approved</span>
                      ) : (
                        <span style={{ color: '#ed8936' }}>Pending</span>
                      )}
                    </td>
                    <td>{
                      (campaign as any).campaignSegments?.length > 0
                        ? (campaign as any).campaignSegments.map((cs: any) => cs.segment?.name).filter(Boolean).join(', ')
                        : campaign.segment?.name || '-'
                    }</td>
                    <td style={{ display: 'flex', gap: '4px' }}>
                      {['DRAFT', 'SCHEDULED', 'PAUSED'].includes(campaign.status) && campaign.steps?.length > 0 && (
                        <button
                          className="btn btn-small btn-secondary"
                          onClick={() => openEditStepModal(campaign)}
                          title="Edit message body"
                        >
                          Edit
                        </button>
                      )}
                      {campaign.status === 'DRAFT' && (
                        <button
                          className="btn btn-small btn-secondary"
                          onClick={() => openComplianceReview(campaign)}
                        >
                          {complianceComplete ? 'Schedule' : 'Review & Send'}
                        </button>
                      )}
                      {(campaign.status === 'SCHEDULED' || campaign.status === 'RUNNING') && (
                        <button
                          className="btn btn-small"
                          style={{ backgroundColor: '#e53e3e', color: 'white', border: 'none' }}
                          onClick={async () => {
                            if (!selectedTenant) return;
                            if (!confirm('Are you sure you want to PAUSE this campaign? All pending messages will be cancelled.')) return;
                            try {
                              const res = await fetch(`/api/tenants/${selectedTenant.id}/campaigns/${campaign.id}/pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                              const data = await res.json();
                              alert(data.message || 'Campaign paused');
                              const updated = await api.getCampaigns(selectedTenant.id);
                              setCampaigns(updated);
                            } catch {
                              alert('Failed to pause campaign');
                            }
                          }}
                        >
                          STOP
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── CREATE CAMPAIGN MODAL ─────────────────────────────────────────── */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div
            className="modal"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '640px', padding: '28px 32px' }}
          >
            {/* Header */}
            <div style={{ marginBottom: '4px' }}>
              <h3 style={{ margin: 0, fontSize: '20px', color: '#1a202c' }}>Create Campaign</h3>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#718096' }}>
                Fill in the details below. Required fields are marked with *.
              </p>
            </div>

            {/* ── STEP 1: Campaign Type ── */}
            <div style={divider} />
            <p style={sectionLabel}>Step 1 — Campaign Type</p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <TypeCard type="BLAST" selected={campaignType === 'BLAST'} onClick={() => setCampaignType('BLAST')} />
              <TypeCard type="PSA" selected={campaignType === 'PSA'} onClick={() => setCampaignType('PSA')} />
            </div>

            {/* PSA info banner */}
            {campaignType === 'PSA' && (
              <div style={{
                marginTop: '12px',
                padding: '12px 14px',
                background: '#fffbeb',
                border: '1px solid #f6e05e',
                borderRadius: '8px',
                fontSize: '13px',
                color: '#744210',
              }}>
                <strong>📋 How PSA campaigns work:</strong> Your message is sent as a public service announcement to cold contacts. When a contact replies <strong>Y</strong>, they are automatically moved to your selected opt-in segment and a 24-hour cooldown begins before any marketing messages are sent. This is the legally safe way to build your opted-in list.
              </div>
            )}

            {/* ── STEP 2: Campaign Name ── */}
            <div style={divider} />
            <p style={sectionLabel}>Step 2 — Campaign Details</p>
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label style={{ fontWeight: 600, fontSize: '14px' }}>Campaign Name *</label>
              <input
                type="text"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="e.g. Summer AC Tune-Up Blast — June 2026"
                style={{ marginTop: '6px' }}
              />
            </div>

            {/* ── STEP 3: Segments ── */}
            <div style={divider} />
            <p style={sectionLabel}>
              Step 3 — {campaignType === 'PSA' ? 'Target Segment (Who receives the PSA)' : 'Select Segments'} *
            </p>
            <div style={{
              border: '1px solid #cbd5e0',
              borderRadius: '8px',
              maxHeight: '180px',
              overflowY: 'auto',
              padding: '8px',
              background: '#fafafa',
            }}>
              {segments.length === 0 ? (
                <p style={{ color: '#718096', margin: 0, fontSize: '14px', padding: '8px' }}>
                  No segments available. Create segments first.
                </p>
              ) : (
                segments.map(segment => (
                  <label
                    key={segment.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 10px',
                      cursor: 'pointer',
                      borderRadius: '6px',
                      marginBottom: '2px',
                      background: selectedSegments.includes(segment.id) ? '#ebf8ff' : 'transparent',
                      border: selectedSegments.includes(segment.id) ? '1px solid #bee3f8' : '1px solid transparent',
                      transition: 'all 0.1s',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSegments.includes(segment.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedSegments(prev => [...prev, segment.id]);
                        } else {
                          setSelectedSegments(prev => prev.filter(id => id !== segment.id));
                        }
                      }}
                      style={{ width: '16px', height: '16px', accentColor: '#3182ce' }}
                    />
                    <span style={{ fontWeight: 500, fontSize: '14px' }}>{segment.name}</span>
                    <span style={{
                      marginLeft: 'auto',
                      fontSize: '12px',
                      color: '#718096',
                      background: '#edf2f7',
                      padding: '2px 8px',
                      borderRadius: '10px',
                    }}>
                      {(segment as any)._count?.members || 0} contacts
                    </span>
                  </label>
                ))
              )}
            </div>
            {selectedSegments.length > 0 && (
              <p style={{ fontSize: '12px', color: '#3182ce', marginTop: '6px' }}>
                ✓ {selectedSegments.length} segment{selectedSegments.length > 1 ? 's' : ''} selected
              </p>
            )}

            {/* PSA Opt-In Segment */}
            {campaignType === 'PSA' && (
              <>
                <div style={{ marginTop: '16px' }}>
                  <label style={{ fontWeight: 600, fontSize: '14px', display: 'block', marginBottom: '6px' }}>
                    Opt-In Destination Segment * <span style={{ fontWeight: 400, color: '#718096', fontSize: '12px' }}>(Where "Y" repliers are moved)</span>
                  </label>
                  <select
                    value={psaOptInSegmentId}
                    onChange={(e) => setPsaOptInSegmentId(e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', border: '1px solid #cbd5e0', fontSize: '14px' }}
                  >
                    <option value="">-- Select a warm marketing segment --</option>
                    {segments
                      .filter(s => !selectedSegments.includes(s.id))
                      .map(segment => (
                        <option key={segment.id} value={segment.id}>
                          {segment.name} ({(segment as any)._count?.members || 0} contacts)
                        </option>
                      ))}
                  </select>
                  <p style={{ fontSize: '12px', color: '#718096', marginTop: '4px' }}>
                    Contacts who reply Y will be added to this segment and receive a 24-hour cooldown before marketing messages begin.
                  </p>
                </div>
                <div style={{ marginTop: '12px' }}>
                  <label style={{ fontWeight: 600, fontSize: '14px', display: 'block', marginBottom: '6px' }}>
                    Opt-In Cooldown (hours)
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <input
                      type="number"
                      min={1}
                      max={72}
                      value={psaOptInCooldownHours}
                      onChange={(e) => setPsaOptInCooldownHours(Number(e.target.value))}
                      style={{ width: '90px', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e0', fontSize: '14px' }}
                    />
                    <span style={{ fontSize: '13px', color: '#718096' }}>
                      hours before first marketing message (default: 24h, recommended: 24–48h)
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* ── STEP 4: Message ── */}
            <div style={divider} />
            <p style={sectionLabel}>Step 4 — Message Content</p>

            {/* Template picker */}
            <div className="form-group" style={{ marginBottom: '12px' }}>
              <label style={{ fontWeight: 600, fontSize: '14px' }}>
                Use Template <span style={{ fontWeight: 400, color: '#718096' }}>(Optional)</span>
              </label>
              <select
                value={selectedTemplate}
                onChange={(e) => handleTemplateSelect(e.target.value)}
                style={{ marginTop: '6px' }}
              >
                <option value="">-- Write custom message or select template --</option>
                {Object.entries(groupedTemplates).map(([category, categoryTemplates]) => (
                  <optgroup key={category} label={category.replace(/_/g, ' ')}>
                    {categoryTemplates.map(template => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Message textarea */}
            <div className="form-group" style={{ marginBottom: '8px' }}>
              <label style={{ fontWeight: 600, fontSize: '14px' }}>Message *</label>
              <textarea
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                placeholder={
                  campaignType === 'PSA'
                    ? 'IMPORTANT: [Your business] is offering free AC safety inspections this summer. Reply Y to receive updates and schedule yours. Reply STOP to opt out.'
                    : 'Hi {{firstName}}, this is {{agentName}} from {{companyName}}...'
                }
                rows={5}
                style={{ marginTop: '6px', fontFamily: 'inherit', fontSize: '14px', lineHeight: '1.5' }}
              />
              <SmsCounter body={messageBody} />
              <p style={{ fontSize: '12px', color: '#a0aec0', marginTop: '2px' }}>
                Variables: {'{{firstName}}'} · {'{{lastName}}'} · {'{{phone}}'} · {'{{companyName}}'} · {'{{agentName}}'}
              </p>
            </div>

            {/* AI Improve */}
            <div className="form-group" style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 500,
                }}>
                  <input
                    type="checkbox"
                    checked={useAi}
                    onChange={(e) => setUseAi(e.target.checked)}
                    style={{ width: '15px', height: '15px', accentColor: '#3182ce' }}
                  />
                  ✨ AI-improve this message
                </label>
                {useAi && (
                  <>
                    <select
                      value={aiGoal}
                      onChange={(e) => setAiGoal(e.target.value as AiGoal)}
                      style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e0', fontSize: '13px' }}
                    >
                      <option value="higher_reply_rate">Higher Reply Rate</option>
                      <option value="more_compliant">More Compliant</option>
                      <option value="shorter">Shorter</option>
                      <option value="friendlier">Friendlier</option>
                    </select>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={handleAiImprove}
                      disabled={aiLoading || !messageBody.trim()}
                    >
                      {aiLoading ? '⏳ Improving...' : 'Get Suggestion'}
                    </button>
                  </>
                )}
              </div>
              {improvedMessage && (
                <div style={{ marginTop: '10px', padding: '12px', background: '#f0fff4', borderRadius: '8px', border: '1px solid #9ae6b4' }}>
                  <strong style={{ fontSize: '13px' }}>✨ AI Suggestion:</strong>
                  <p style={{ marginTop: '6px', fontSize: '14px', whiteSpace: 'pre-wrap' }}>{improvedMessage}</p>
                  <button
                    type="button"
                    className="btn btn-small btn-success"
                    style={{ marginTop: '8px' }}
                    onClick={() => { setMessageBody(improvedMessage); setImprovedMessage(''); }}
                  >
                    Use This Message
                  </button>
                </div>
              )}
            </div>

            {/* ── STEP 5: MMS / Image ── */}
            <div style={divider} />
            <p style={sectionLabel}>Step 5 — MMS Image <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(Optional)</span></p>
            <div className="form-group" style={{ marginBottom: '8px' }}>
              <input
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://example.com/image.jpg"
              />
              <p style={{ fontSize: '12px', color: '#718096', marginTop: '4px' }}>
                Paste a public image URL. Free hosting: <a href="https://imgbb.com" target="_blank" rel="noopener noreferrer">imgbb.com</a>
              </p>
              {imageUrl && (
                <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <img src={imageUrl} alt="Preview" style={{ maxWidth: '120px', maxHeight: '90px', borderRadius: '6px', border: '1px solid #e2e8f0' }} />
                  <button type="button" className="btn btn-small btn-secondary" onClick={() => setImageUrl('')}>✕ Clear</button>
                </div>
              )}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer', marginBottom: '4px' }}>
              <input
                type="checkbox"
                checked={sendAsMms}
                onChange={(e) => setSendAsMms(e.target.checked)}
                style={{ width: '15px', height: '15px', accentColor: '#3182ce' }}
              />
              <span>Send as MMS</span>
              <span style={{ fontSize: '12px', color: '#718096' }}>(supports up to 1,600 characters in one message)</span>
            </label>

            {/* ── Action buttons ── */}
            <div style={{ ...divider, marginTop: '24px' }} />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button className="btn btn-secondary" onClick={() => handleCreateCampaign(false)}>Save as Draft</button>
              <button
                className="btn btn-primary"
                onClick={() => handleCreateCampaign(true)}
                style={{ minWidth: '140px' }}
              >
                Review &amp; Send →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT STEP MODAL ───────────────────────────────────────────────── */}
      {showEditStepModal && selectedCampaign && (
        <div className="modal-overlay" onClick={() => setShowEditStepModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '560px' }}>
            <h3>Edit Campaign Message</h3>
            <p style={{ color: '#718096', marginBottom: '16px', fontSize: '14px' }}>
              Campaign: <strong>{selectedCampaign.name}</strong>
              <span style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', background: '#ebf8ff', color: '#2b6cb0' }}>
                {selectedCampaign.status}
              </span>
            </p>
            <div className="form-group">
              <label>Message Body</label>
              <textarea
                value={editStepBody}
                onChange={(e) => setEditStepBody(e.target.value)}
                rows={6}
                style={{ fontFamily: 'inherit', fontSize: '14px' }}
                placeholder="Enter your message..."
              />
              <SmsCounter body={editStepBody} />
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowEditStepModal(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleEditStepSubmit}
                disabled={editStepLoading || !editStepBody.trim()}
              >
                {editStepLoading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── COMPLIANCE MODAL ─────────────────────────────────────────────── */}
      {showComplianceModal && selectedCampaign && (
        <div className="modal-overlay" onClick={() => setShowComplianceModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <h3>TCPA Compliance Review</h3>
            <p style={{ color: '#718096', marginBottom: '16px' }}>
              Complete this checklist before sending. All items are required for US compliance.
            </p>

            <div style={{ background: '#f7fafc', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
              <h4 style={{ marginBottom: '12px' }}>Campaign: {selectedCampaign.name}</h4>
              {selectedCampaign.steps?.[0] && (
                <div style={{ background: 'white', padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <strong>Message Preview:</strong>
                  <p style={{ marginTop: '8px', whiteSpace: 'pre-wrap' }}>{selectedCampaign.steps[0].bodyTemplate}</p>
                </div>
              )}
            </div>

            <div style={{ marginBottom: '16px' }}>
              {[
                {
                  id: 'consentVerified',
                  key: 'consentVerified' as keyof ComplianceChecklist,
                  label: 'Prior Express Consent Verified',
                  desc: (selectedCampaign as any).type === 'PSA'
                    ? 'PSA campaigns do not require prior consent — recipients are cold contacts receiving a public service announcement.'
                    : 'I confirm that all recipients have provided prior express written consent to receive SMS marketing messages, per TCPA requirements.',
                },
                {
                  id: 'optOutIncluded',
                  key: 'optOutIncluded' as keyof ComplianceChecklist,
                  label: 'Opt-Out Instructions Included',
                  desc: 'The message includes clear opt-out instructions. Note: IntelliSend automatically appends "Reply STOP to unsubscribe".',
                },
                {
                  id: 'quietHoursOk',
                  key: 'quietHoursOk' as keyof ComplianceChecklist,
                  label: 'Quiet Hours Respected',
                  desc: 'IntelliSend will not send messages before 8 AM or after 9 PM in each recipient\'s local time zone (TCPA requirement).',
                },
                {
                  id: 'contentReviewed',
                  key: 'contentReviewed' as keyof ComplianceChecklist,
                  label: 'Message Content Reviewed',
                  desc: 'I have reviewed the message content and confirm it is appropriate, not deceptive, and complies with carrier guidelines.',
                },
              ].map(item => (
                <div key={item.id} className="form-group checkbox-group" style={{ marginBottom: '12px' }}>
                  <input
                    type="checkbox"
                    id={item.id}
                    checked={compliance[item.key] as boolean}
                    onChange={(e) => setCompliance(prev => ({ ...prev, [item.key]: e.target.checked }))}
                  />
                  <label htmlFor={item.id} style={{ marginBottom: 0 }}>
                    <strong>{item.label}</strong>
                    <p style={{ fontSize: '12px', color: '#718096', marginTop: '4px' }}>{item.desc}</p>
                  </label>
                </div>
              ))}
            </div>

            <div className="form-group">
              <label>Notes (optional)</label>
              <textarea
                value={compliance.notes}
                onChange={(e) => setCompliance(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Any additional notes about this compliance review..."
                rows={2}
              />
            </div>

            {!allComplianceChecked && (
              <div style={{ background: '#fffaf0', padding: '12px', borderRadius: '6px', marginBottom: '16px', borderLeft: '4px solid #ed8936' }}>
                <strong style={{ color: '#c05621' }}>All items must be checked to proceed</strong>
                <p style={{ color: '#744210', fontSize: '13px', marginTop: '4px' }}>
                  Complete all compliance requirements before scheduling this campaign.
                </p>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowComplianceModal(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleComplianceSubmit}
                disabled={complianceLoading || !allComplianceChecked}
              >
                {complianceLoading ? 'Processing...' : 'Approve & Schedule Campaign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
