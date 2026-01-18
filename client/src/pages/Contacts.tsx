import { useState, useEffect, useRef } from 'react';
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
  const [importMode, setImportMode] = useState<'json' | 'csv'>('csv');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [globalTags, setGlobalTags] = useState('');
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setImporting(true);
    
    try {
      let result;
      
      if (importMode === 'csv' && csvFile) {
        result = await api.importContactsCSV(selectedTenant.id, csvFile, globalTags);
      } else if (importMode === 'json' && importJson) {
        const contactsData = JSON.parse(importJson);
        result = await api.importContacts(selectedTenant.id, contactsData);
      } else {
        throw new Error('Please provide a CSV file or JSON data');
      }
      
      alert(`Imported ${result.imported} contacts. ${result.failed} failed.`);
      setShowImportModal(false);
      setImportJson('');
      setCsvFile(null);
      setGlobalTags('');
      fetchContacts();
      refreshTenants();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Import failed: ' + message);
    } finally {
      setImporting(false);
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCsvFile(file);
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
                      <span key={t.id} className="tag">{t.tag?.name || 'Unknown'}</span>
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
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <h3>Import Contacts</h3>
            
            <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
              <button 
                className={`btn ${importMode === 'csv' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setImportMode('csv')}
              >
                CSV File
              </button>
              <button 
                className={`btn ${importMode === 'json' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setImportMode('json')}
              >
                JSON
              </button>
            </div>
            
            {importMode === 'csv' ? (
              <>
                <div className="form-group">
                  <label>CSV File *</label>
                  <input
                    type="file"
                    accept=".csv"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    style={{ padding: '10px', border: '1px solid #cbd5e0', borderRadius: '6px', width: '100%' }}
                  />
                  {csvFile && (
                    <p style={{ fontSize: '12px', color: '#38a169', marginTop: '4px' }}>
                      Selected: {csvFile.name}
                    </p>
                  )}
                </div>
                <div className="form-group">
                  <label>Apply Tags to All (comma-separated)</label>
                  <input
                    type="text"
                    value={globalTags}
                    onChange={(e) => setGlobalTags(e.target.value)}
                    placeholder="e.g., solar, tucson, 2024-leads"
                    style={{ padding: '10px', border: '1px solid #cbd5e0', borderRadius: '6px', width: '100%' }}
                  />
                </div>
                <div style={{ backgroundColor: '#f7fafc', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>
                  <p style={{ fontWeight: '600', marginBottom: '8px' }}>Expected CSV Columns:</p>
                  <p style={{ fontSize: '12px', color: '#718096' }}>
                    <strong>Required:</strong> phone<br />
                    <strong>Optional:</strong> firstName, lastName, email, address, city, state, zip, tags
                  </p>
                  <p style={{ fontSize: '12px', color: '#718096', marginTop: '8px' }}>
                    The "tags" column can contain comma-separated tags for each contact.
                  </p>
                </div>
              </>
            ) : (
              <>
                <p style={{ marginBottom: '16px', color: '#718096' }}>
                  Paste JSON array of contacts. Each contact should have firstName, lastName, phone, and optionally email, tags (array).
                </p>
                <textarea
                  value={importJson}
                  onChange={(e) => setImportJson(e.target.value)}
                  placeholder='[{"firstName": "John", "lastName": "Doe", "phone": "+15551234567", "tags": ["lead"]}]'
                  style={{ width: '100%', minHeight: '150px', marginBottom: '16px' }}
                />
              </>
            )}
            
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowImportModal(false)}>Cancel</button>
              <button 
                className="btn btn-primary" 
                onClick={handleImport}
                disabled={importing || (importMode === 'csv' && !csvFile) || (importMode === 'json' && !importJson)}
              >
                {importing ? 'Importing...' : 'Import'}
              </button>
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
