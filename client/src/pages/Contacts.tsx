import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import { api, Contact } from '../api/client';

export default function Contacts() {
  const { selectedTenant, refreshTenants } = useTenant();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [importJson, setImportJson] = useState('');

  const fetchContacts = async () => {
    if (!selectedTenant) return;
    setLoading(true);
    try {
      const data = await api.getContacts(selectedTenant.id, { search: search || undefined });
      setContacts(data.contacts);
    } catch (error) {
      console.error('Failed to fetch contacts:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts();
  }, [selectedTenant, search]);

  const handleImport = async () => {
    if (!selectedTenant) return;
    try {
      const contactsData = JSON.parse(importJson);
      const result = await api.importContacts(selectedTenant.id, contactsData);
      alert(`Imported ${result.imported} contacts. ${result.failed} failed.`);
      setShowImportModal(false);
      setImportJson('');
      fetchContacts();
      refreshTenants();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Import failed: ' + message);
    }
  };

  const handleAddContact = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedTenant) return;
    const formData = new FormData(e.currentTarget);
    try {
      await api.createContact(selectedTenant.id, {
        firstName: formData.get('firstName') as string,
        lastName: formData.get('lastName') as string,
        phone: formData.get('phone') as string,
        email: formData.get('email') as string || undefined,
      });
      setShowAddModal(false);
      fetchContacts();
      refreshTenants();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to add contact: ' + message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Contacts</h2>
        <div>
          <button className="btn btn-secondary" onClick={() => setShowImportModal(true)} style={{ marginRight: '10px' }}>
            Import
          </button>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            Add Contact
          </button>
        </div>
      </div>
      
      <div className="card">
        <div style={{ marginBottom: '16px' }}>
          <input
            type="text"
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: '10px', border: '1px solid #cbd5e0', borderRadius: '6px', width: '300px' }}
          />
        </div>
        
        {loading ? (
          <p>Loading contacts...</p>
        ) : contacts.length === 0 ? (
          <p className="empty-state">No contacts found</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Type</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map(contact => (
                <tr key={contact.id}>
                  <td>
                    <Link to={`/contacts/${contact.id}`} style={{ color: '#4299e1', textDecoration: 'none' }}>
                      {contact.firstName} {contact.lastName}
                    </Link>
                  </td>
                  <td>{contact.phone}</td>
                  <td>{contact.email || '-'}</td>
                  <td>{contact.customerType}</td>
                  <td>
                    {contact.tags?.map(t => (
                      <span key={t.id} className="tag">{t.tag}</span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      
      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Import Contacts</h3>
            <p style={{ marginBottom: '16px', color: '#718096' }}>
              Paste JSON array of contacts. Each contact should have firstName, lastName, phone, and optionally email, tags (array).
            </p>
            <textarea
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder='[{"firstName": "John", "lastName": "Doe", "phone": "+15551234567", "tags": ["lead"]}]'
              style={{ width: '100%', minHeight: '150px', marginBottom: '16px' }}
            />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowImportModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleImport}>Import</button>
            </div>
          </div>
        </div>
      )}
      
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Add Contact</h3>
            <form onSubmit={handleAddContact}>
              <div className="form-group">
                <label>First Name *</label>
                <input type="text" name="firstName" required />
              </div>
              <div className="form-group">
                <label>Last Name *</label>
                <input type="text" name="lastName" required />
              </div>
              <div className="form-group">
                <label>Phone *</label>
                <input type="tel" name="phone" required placeholder="+15551234567" />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" name="email" />
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Add</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
