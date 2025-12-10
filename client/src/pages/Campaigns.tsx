import { useState, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import { api, Campaign, Segment } from '../api/client';

export default function Campaigns() {
  const { selectedTenant } = useTenant();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [selectedSegment, setSelectedSegment] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [useAi, setUseAi] = useState(false);
  const [improvedMessage, setImprovedMessage] = useState('');

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

  useEffect(() => {
    fetchCampaigns();
  }, [selectedTenant]);

  const openCreateModal = async () => {
    await fetchSegments();
    setShowCreateModal(true);
    setCampaignName('');
    setSelectedSegment('');
    setMessageBody('');
    setUseAi(false);
    setImprovedMessage('');
  };

  const handleAiImprove = async () => {
    if (!selectedTenant || !messageBody.trim()) return;
    try {
      const result = await api.aiImproveMessage(selectedTenant.id, messageBody, 'higher_reply_rate');
      setImprovedMessage(result.text);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('AI improvement failed: ' + message);
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
        }],
      });
      
      if (sendNow) {
        await api.scheduleCampaign(selectedTenant.id, campaign.id);
      }
      
      setShowCreateModal(false);
      fetchCampaigns();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to create campaign: ' + message);
    }
  };

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
                <th>Segment</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(campaign => (
                <tr key={campaign.id}>
                  <td>{campaign.name}</td>
                  <td>{campaign.type}</td>
                  <td>
                    <span className={`status-badge ${campaign.status.toLowerCase()}`}>
                      {campaign.status}
                    </span>
                  </td>
                  <td>{campaign.segment?.name || '-'}</td>
                  <td>{new Date(campaign.id).toLocaleDateString()}</td>
                </tr>
              ))}
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
              <label>Message *</label>
              <textarea
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                placeholder="Hi {{firstName}}, this is a message from our team..."
              />
              <p style={{ fontSize: '12px', color: '#718096', marginTop: '4px' }}>
                Available variables: {'{{firstName}}'}, {'{{lastName}}'}, {'{{phone}}'}
              </p>
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
                <button type="button" className="btn btn-secondary btn-small" onClick={handleAiImprove}>
                  Get AI Suggestion
                </button>
                {improvedMessage && (
                  <div style={{ marginTop: '10px', padding: '10px', background: '#f0fff4', borderRadius: '6px', border: '1px solid #9ae6b4' }}>
                    <strong>AI Improved:</strong>
                    <p style={{ marginTop: '4px' }}>{improvedMessage}</p>
                    <button
                      type="button"
                      className="btn btn-small btn-success"
                      style={{ marginTop: '8px' }}
                      onClick={() => setMessageBody(improvedMessage)}
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
              <button className="btn btn-primary" onClick={() => handleCreateCampaign(true)}>Send Now</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
