import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import { api, Contact } from '../api/client';

interface Tag {
  id: string;
  name: string;
  color?: string;
}

export default function ContactDetail() {
  const { contactId } = useParams<{ contactId: string }>();
  const { selectedTenant } = useTenant();
  const navigate = useNavigate();
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [newTag, setNewTag] = useState('');
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [togglingAI, setTogglingAI] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

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

  const fetchTags = async () => {
    if (!selectedTenant) return;
    try {
      const data = await api.getTags(selectedTenant.id);
      setAllTags(data);
    } catch (error) {
      console.error('Failed to fetch tags:', error);
    }
  };

  useEffect(() => {
    fetchContact();
    fetchTags();
  }, [selectedTenant, contactId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current && 
        !suggestionsRef.current.contains(event.target as Node) &&
        tagInputRef.current &&
        !tagInputRef.current.contains(event.target as Node)
      ) {
        setShowTagSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const existingTagNames = contact?.tags?.map(t => t.name?.toLowerCase()).filter(Boolean) || [];
  const filteredSuggestions = allTags
    .filter(tag => 
      tag.name.toLowerCase().includes(newTag.toLowerCase()) &&
      !existingTagNames.includes(tag.name.toLowerCase())
    )
    .slice(0, 8);

  const handleTagInputChange = (value: string) => {
    setNewTag(value);
    setShowTagSuggestions(value.length > 0 && filteredSuggestions.length > 0);
  };

  const handleSelectSuggestion = (tagName: string) => {
    setNewTag(tagName);
    setShowTagSuggestions(false);
    tagInputRef.current?.focus();
  };

  const availableTags = allTags.filter(tag => 
    !existingTagNames.includes(tag.name.toLowerCase())
  );

  const handleQuickAddTag = async (tagName: string) => {
    if (!selectedTenant || !contactId) return;
    try {
      await api.addContactTag(selectedTenant.id, contactId, tagName);
      fetchContact();
      fetchTags();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to add tag: ' + message);
    }
  };

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant || !contactId || !newTag.trim()) return;
    try {
      await api.addContactTag(selectedTenant.id, contactId, newTag.trim());
      setNewTag('');
      fetchContact();
      fetchTags();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to add tag: ' + message);
    }
  };

  const handleRemoveTag = async (tagId: string) => {
    if (!selectedTenant || !contactId) return;
    try {
      await api.removeContactTag(selectedTenant.id, contactId, tagId);
      fetchContact();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to remove tag: ' + message);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant || !contactId || !messageText.trim()) return;
    setSending(true);
    try {
      const result = await api.startConversation(selectedTenant.id, contactId, messageText.trim());
      setShowMessageModal(false);
      setMessageText('');
      navigate(`/conversations/${result.conversationId}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to send message: ' + message);
    } finally {
      setSending(false);
    }
  };

  const handleToggleAIAgent = async () => {
    if (!selectedTenant || !contactId || !contact) return;
    setTogglingAI(true);
    try {
      const updated = await api.updateContact(selectedTenant.id, contactId, {
        aiAgentEnabled: !contact.aiAgentEnabled,
      });
      setContact({ ...contact, aiAgentEnabled: updated.aiAgentEnabled });
    } catch (error) {
      console.error('Failed to toggle AI agent:', error);
    } finally {
      setTogglingAI(false);
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
        <button className="btn btn-primary" onClick={() => setShowMessageModal(true)}>
          Send Message
        </button>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong>AI Agent:</strong>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={contact.aiAgentEnabled !== false}
                  onChange={handleToggleAIAgent}
                  disabled={togglingAI}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '14px', color: contact.aiAgentEnabled !== false ? '#48bb78' : '#a0aec0' }}>
                  {contact.aiAgentEnabled !== false ? 'Enabled' : 'Disabled'}
                </span>
              </label>
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
                  onClick={() => handleRemoveTag(t.id)}
                  title="Click to remove"
                >
                  {t.name} &times;
                </span>
              ))
            )}
          </div>
          <form onSubmit={handleAddTag} style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                ref={tagInputRef}
                type="text"
                value={newTag}
                onChange={(e) => handleTagInputChange(e.target.value)}
                onFocus={() => newTag.length > 0 && filteredSuggestions.length > 0 && setShowTagSuggestions(true)}
                placeholder="Type new tag or click existing below..."
                style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e0', borderRadius: '6px', boxSizing: 'border-box' }}
              />
              {showTagSuggestions && filteredSuggestions.length > 0 && (
                <div
                  ref={suggestionsRef}
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    background: 'white',
                    border: '1px solid #E5E7EB',
                    borderRadius: '8px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    zIndex: 100,
                    marginTop: '4px',
                    maxHeight: '200px',
                    overflowY: 'auto',
                  }}
                >
                  {filteredSuggestions.map(tag => (
                    <div
                      key={tag.id}
                      onClick={() => handleSelectSuggestion(tag.name)}
                      style={{
                        padding: '10px 12px',
                        cursor: 'pointer',
                        borderBottom: '1px solid #F3F4F6',
                        fontSize: '14px',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#F3F4F6'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                    >
                      {tag.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button type="submit" className="btn btn-primary btn-small">Add</button>
          </form>
          
          {availableTags.length > 0 && (
            <div>
              <p style={{ fontSize: '12px', color: '#6B7280', marginBottom: '8px' }}>Click to add existing tag:</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {availableTags.map(tag => (
                  <span
                    key={tag.id}
                    onClick={() => handleQuickAddTag(tag.name)}
                    style={{
                      display: 'inline-block',
                      padding: '6px 12px',
                      background: '#EFF6FF',
                      color: '#3B82F6',
                      borderRadius: '16px',
                      fontSize: '13px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      border: '1px solid #BFDBFE',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#DBEAFE'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#EFF6FF'; }}
                  >
                    + {tag.name}
                  </span>
                ))}
              </div>
            </div>
          )}
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

      {showMessageModal && (
        <div className="modal-overlay" onClick={() => setShowMessageModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Send Message to {contact.firstName}</h3>
            <form onSubmit={handleSendMessage}>
              <div className="form-group">
                <label>Message</label>
                <textarea
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Type your message..."
                  rows={4}
                  style={{ width: '100%', padding: '10px', border: '1px solid #cbd5e0', borderRadius: '6px', resize: 'vertical' }}
                  required
                />
                <p style={{ fontSize: '12px', color: '#718096', marginTop: '6px' }}>
                  This will start a new conversation with {contact.phone}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowMessageModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={sending || !messageText.trim()}>
                  {sending ? 'Sending...' : 'Send'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
