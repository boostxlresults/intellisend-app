import { useState, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import { api, Campaign, Segment } from '../api/client';

type AiGoal = 'higher_reply_rate' | 'more_compliant' | 'shorter' | 'friendlier';

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

export default function Campaigns() {
  const { selectedTenant } = useTenant();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showComplianceModal, setShowComplianceModal] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [campaignName, setCampaignName] = useState('');
  const [selectedSegment, setSelectedSegment] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [useAi, setUseAi] = useState(false);
  const [aiGoal, setAiGoal] = useState<AiGoal>('higher_reply_rate');
  const [improvedMessage, setImprovedMessage] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [complianceLoading, setComplianceLoading] = useState(false);
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

  const openCreateModal = async () => {
    await Promise.all([fetchSegments(), fetchTemplates()]);
    setShowCreateModal(true);
    setCampaignName('');
    setSelectedSegment('');
    setSelectedTemplate('');
    setMessageBody('');
    setUseAi(false);
    setImprovedMessage('');
    setImageUrl('');
  };

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId);
    if (templateId) {
      const template = templates.find(t => t.id === templateId);
      if (template) {
        setMessageBody(template.bodyTemplate);
      }
    }
  };

  const groupedTemplates = templates.reduce((acc, template) => {
    if (!acc[template.category]) {
      acc[template.category] = [];
    }
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
    if (!selectedTenant || !campaignName.trim() || !selectedSegment || !messageBody.trim()) {
      alert('Please fill in all required fields');
      return;
    }
    try {
      const campaign = await api.createCampaign(selectedTenant.id, {
        name: campaignName,
        type: 'BLAST',
        segmentId: selectedSegment,
        steps: [{
          bodyTemplate: improvedMessage || messageBody,
          delayMinutes: 0,
          useAiAssist: useAi,
          mediaUrl: imageUrl || undefined,
        }],
      });
      
      if (sendNow) {
        setSelectedCampaign(campaign);
        setCompliance({
          consentVerified: false,
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

  return (
    <div>
      <div className="page-header">
        <h2>Campaigns</h2>
        <button className="btn btn-primary" onClick={openCreateModal}>
          Create Campaign
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
                    <td>{campaign.type}</td>
                    <td>
                      <span className={`status-badge ${campaign.status.toLowerCase()}`}>
                        {campaign.status}
                      </span>
                    </td>
                    <td>
                      {complianceComplete ? (
                        <span style={{ color: '#38a169' }}>&#10003; Approved</span>
                      ) : (
                        <span style={{ color: '#ed8936' }}>Pending</span>
                      )}
                    </td>
                    <td>{campaign.segment?.name || '-'}</td>
                    <td>
                      {campaign.status === 'DRAFT' && (
                        <button
                          className="btn btn-small btn-secondary"
                          onClick={() => openComplianceReview(campaign)}
                        >
                          {complianceComplete ? 'Schedule' : 'Review & Send'}
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
      
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <h3>Create Blast Campaign</h3>
            <div className="form-group">
              <label>Campaign Name *</label>
              <input
                type="text"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="Enter campaign name"
              />
            </div>
            <div className="form-group">
              <label>Select Segment *</label>
              <select
                value={selectedSegment}
                onChange={(e) => setSelectedSegment(e.target.value)}
              >
                <option value="">Choose a segment</option>
                {segments.map(segment => (
                  <option key={segment.id} value={segment.id}>
                    {segment.name} ({segment._count?.members || 0} contacts)
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Use Template (Optional)</label>
              <select
                value={selectedTemplate}
                onChange={(e) => handleTemplateSelect(e.target.value)}
                style={{ marginBottom: '8px' }}
              >
                <option value="">-- Write custom message or select template --</option>
                {Object.entries(groupedTemplates).map(([category, categoryTemplates]) => (
                  <optgroup key={category} label={category.replace(/_/g, ' ')}>
                    {categoryTemplates.map(template => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {templates.length === 0 && (
                <p style={{ fontSize: '12px', color: '#718096', marginTop: '4px' }}>
                  No templates found. Create templates in the Templates page.
                </p>
              )}
            </div>
            <div className="form-group">
              <label>Message *</label>
              <textarea
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                placeholder="Hi {{firstName}}, this is a message from our team..."
              />
              <p style={{ fontSize: '12px', color: '#718096', marginTop: '4px' }}>
                Available variables: {'{{firstName}}'}, {'{{lastName}}'}, {'{{phone}}'}, {'{{companyName}}'}, {'{{agentName}}'}
              </p>
            </div>
            <div className="form-group">
              <label>Image URL (Optional - for MMS)</label>
              <input
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://example.com/image.jpg"
              />
              <p style={{ fontSize: '12px', color: '#718096', marginTop: '4px' }}>
                Paste a publicly accessible image URL. Tip: Upload images to <a href="https://imgbb.com" target="_blank" rel="noopener noreferrer">imgbb.com</a> for free hosting.
              </p>
              {imageUrl && (
                <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <img src={imageUrl} alt="Preview" style={{ maxWidth: '150px', maxHeight: '100px', borderRadius: '4px' }} />
                  <button type="button" className="btn btn-small btn-secondary" onClick={() => setImageUrl('')}>Clear</button>
                </div>
              )}
            </div>
            <div className="form-group">
              <div className="checkbox-group">
                <input
                  type="checkbox"
                  id="useAi"
                  checked={useAi}
                  onChange={(e) => setUseAi(e.target.checked)}
                />
                <label htmlFor="useAi" style={{ marginBottom: 0 }}>Use AI to improve message</label>
              </div>
            </div>
            {useAi && (
              <div className="form-group">
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
                  <select
                    value={aiGoal}
                    onChange={(e) => setAiGoal(e.target.value as AiGoal)}
                    style={{ padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e0' }}
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
                    {aiLoading ? 'Improving...' : 'Get AI Suggestion'}
                  </button>
                </div>
                {improvedMessage && (
                  <div style={{ marginTop: '10px', padding: '10px', background: '#f0fff4', borderRadius: '6px', border: '1px solid #9ae6b4' }}>
                    <strong>AI Improved:</strong>
                    <p style={{ marginTop: '4px' }}>{improvedMessage}</p>
                    <button
                      type="button"
                      className="btn btn-small btn-success"
                      style={{ marginTop: '8px' }}
                      onClick={() => {
                        setMessageBody(improvedMessage);
                        setImprovedMessage('');
                      }}
                    >
                      Use This
                    </button>
                  </div>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button className="btn btn-secondary" onClick={() => handleCreateCampaign(false)}>Save as Draft</button>
              <button className="btn btn-primary" onClick={() => handleCreateCampaign(true)}>Review & Send</button>
            </div>
          </div>
        </div>
      )}

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
              <div className="form-group checkbox-group" style={{ marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  id="consentVerified"
                  checked={compliance.consentVerified}
                  onChange={(e) => setCompliance(prev => ({ ...prev, consentVerified: e.target.checked }))}
                />
                <label htmlFor="consentVerified" style={{ marginBottom: 0 }}>
                  <strong>Prior Express Consent Verified</strong>
                  <p style={{ fontSize: '12px', color: '#718096', marginTop: '4px' }}>
                    I confirm that all recipients have provided prior express written consent to receive SMS marketing messages, per TCPA requirements.
                  </p>
                </label>
              </div>

              <div className="form-group checkbox-group" style={{ marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  id="optOutIncluded"
                  checked={compliance.optOutIncluded}
                  onChange={(e) => setCompliance(prev => ({ ...prev, optOutIncluded: e.target.checked }))}
                />
                <label htmlFor="optOutIncluded" style={{ marginBottom: 0 }}>
                  <strong>Opt-Out Instructions Included</strong>
                  <p style={{ fontSize: '12px', color: '#718096', marginTop: '4px' }}>
                    The message includes clear opt-out instructions (e.g., "Reply STOP to unsubscribe"). Note: IntelliSend automatically appends this.
                  </p>
                </label>
              </div>

              <div className="form-group checkbox-group" style={{ marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  id="quietHoursOk"
                  checked={compliance.quietHoursOk}
                  onChange={(e) => setCompliance(prev => ({ ...prev, quietHoursOk: e.target.checked }))}
                />
                <label htmlFor="quietHoursOk" style={{ marginBottom: 0 }}>
                  <strong>Quiet Hours Respected</strong>
                  <p style={{ fontSize: '12px', color: '#718096', marginTop: '4px' }}>
                    This campaign will not send messages before 8am or after 9pm in the recipient's local time zone (TCPA requirement).
                  </p>
                </label>
              </div>

              <div className="form-group checkbox-group" style={{ marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  id="contentReviewed"
                  checked={compliance.contentReviewed}
                  onChange={(e) => setCompliance(prev => ({ ...prev, contentReviewed: e.target.checked }))}
                />
                <label htmlFor="contentReviewed" style={{ marginBottom: 0 }}>
                  <strong>Message Content Reviewed</strong>
                  <p style={{ fontSize: '12px', color: '#718096', marginTop: '4px' }}>
                    I have reviewed the message content and confirm it is appropriate, not deceptive, and complies with carrier guidelines.
                  </p>
                </label>
              </div>
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
