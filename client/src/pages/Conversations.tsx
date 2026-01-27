import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import { api, Conversation, Contact } from '../api/client';

export default function Conversations() {
  const { selectedTenant } = useTenant();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [creating, setCreating] = useState(false);

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

  const fetchContacts = async () => {
    if (!selectedTenant) return;
    try {
      const data = await api.getContacts(selectedTenant.id);
      setContacts(data.contacts || []);
    } catch (error) {
      console.error('Failed to fetch contacts:', error);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, [selectedTenant, statusFilter, search]);

  // Auto-refresh conversations list every 10 seconds (only when not actively searching/interacting)
  useEffect(() => {
    const interval = setInterval(() => {
      // Don't refresh while modal is open, loading, or creating
      if (selectedTenant && !loading && !showNewModal && !creating) {
        api.getConversations(selectedTenant.id, {
          status: statusFilter || undefined,
          search: search || undefined,
        }).then(data => {
          setConversations(data);
        }).catch(() => {});
      }
    }, 10000);
    
    return () => clearInterval(interval);
  }, [selectedTenant, statusFilter, search, loading, showNewModal, creating]);

  const handleOpenNewModal = () => {
    fetchContacts();
    setShowNewModal(true);
    setSelectedContactId('');
  };

  const handleStartConversation = async () => {
    if (!selectedTenant || !selectedContactId) return;
    setCreating(true);
    try {
      const conversation = await api.createConversation(selectedTenant.id, selectedContactId);
      setShowNewModal(false);
      navigate(`/conversations/${conversation.id}`);
    } catch (error) {
      console.error('Failed to create conversation:', error);
      alert('Failed to start conversation');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Conversations</h2>
        <button className="btn btn-primary" onClick={handleOpenNewModal}>
          + New Conversation
        </button>
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
          <p className="empty-state">No conversations found. Click "+ New Conversation" to start one!</p>
        ) : (
          <ul className="conversation-list">
            {conversations.map(conv => (
              <li key={conv.id} className="conversation-item" style={conv.needsAttention ? { borderLeft: '4px solid #e53e3e', background: '#fff5f5' } : {}}>
                <Link to={`/conversations/${conv.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div className="name" style={conv.needsAttention ? { fontWeight: 700 } : {}}>
                        {conv.needsAttention && <span style={{ color: '#e53e3e', marginRight: '8px' }}>●</span>}
                        {conv.contact?.firstName} {conv.contact?.lastName}
                      </div>
                      <div className="phone">{conv.contact?.phone}</div>
                      {conv.messages?.[0] && (
                        <div className="preview">{conv.messages[0].body}</div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {conv.needsAttention && (
                          <span style={{ background: '#e53e3e', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                            Needs Attention
                          </span>
                        )}
                        <span className={`status-badge ${conv.status.toLowerCase()}`}>{conv.status}</span>
                      </div>
                      <div style={{ color: '#718096', fontSize: '12px', marginTop: '4px' }}>
                        {new Date(conv.lastMessageAt).toLocaleString()}
                      </div>
                      {conv.serviceTitanBookingId && (
                        <div style={{ color: '#805ad5', fontSize: '11px', marginTop: '2px' }}>
                          ST Booking: {conv.serviceTitanBookingId.substring(0, 8)}...
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showNewModal && (
        <div className="modal-overlay" onClick={() => setShowNewModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Start New Conversation</h3>
            <p style={{ color: '#718096', marginBottom: '16px' }}>Select a contact to message:</p>
            
            {contacts.length === 0 ? (
              <p className="empty-state">No contacts found. <Link to="/contacts">Add a contact first</Link>.</p>
            ) : (
              <select
                value={selectedContactId}
                onChange={(e) => setSelectedContactId(e.target.value)}
                style={{ width: '100%', padding: '10px', border: '1px solid #cbd5e0', borderRadius: '6px', marginBottom: '16px' }}
              >
                <option value="">-- Select a contact --</option>
                {contacts.map(contact => (
                  <option key={contact.id} value={contact.id}>
                    {contact.firstName} {contact.lastName} ({contact.phone})
                  </option>
                ))}
              </select>
            )}
            
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowNewModal(false)}>
                Cancel
              </button>
              <button 
                className="btn btn-primary" 
                onClick={handleStartConversation}
                disabled={!selectedContactId || creating}
              >
                {creating ? 'Starting...' : 'Start Conversation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
