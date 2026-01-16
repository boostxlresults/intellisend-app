import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import { api, Conversation, Campaign } from '../api/client';

export default function Dashboard() {
  const { selectedTenant } = useTenant();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedTenant) return;
    
    const fetchData = async () => {
      setLoading(true);
      try {
        const [convs, camps] = await Promise.all([
          api.getConversations(selectedTenant.id, { status: 'OPEN' }),
          api.getCampaigns(selectedTenant.id),
        ]);
        setConversations(convs);
        setCampaigns(camps);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [selectedTenant]);

  if (loading) {
    return <p>Loading dashboard...</p>;
  }

  const openConversations = conversations.length;
  const activeCampaigns = campaigns.filter(c => c.status === 'RUNNING' || c.status === 'SCHEDULED').length;
  const completedCampaigns = campaigns.filter(c => c.status === 'COMPLETED').length;

  return (
    <div>
      <div className="page-header">
        <h2>Dashboard</h2>
      </div>
      
      <div className="grid-3">
        <div className="card stat-card">
          <div className="value">{selectedTenant?._count?.contacts || 0}</div>
          <div className="label">Total Contacts</div>
        </div>
        <div className="card stat-card">
          <div className="value">{openConversations}</div>
          <div className="label">Open Conversations</div>
        </div>
        <div className="card stat-card">
          <div className="value">{activeCampaigns}</div>
          <div className="label">Active Campaigns</div>
        </div>
      </div>
      
      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginBottom: '16px' }}>Recent Conversations</h3>
          {conversations.length === 0 ? (
            <p className="empty-state">No open conversations</p>
          ) : (
            <ul className="conversation-list">
              {conversations.slice(0, 5).map(conv => (
                <li 
                  key={conv.id} 
                  className="conversation-item" 
                  onClick={() => navigate(`/conversations/${conv.id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="name">{conv.contact?.firstName} {conv.contact?.lastName}</div>
                  <div className="phone">{conv.contact?.phone}</div>
                  {conv.messages?.[0] && (
                    <div className="preview">{conv.messages[0].body}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        
        <div className="card">
          <h3 style={{ marginBottom: '16px' }}>Campaign Summary</h3>
          <div style={{ display: 'flex', gap: '30px' }}>
            <div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{campaigns.length}</div>
              <div style={{ color: '#718096' }}>Total</div>
            </div>
            <div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{activeCampaigns}</div>
              <div style={{ color: '#718096' }}>Active</div>
            </div>
            <div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{completedCampaigns}</div>
              <div style={{ color: '#718096' }}>Completed</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
