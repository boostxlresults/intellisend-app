import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import { api, Conversation } from '../api/client';

export default function Conversations() {
  const { selectedTenant } = useTenant();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const fetchConversations = async () => {
    if (!selectedTenant) return;
    setLoading(true);
    try {
      const data = await api.getConversations(selectedTenant.id, {
        status: statusFilter || undefined,
        search: search || undefined,
      });
      setConversations(data);
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, [selectedTenant, statusFilter, search]);

  return (
    <div>
      <div className="page-header">
        <h2>Conversations</h2>
      </div>
      
      <div className="card">
        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
          <input
            type="text"
            placeholder="Search by phone or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: '10px', border: '1px solid #cbd5e0', borderRadius: '6px', width: '250px' }}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: '10px', border: '1px solid #cbd5e0', borderRadius: '6px' }}
          >
            <option value="">All Status</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
        
        {loading ? (
          <p>Loading conversations...</p>
        ) : conversations.length === 0 ? (
          <p className="empty-state">No conversations found</p>
        ) : (
          <ul className="conversation-list">
            {conversations.map(conv => (
              <li key={conv.id} className="conversation-item">
                <Link to={`/conversations/${conv.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div className="name">{conv.contact?.firstName} {conv.contact?.lastName}</div>
                      <div className="phone">{conv.contact?.phone}</div>
                      {conv.messages?.[0] && (
                        <div className="preview">{conv.messages[0].body}</div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className={`status-badge ${conv.status.toLowerCase()}`}>{conv.status}</span>
                      <div style={{ color: '#718096', fontSize: '12px', marginTop: '4px' }}>
                        {new Date(conv.lastMessageAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
