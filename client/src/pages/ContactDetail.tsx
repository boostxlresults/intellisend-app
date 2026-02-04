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
  const [messageImageUrl, setMessageImageUrl] = useState('');
  const [sending, setSending] = useState(false);
  const [togglingAI, setTogglingAI] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ firstName: '', lastName: '', phone: '', email: '' });
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState<{ id: string; content: string; createdBy?: string; createdAt: string }[]>([]);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
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

  const fetchNotes = async () => {
    if (!selectedTenant || !contactId) return;
    try {
      const data = await api.getContactNotes(selectedTenant.id, contactId);
      setNotes(data);
    } catch (error) {
      console.error('Failed to fetch notes:', error);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant || !contactId || !newNote.trim()) return;
    setAddingNote(true);
    try {
      await api.addContactNote(selectedTenant.id, contactId, newNote.trim());
      setNewNote('');
      fetchNotes();
    } catch (error) {
      console.error('Failed to add note:', error);
    } finally {
      setAddingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!selectedTenant || !contactId) return;
    if (!window.confirm('Delete this note?')) return;
    try {
      await api.deleteContactNote(selectedTenant.id, contactId, noteId);
      fetchNotes();
    } catch (error) {
      console.error('Failed to delete note:', error);
    }
  };

  useEffect(() => {
    fetchContact();
    fetchTags();
    fetchNotes();
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
      const result = await api.startConversation(selectedTenant.id, contactId, messageText.trim(), messageImageUrl || undefined);
      setShowMessageModal(false);
      setMessageText('');
      setMessageImageUrl('');
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

  const handleDeleteContact = async () => {
    if (!selectedTenant || !contact) return;
    if (!window.confirm(`Are you sure you want to delete ${contact.firstName} ${contact.lastName}? This will also remove all their conversation history and cannot be undone.`)) return;
    
    try {
      await api.deleteContact(selectedTenant.id, contact.id);
      navigate('/contacts');
    } catch (error) {
      console.error('Failed to delete contact:', error);
      alert('Failed to delete contact');
    }
  };

  const openEditModal = () => {
    if (!contact) return;
    setEditForm({
      firstName: contact.firstName || '',
      lastName: contact.lastName || '',
      phone: contact.phone || '',
      email: contact.email || '',
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant || !contactId) return;
    setSaving(true);
    try {
      const updated = await api.updateContact(selectedTenant.id, contactId, {
        firstName: editForm.firstName,
        lastName: editForm.lastName,
        phone: editForm.phone,
        email: editForm.email || undefined,
      });
      setContact({ ...contact!, ...updated });
      setShowEditModal(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to update contact: ' + message);
    } finally {
      setSaving(false);
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
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-secondary" onClick={openEditModal}>
            Edit Contact
          </button>
          <button className="btn btn-primary" onClick={() => setShowMessageModal(true)}>
            Send Message
          </button>
          <button 
            className="btn" 
            onClick={handleDeleteContact}
            style={{ backgroundColor: '#e53e3e', color: 'white' }}
          >
            Delete Contact
          </button>
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
        <h3 style={{ marginBottom: '16px' }}>Notes</h3>
        <form onSubmit={handleAddNote} style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              type="text"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Add a note about this contact..."
              style={{ flex: 1, padding: '10px', border: '1px solid #cbd5e0', borderRadius: '6px' }}
            />
            <button type="submit" className="btn btn-primary btn-small" disabled={addingNote || !newNote.trim()}>
              {addingNote ? 'Adding...' : 'Add'}
            </button>
          </div>
        </form>
        {notes.length === 0 ? (
          <p style={{ color: '#718096', fontSize: '14px' }}>No notes yet</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {notes.map(note => (
              <div key={note.id} style={{ padding: '12px', background: '#f7fafc', borderRadius: '6px', borderLeft: '3px solid #4299e1' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{note.content}</p>
                  <button
                    onClick={() => handleDeleteNote(note.id)}
                    style={{ background: 'none', border: 'none', color: '#a0aec0', cursor: 'pointer', padding: '4px', fontSize: '16px' }}
                    title="Delete note"
                  >
                    &times;
                  </button>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#718096' }}>
                  {new Date(note.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
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
              </div>
              <div className="form-group">
                <label>Image (Optional - for MMS)</label>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 5 * 1024 * 1024) {
                        alert('Image must be under 5MB');
                        return;
                      }
                      try {
                        const res = await fetch('/api/uploads/request-url', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
                        });
                        const { uploadURL, objectPath } = await res.json();
                        await fetch(uploadURL, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
                        setMessageImageUrl(`${window.location.origin}${objectPath}`);
                      } catch (err) {
                        alert('Upload failed');
                      }
                    }}
                  />
                  {messageImageUrl && <button type="button" className="btn btn-small btn-secondary" onClick={() => setMessageImageUrl('')}>Clear</button>}
                </div>
                <p style={{ fontSize: '12px', color: '#718096' }}>Or paste URL:</p>
                <input
                  type="url"
                  value={messageImageUrl}
                  onChange={(e) => setMessageImageUrl(e.target.value)}
                  placeholder="https://example.com/image.jpg"
                  style={{ width: '100%', padding: '10px', border: '1px solid #cbd5e0', borderRadius: '6px', marginTop: '4px' }}
                />
                {messageImageUrl && (
                  <div style={{ marginTop: '8px' }}>
                    <img src={messageImageUrl} alt="Preview" style={{ maxWidth: '150px', maxHeight: '100px', borderRadius: '4px' }} />
                  </div>
                )}
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

      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Edit Contact</h3>
            <form onSubmit={handleSaveEdit}>
              <div className="form-group">
                <label>First Name</label>
                <input
                  type="text"
                  value={editForm.firstName}
                  onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                  style={{ width: '100%', padding: '10px', border: '1px solid #cbd5e0', borderRadius: '6px', boxSizing: 'border-box' }}
                  required
                />
              </div>
              <div className="form-group">
                <label>Last Name</label>
                <input
                  type="text"
                  value={editForm.lastName}
                  onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                  style={{ width: '100%', padding: '10px', border: '1px solid #cbd5e0', borderRadius: '6px', boxSizing: 'border-box' }}
                />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input
                  type="text"
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  style={{ width: '100%', padding: '10px', border: '1px solid #cbd5e0', borderRadius: '6px', boxSizing: 'border-box' }}
                  required
                />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  style={{ width: '100%', padding: '10px', border: '1px solid #cbd5e0', borderRadius: '6px', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowEditModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving || !editForm.firstName.trim() || !editForm.phone.trim()}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
