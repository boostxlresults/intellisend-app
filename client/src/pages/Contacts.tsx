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
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false);
  const [duplicates, setDuplicates] = useState<{ phone: string; count: number; contact_ids: string[]; names: string[] }[]>([]);
  const [loadingDuplicates, setLoadingDuplicates] = useState(false);
  const [merging, setMerging] = useState<string | null>(null);

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

  const fetchDuplicates = async () => {
    if (!selectedTenant) return;
    setLoadingDuplicates(true);
    try {
      const data = await api.getDuplicateContacts(selectedTenant.id);
      setDuplicates(data);
    } catch (error) {
      console.error('Failed to fetch duplicates:', error);
    } finally {
      setLoadingDuplicates(false);
    }
  };

  const handleFindDuplicates = async () => {
    await fetchDuplicates();
    setShowDuplicatesModal(true);
  };

  const handleMerge = async (phone: string, contactIds: string[]) => {
    if (!selectedTenant || contactIds.length < 2) return;
    const keepId = contactIds[0];
    const mergeIds = contactIds.slice(1);
    setMerging(phone);
    try {
      await api.mergeContacts(selectedTenant.id, keepId, mergeIds);
      alert(`Merged ${mergeIds.length} duplicate contacts`);
      fetchDuplicates();
      fetchContacts();
    } catch (error) {
      console.error('Failed to merge:', error);
      alert('Failed to merge contacts');
    } finally {
      setMerging(null);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Contacts</h2>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-secondary" onClick={handleFindDuplicates}>
            Find Duplicates
          </button>
          <button className="btn btn-secondary" onClick={() => setShowImportModal(true)}>
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
            placeholder="Search by name, phone, email, or tag..."
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
                      <span key={t.id} className="tag">{t.name}</span>
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
                    <strong>Optional:</strong> firstName, lastName (or just "Name" - will auto-split), email, address, city, state, zip, tags
                  </p>
                  <p style={{ fontSize: '12px', color: '#718096', marginTop: '8px' }}>
                    The "tags" column can contain comma-separated tags. ZIP codes are automatically added as tags for geo-targeting.
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

      {showDuplicatesModal && (
        <div className="modal-overlay" onClick={() => setShowDuplicatesModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <h3>Duplicate Contacts</h3>
            {loadingDuplicates ? (
              <p>Scanning for duplicates...</p>
            ) : duplicates.length === 0 ? (
              <p style={{ color: '#48bb78', padding: '20px', textAlign: 'center' }}>No duplicate contacts found!</p>
            ) : (
              <div style={{ maxHeight: '400px', overflow: 'auto' }}>
                <p style={{ color: '#718096', marginBottom: '16px' }}>
                  Found {duplicates.length} phone numbers with duplicate contacts
                </p>
                {duplicates.map(dup => (
                  <div key={dup.phone} style={{ padding: '12px', background: '#f7fafc', borderRadius: '6px', marginBottom: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong>{dup.phone}</strong>
                        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#718096' }}>
                          {dup.count} contacts: {dup.names.join(', ')}
                        </p>
                      </div>
                      <button
                        className="btn btn-small btn-primary"
                        onClick={() => handleMerge(dup.phone, dup.contact_ids)}
                        disabled={merging === dup.phone}
                      >
                        {merging === dup.phone ? 'Merging...' : 'Merge'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: '16px', textAlign: 'right' }}>
              <button className="btn btn-secondary" onClick={() => setShowDuplicatesModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
