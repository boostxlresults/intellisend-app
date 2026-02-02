import { useState, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import { api, Segment, Contact, Tag } from '../api/client';

export default function Segments() {
  const { selectedTenant } = useTenant();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [segmentName, setSegmentName] = useState('');
  const [selectionMode, setSelectionMode] = useState<'tags' | 'manual'>('tags');
  const [tagSearch, setTagSearch] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const [selectAllMode, setSelectAllMode] = useState(false);

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

  const handleDeleteSegment = async (segmentId: string, segmentName: string) => {
    if (!selectedTenant) return;
    if (!confirm(`Are you sure you want to delete the segment "${segmentName}"? This cannot be undone.`)) {
      return;
    }
    try {
      await api.deleteSegment(selectedTenant.id, segmentId);
      setSegments(segments.filter(s => s.id !== segmentId));
    } catch (error) {
      console.error('Failed to delete segment:', error);
      alert('Failed to delete segment');
    }
  };

  const openCreateModal = async () => {
    await Promise.all([fetchContacts(), fetchTags()]);
    setShowCreateModal(true);
    setSelectAllMode(false);
  };

  const filteredTags = allTags.filter(tag => 
    tag.name.toLowerCase().includes(tagSearch.toLowerCase())
  );

  const [tagMatchingContacts, setTagMatchingContacts] = useState<Array<{ id: string; firstName: string; lastName: string; phone: string; tags?: Array<{ id: string; name: string; color: string }> }>>([]);
  const [loadingTagContacts, setLoadingTagContacts] = useState(false);

  const getFilteredContacts = () => {
    // When in tag mode with selected tags, use server-fetched contacts
    if (selectionMode === 'tags' && selectedTags.size > 0) {
      let result = tagMatchingContacts;
      if (contactSearch) {
        result = result.filter(contact =>
          `${contact.firstName} ${contact.lastName}`.toLowerCase().includes(contactSearch.toLowerCase()) ||
          contact.phone.includes(contactSearch)
        );
      }
      return result;
    }
    
    // Manual mode uses paginated contacts
    let result = contacts;
    if (contactSearch) {
      result = result.filter(contact =>
        `${contact.firstName} ${contact.lastName}`.toLowerCase().includes(contactSearch.toLowerCase()) ||
        contact.phone.includes(contactSearch)
      );
    }
    
    return result;
  };

  const handleTagToggle = async (tagName: string) => {
    const newTags = new Set(selectedTags);
    if (newTags.has(tagName)) {
      newTags.delete(tagName);
    } else {
      newTags.add(tagName);
    }
    setSelectedTags(newTags);
    setSelectAllMode(false);
    
    if (selectionMode === 'tags' && selectedTenant && newTags.size > 0) {
      setLoadingTagContacts(true);
      try {
        const result = await api.getContactsByTags(selectedTenant.id, Array.from(newTags));
        setTagMatchingContacts(result.contacts);
        setSelectedContacts(new Set(result.contacts.map(c => c.id)));
      } catch (error) {
        console.error('Failed to fetch contacts by tags:', error);
      } finally {
        setLoadingTagContacts(false);
      }
    } else {
      setTagMatchingContacts([]);
      setSelectedContacts(new Set());
    }
  };

  const handleSelectAll = () => {
    if (selectAllMode) {
      setSelectedContacts(new Set());
      setSelectAllMode(false);
    } else {
      const filtered = getFilteredContacts();
      setSelectedContacts(new Set(filtered.map(c => c.id)));
      setSelectAllMode(true);
    }
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
      setTagSearch('');
      setContactSearch('');
      setSelectAllMode(false);
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
    setSelectAllMode(false);
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setSegmentName('');
    setSelectedContacts(new Set());
    setSelectedTags(new Set());
    setSelectionMode('tags');
    setTagSearch('');
    setContactSearch('');
    setSelectAllMode(false);
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
                <th style={{ width: '80px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {segments.map(segment => (
                <tr key={segment.id}>
                  <td>{segment.name}</td>
                  <td>{segment.type}</td>
                  <td>{segment._count?.members || 0}</td>
                  <td>{new Date(segment.createdAt || segment.id).toLocaleDateString()}</td>
                  <td>
                    <button
                      onClick={() => handleDeleteSegment(segment.id, segment.name)}
                      style={{
                        padding: '4px 8px',
                        background: '#FEE2E2',
                        color: '#DC2626',
                        border: '1px solid #FECACA',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#FCA5A5'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = '#FEE2E2'; }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '700px' }}>
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
                <input
                  type="text"
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  placeholder="Search tags..."
                  style={{ marginBottom: '10px', padding: '8px', border: '1px solid #cbd5e0', borderRadius: '6px', width: '100%', boxSizing: 'border-box' }}
                />
                {allTags.length === 0 ? (
                  <p style={{ color: '#718096', fontSize: '14px' }}>No tags found. Add tags to contacts first.</p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px', maxHeight: '150px', overflowY: 'auto', padding: '8px', background: '#f7fafc', borderRadius: '6px' }}>
                    {filteredTags.map(tag => (
                      <button
                        key={tag.id}
                        onClick={() => handleTagToggle(tag.name)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '20px',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '13px',
                          backgroundColor: selectedTags.has(tag.name) ? '#4299e1' : '#e2e8f0',
                          color: selectedTags.has(tag.name) ? 'white' : '#4a5568',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {tag.name}
                      </button>
                    ))}
                    {filteredTags.length === 0 && tagSearch && (
                      <p style={{ color: '#718096', fontSize: '14px', margin: 0 }}>No tags match "{tagSearch}"</p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <label style={{ margin: 0 }}>
                  {selectionMode === 'tags' && selectedTags.size > 0 
                    ? `Matching Contacts (${selectedContacts.size} selected of ${filteredContacts.length})`
                    : `Select Contacts (${selectedContacts.size} selected of ${contacts.length})`}
                </label>
                <button 
                  className="btn btn-secondary btn-small"
                  onClick={handleSelectAll}
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                >
                  {selectAllMode ? 'Deselect All' : `Select All (${filteredContacts.length})`}
                </button>
              </div>
              
              <input
                type="text"
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                placeholder="Search contacts by name or phone..."
                style={{ marginBottom: '10px', padding: '8px', border: '1px solid #cbd5e0', borderRadius: '6px', width: '100%', boxSizing: 'border-box' }}
              />
              
              <div style={{ maxHeight: '250px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                {loadingTagContacts ? (
                  <p style={{ padding: '20px', textAlign: 'center', color: '#718096' }}>
                    Loading contacts...
                  </p>
                ) : filteredContacts.length === 0 ? (
                  <p style={{ padding: '20px', textAlign: 'center', color: '#718096' }}>
                    {selectionMode === 'tags' && selectedTags.size > 0 
                      ? 'No contacts match the selected tags'
                      : 'No contacts available'}
                  </p>
                ) : (
                  filteredContacts.slice(0, 100).map(contact => (
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
                          {contact.tags.slice(0, 3).map(t => (
                            <span key={t.id} style={{
                              fontSize: '11px',
                              padding: '2px 6px',
                              backgroundColor: '#e2e8f0',
                              borderRadius: '10px',
                              color: '#4a5568',
                            }}>
                              {t.name}
                            </span>
                          ))}
                          {contact.tags.length > 3 && (
                            <span style={{ fontSize: '11px', color: '#718096' }}>+{contact.tags.length - 3}</span>
                          )}
                        </div>
                      )}
                    </label>
                  ))
                )}
                {filteredContacts.length > 100 && (
                  <div style={{ padding: '12px', textAlign: 'center', background: '#f7fafc', color: '#718096', fontSize: '13px' }}>
                    Showing first 100 of {filteredContacts.length} contacts. Use Select All to include all.
                  </div>
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
                Create Segment ({selectedContacts.size.toLocaleString()} contacts)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
