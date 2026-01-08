import { useState, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import { api, Segment, Contact } from '../api/client';

export default function Segments() {
  const { selectedTenant } = useTenant();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [segmentName, setSegmentName] = useState('');
  const [selectionMode, setSelectionMode] = useState<'tags' | 'manual'>('tags');

  const fetchSegments = async () => {
    if (!selectedTenant) return;
    setLoading(true);
    try {
      const data = await api.getSegments(selectedTenant.id);
      setSegments(data);
    } catch (error) {
      console.error('Failed to fetch segments:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchContacts = async () => {
    if (!selectedTenant) return;
    try {
      const data = await api.getContacts(selectedTenant.id);
      setContacts(data.contacts);
    } catch (error) {
      console.error('Failed to fetch contacts:', error);
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
    fetchSegments();
  }, [selectedTenant]);

  const openCreateModal = async () => {
    await Promise.all([fetchContacts(), fetchTags()]);
    setShowCreateModal(true);
  };

  const getFilteredContacts = () => {
    if (selectionMode === 'manual' || selectedTags.size === 0) {
      return contacts;
    }
    return contacts.filter(contact => 
      contact.tags?.some(t => selectedTags.has(t.tag))
    );
  };

  const handleTagToggle = (tag: string) => {
    const newTags = new Set(selectedTags);
    if (newTags.has(tag)) {
      newTags.delete(tag);
    } else {
      newTags.add(tag);
    }
    setSelectedTags(newTags);
    
    if (selectionMode === 'tags') {
      const matchingContacts = contacts.filter(c => 
        c.tags?.some(t => newTags.has(t.tag))
      );
      setSelectedContacts(new Set(matchingContacts.map(c => c.id)));
    }
  };

  const selectAllFromTags = () => {
    const filtered = getFilteredContacts();
    setSelectedContacts(new Set(filtered.map(c => c.id)));
  };

  const handleCreateSegment = async () => {
    if (!selectedTenant || !segmentName.trim()) return;
    try {
      await api.createSegment(selectedTenant.id, {
        name: segmentName,
        contactIds: Array.from(selectedContacts),
      });
      setShowCreateModal(false);
      setSegmentName('');
      setSelectedContacts(new Set());
      setSelectedTags(new Set());
      setSelectionMode('tags');
      fetchSegments();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to create segment: ' + message);
    }
  };

  const toggleContact = (contactId: string) => {
    const newSet = new Set(selectedContacts);
    if (newSet.has(contactId)) {
      newSet.delete(contactId);
    } else {
      newSet.add(contactId);
    }
    setSelectedContacts(newSet);
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setSegmentName('');
    setSelectedContacts(new Set());
    setSelectedTags(new Set());
    setSelectionMode('tags');
  };

  const filteredContacts = getFilteredContacts();

  return (
    <div>
      <div className="page-header">
        <h2>Segments</h2>
        <button className="btn btn-primary" onClick={openCreateModal}>
          Create Segment
        </button>
      </div>
      
      <div className="card">
        {loading ? (
          <p>Loading segments...</p>
        ) : segments.length === 0 ? (
          <p className="empty-state">No segments created yet</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Members</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {segments.map(segment => (
                <tr key={segment.id}>
                  <td>{segment.name}</td>
                  <td>{segment.type}</td>
                  <td>{segment._count?.members || 0}</td>
                  <td>{new Date(segment.createdAt || segment.id).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <h3>Create Segment</h3>
            <div className="form-group">
              <label>Segment Name *</label>
              <input
                type="text"
                value={segmentName}
                onChange={(e) => setSegmentName(e.target.value)}
                placeholder="Enter segment name"
              />
            </div>
            
            <div className="form-group">
              <label>Selection Mode</label>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                <button 
                  className={`btn ${selectionMode === 'tags' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setSelectionMode('tags')}
                  style={{ flex: 1 }}
                >
                  Select by Tags
                </button>
                <button 
                  className={`btn ${selectionMode === 'manual' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => { setSelectionMode('manual'); setSelectedTags(new Set()); }}
                  style={{ flex: 1 }}
                >
                  Manual Selection
                </button>
              </div>
            </div>

            {selectionMode === 'tags' && (
              <div className="form-group">
                <label>Filter by Tags</label>
                {allTags.length === 0 ? (
                  <p style={{ color: '#718096', fontSize: '14px' }}>No tags found. Add tags to contacts first.</p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                    {allTags.map(tag => (
                      <button
                        key={tag}
                        onClick={() => handleTagToggle(tag)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '20px',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '13px',
                          backgroundColor: selectedTags.has(tag) ? '#4299e1' : '#e2e8f0',
                          color: selectedTags.has(tag) ? 'white' : '#4a5568',
                        }}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
                {selectedTags.size > 0 && (
                  <button className="btn btn-secondary" onClick={selectAllFromTags} style={{ marginTop: '5px' }}>
                    Select All Matching ({filteredContacts.length})
                  </button>
                )}
              </div>
            )}

            <div className="form-group">
              <label>
                {selectionMode === 'tags' && selectedTags.size > 0 
                  ? `Matching Contacts (${selectedContacts.size} selected)`
                  : `Select Contacts (${selectedContacts.size} selected)`}
              </label>
              <div style={{ maxHeight: '250px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                {filteredContacts.length === 0 ? (
                  <p style={{ padding: '20px', textAlign: 'center', color: '#718096' }}>
                    {selectionMode === 'tags' && selectedTags.size > 0 
                      ? 'No contacts match the selected tags'
                      : 'No contacts available'}
                  </p>
                ) : (
                  filteredContacts.map(contact => (
                    <label
                      key={contact.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '10px',
                        cursor: 'pointer',
                        borderBottom: '1px solid #e2e8f0',
                        backgroundColor: selectedContacts.has(contact.id) ? '#ebf8ff' : 'transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedContacts.has(contact.id)}
                        onChange={() => toggleContact(contact.id)}
                        style={{ marginRight: '10px' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div>{contact.firstName} {contact.lastName}</div>
                        <div style={{ fontSize: '12px', color: '#718096' }}>{contact.phone}</div>
                      </div>
                      {contact.tags && contact.tags.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {contact.tags.map(t => (
                            <span key={t.id} style={{
                              fontSize: '11px',
                              padding: '2px 6px',
                              backgroundColor: '#e2e8f0',
                              borderRadius: '10px',
                              color: '#4a5568',
                            }}>
                              {t.tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </label>
                  ))
                )}
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
              <button 
                className="btn btn-primary" 
                onClick={handleCreateSegment}
                disabled={!segmentName.trim() || selectedContacts.size === 0}
              >
                Create Segment ({selectedContacts.size} contacts)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
