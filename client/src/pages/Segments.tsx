import { useState, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import { api, Segment, Contact } from '../api/client';

export default function Segments() {
  const { selectedTenant } = useTenant();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [segmentName, setSegmentName] = useState('');

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

  useEffect(() => {
    fetchSegments();
  }, [selectedTenant]);

  const openCreateModal = async () => {
    await fetchContacts();
    setShowCreateModal(true);
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
                  <td>{new Date(segment.id).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
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
              <label>Select Contacts ({selectedContacts.size} selected)</label>
              <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                {contacts.length === 0 ? (
                  <p style={{ padding: '20px', textAlign: 'center', color: '#718096' }}>No contacts available</p>
                ) : (
                  contacts.map(contact => (
                    <label
                      key={contact.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '10px',
                        cursor: 'pointer',
                        borderBottom: '1px solid #e2e8f0',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedContacts.has(contact.id)}
                        onChange={() => toggleContact(contact.id)}
                        style={{ marginRight: '10px' }}
                      />
                      {contact.firstName} {contact.lastName} - {contact.phone}
                    </label>
                  ))
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreateSegment}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
