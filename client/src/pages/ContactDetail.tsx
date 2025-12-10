import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import { api, Contact } from '../api/client';

export default function ContactDetail() {
  const { contactId } = useParams<{ contactId: string }>();
  const { selectedTenant } = useTenant();
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [newTag, setNewTag] = useState('');

  const fetchContact = async () => {
    if (!selectedTenant || !contactId) return;
    setLoading(true);
    try {
      const data = await api.getContact(selectedTenant.id, contactId);
      setContact(data);
    } catch (error) {
      console.error('Failed to fetch contact:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContact();
  }, [selectedTenant, contactId]);

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant || !contactId || !newTag.trim()) return;
    try {
      await api.addContactTag(selectedTenant.id, contactId, newTag.trim());
      setNewTag('');
      fetchContact();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to add tag: ' + message);
    }
  };

  const handleRemoveTag = async (tag: string) => {
    if (!selectedTenant || !contactId) return;
    try {
      await api.removeContactTag(selectedTenant.id, contactId, tag);
      fetchContact();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to remove tag: ' + message);
    }
  };

  if (loading) {
    return <p>Loading contact...</p>;
  }

  if (!contact) {
    return <p>Contact not found</p>;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/contacts" style={{ color: '#718096', textDecoration: 'none', fontSize: '14px' }}>
            &larr; Back to Contacts
          </Link>
          <h2 style={{ marginTop: '8px' }}>{contact.firstName} {contact.lastName}</h2>
        </div>
      </div>
      
      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginBottom: '16px' }}>Contact Information</h3>
          <div style={{ display: 'grid', gap: '12px' }}>
            <div>
              <strong>Phone:</strong> {contact.phone}
            </div>
            <div>
              <strong>Email:</strong> {contact.email || '-'}
            </div>
            <div>
              <strong>Type:</strong> {contact.customerType}
            </div>
            {contact.address && (
              <div>
                <strong>Address:</strong> {contact.address}, {contact.city}, {contact.state} {contact.zip}
              </div>
            )}
            {contact.leadSource && (
              <div>
                <strong>Lead Source:</strong> {contact.leadSource}
              </div>
            )}
          </div>
        </div>
        
        <div className="card">
          <h3 style={{ marginBottom: '16px' }}>Tags</h3>
          <div style={{ marginBottom: '16px' }}>
            {contact.tags?.length === 0 ? (
              <p style={{ color: '#718096' }}>No tags</p>
            ) : (
              contact.tags?.map(t => (
                <span
                  key={t.id}
                  className="tag"
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleRemoveTag(t.tag)}
                  title="Click to remove"
                >
                  {t.tag} &times;
                </span>
              ))
            )}
          </div>
          <form onSubmit={handleAddTag} style={{ display: 'flex', gap: '10px' }}>
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Add tag..."
              style={{ flex: 1, padding: '8px', border: '1px solid #cbd5e0', borderRadius: '6px' }}
            />
            <button type="submit" className="btn btn-primary btn-small">Add</button>
          </form>
        </div>
      </div>
      
      <div className="card">
        <h3 style={{ marginBottom: '16px' }}>Conversations</h3>
        {!contact.conversations || contact.conversations.length === 0 ? (
          <p className="empty-state">No conversations</p>
        ) : (
          <ul className="conversation-list">
            {contact.conversations.map(conv => (
              <li key={conv.id} className="conversation-item">
                <Link to={`/conversations/${conv.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className={`status-badge ${conv.status.toLowerCase()}`}>{conv.status}</span>
                    <span style={{ color: '#718096', fontSize: '14px' }}>
                      {new Date(conv.lastMessageAt).toLocaleDateString()}
                    </span>
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
