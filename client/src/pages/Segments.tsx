import { useState, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import { api, Segment, Contact, Tag } from '../api/client';

type MatchMode = 'ANY' | 'ALL';

interface PreviewContact {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  tags?: Array<{ id: string; name: string; color: string }>;
}

const chipStyle = (active: boolean, tone: 'include' | 'exclude') => ({
  padding: '6px 12px',
  borderRadius: '20px',
  border: 'none',
  cursor: 'pointer',
  fontSize: '13px',
  backgroundColor: active ? (tone === 'include' ? '#4299e1' : '#E53E3E') : '#e2e8f0',
  color: active ? 'white' : '#4a5568',
  transition: 'all 0.15s ease',
});

const autoBadge = {
  fontSize: '10px',
  marginLeft: '6px',
  padding: '1px 5px',
  borderRadius: '8px',
  background: 'rgba(0,0,0,0.12)',
  verticalAlign: 'middle' as const,
};

export default function Segments() {
  const { selectedTenant } = useTenant();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [segmentName, setSegmentName] = useState('');
  const [selectionMode, setSelectionMode] = useState<'tags' | 'manual'>('tags');
  const [tagSearch, setTagSearch] = useState('');
  const [contactSearch, setContactSearch] = useState('');

  // Tag mode
  const [includeTagIds, setIncludeTagIds] = useState<Set<string>>(new Set());
  const [excludeTagIds, setExcludeTagIds] = useState<Set<string>>(new Set());
  const [matchMode, setMatchMode] = useState<MatchMode>('ANY');
  const [keepUpdated, setKeepUpdated] = useState(true);
  const [preview, setPreview] = useState<PreviewContact[]>([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Manual mode
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [selectAllMode, setSelectAllMode] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

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
      // ServiceTitan system tags first, then everything else alphabetically.
      data.sort((a, b) => Number(!!b.isSystem) - Number(!!a.isSystem) || a.name.localeCompare(b.name));
      setAllTags(data);
    } catch (error) {
      console.error('Failed to fetch tags:', error);
    }
  };

  useEffect(() => {
    fetchSegments();
  }, [selectedTenant]);

  // Re-run the preview whenever the tag rule changes.
  useEffect(() => {
    if (!selectedTenant || selectionMode !== 'tags' || includeTagIds.size === 0) {
      setPreview([]);
      setPreviewTotal(0);
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    api.previewSegment(
      selectedTenant.id,
      { mode: matchMode, tagIds: Array.from(includeTagIds) },
      Array.from(excludeTagIds)
    )
      .then((result) => {
        if (cancelled) return;
        setPreview(result.preview);
        setPreviewTotal(result.totalCount);
      })
      .catch((error) => console.error('Failed to preview segment:', error))
      .finally(() => { if (!cancelled) setLoadingPreview(false); });
    return () => { cancelled = true; };
  }, [selectedTenant, selectionMode, includeTagIds, excludeTagIds, matchMode]);

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

  const handleRefreshSegment = async (segmentId: string) => {
    if (!selectedTenant) return;
    setRefreshingId(segmentId);
    try {
      await api.refreshSegment(selectedTenant.id, segmentId);
      await fetchSegments();
    } catch (error) {
      console.error('Failed to refresh segment:', error);
      alert('Failed to refresh segment');
    } finally {
      setRefreshingId(null);
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

  const toggleIn = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  };

  const handleIncludeToggle = (tagId: string) => {
    setIncludeTagIds(toggleIn(includeTagIds, tagId));
    if (excludeTagIds.has(tagId)) setExcludeTagIds(toggleIn(excludeTagIds, tagId));
  };

  const handleExcludeToggle = (tagId: string) => {
    setExcludeTagIds(toggleIn(excludeTagIds, tagId));
    if (includeTagIds.has(tagId)) setIncludeTagIds(toggleIn(includeTagIds, tagId));
  };

  const getManualContacts = () => {
    if (!contactSearch) return contacts;
    return contacts.filter(contact =>
      `${contact.firstName} ${contact.lastName}`.toLowerCase().includes(contactSearch.toLowerCase()) ||
      contact.phone.includes(contactSearch)
    );
  };

  const handleSelectAll = () => {
    if (selectAllMode) {
      setSelectedContacts(new Set());
      setSelectAllMode(false);
    } else {
      setSelectedContacts(new Set(getManualContacts().map(c => c.id)));
      setSelectAllMode(true);
    }
  };

  const toggleContact = (contactId: string) => {
    setSelectedContacts(toggleIn(selectedContacts, contactId));
    setSelectAllMode(false);
  };

  const handleCreateSegment = async () => {
    if (!selectedTenant || !segmentName.trim()) return;
    try {
      if (selectionMode === 'tags') {
        await api.createSegment(selectedTenant.id, {
          name: segmentName,
          type: keepUpdated ? 'DYNAMIC' : 'STATIC',
          tagFilter: { mode: matchMode, tagIds: Array.from(includeTagIds) },
          excludedTagIds: Array.from(excludeTagIds),
        });
      } else {
        await api.createSegment(selectedTenant.id, {
          name: segmentName,
          contactIds: Array.from(selectedContacts),
        });
      }
      closeModal();
      fetchSegments();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to create segment: ' + message);
    }
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setSegmentName('');
    setSelectedContacts(new Set());
    setIncludeTagIds(new Set());
    setExcludeTagIds(new Set());
    setMatchMode('ANY');
    setKeepUpdated(true);
    setSelectionMode('tags');
    setTagSearch('');
    setContactSearch('');
    setSelectAllMode(false);
  };

  const describeRule = (segment: Segment) => {
    if (!segment.definitionJson) return null;
    try {
      const rule = JSON.parse(segment.definitionJson) as { mode: string; tagIds: string[] };
      const nameOf = (id: string) => allTags.find(t => t.id === id)?.name ?? 'tag';
      if (allTags.length === 0) return `${rule.mode === 'ALL' ? 'All' : 'Any'} of ${rule.tagIds.length} tag(s)`;
      const joiner = rule.mode === 'ALL' ? ' + ' : ' or ';
      let text = rule.tagIds.map(nameOf).join(joiner);
      if (segment.excludedTagIds && segment.excludedTagIds.length > 0) {
        text += `, excluding ${segment.excludedTagIds.map(nameOf).join(', ')}`;
      }
      return text;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (segments.some(s => s.definitionJson) && allTags.length === 0) fetchTags();
  }, [segments]);

  const manualContacts = getManualContacts();
  const canCreate = segmentName.trim() && (
    selectionMode === 'tags' ? includeTagIds.size > 0 && previewTotal > 0 : selectedContacts.size > 0
  );
  const createLabel = selectionMode === 'tags'
    ? `Create ${keepUpdated ? 'Dynamic' : 'Static'} Segment (${previewTotal.toLocaleString()} contacts now)`
    : `Create Segment (${selectedContacts.size.toLocaleString()} contacts)`;

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
                <th style={{ width: '160px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {segments.map(segment => (
                <tr key={segment.id}>
                  <td>
                    <div>{segment.name}</div>
                    {segment.type === 'DYNAMIC' && describeRule(segment) && (
                      <div style={{ fontSize: '12px', color: '#718096' }}>{describeRule(segment)}</div>
                    )}
                  </td>
                  <td>
                    {segment.type === 'DYNAMIC' ? 'Dynamic (auto-updates)' : 'Static'}
                  </td>
                  <td>{(segment._count?.members || 0).toLocaleString()}</td>
                  <td>{new Date(segment.createdAt || segment.id).toLocaleDateString()}</td>
                  <td style={{ display: 'flex', gap: '6px' }}>
                    {segment.type === 'DYNAMIC' && (
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => handleRefreshSegment(segment.id)}
                        disabled={refreshingId === segment.id}
                        style={{ padding: '4px 8px', fontSize: '12px' }}
                      >
                        {refreshingId === segment.id ? 'Refreshing...' : 'Refresh'}
                      </button>
                    )}
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
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '720px' }}>
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
                  onClick={() => setSelectionMode('manual')}
                  style={{ flex: 1 }}
                >
                  Manual Selection
                </button>
              </div>
            </div>

            {selectionMode === 'tags' && (
              <>
                <div className="form-group">
                  <input
                    type="text"
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    placeholder="Search tags..."
                    style={{ marginBottom: '10px', padding: '8px', border: '1px solid #cbd5e0', borderRadius: '6px', width: '100%', boxSizing: 'border-box' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ margin: 0 }}>Include contacts with</label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {(['ANY', 'ALL'] as MatchMode[]).map(mode => (
                        <button
                          key={mode}
                          className={`btn btn-small ${matchMode === mode ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => setMatchMode(mode)}
                          style={{ padding: '4px 10px', fontSize: '12px' }}
                        >
                          {mode === 'ANY' ? 'Any of these tags' : 'All of these tags'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {allTags.length === 0 ? (
                    <p style={{ color: '#718096', fontSize: '14px' }}>No tags found. Add tags to contacts first.</p>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px', maxHeight: '150px', overflowY: 'auto', padding: '8px', background: '#f7fafc', borderRadius: '6px' }}>
                      {filteredTags.map(tag => (
                        <button
                          key={tag.id}
                          onClick={() => handleIncludeToggle(tag.id)}
                          style={chipStyle(includeTagIds.has(tag.id), 'include')}
                          title={tag.isSystem ? 'Managed automatically by the ServiceTitan sync' : undefined}
                        >
                          {tag.name}
                          {tag.isSystem && <span style={autoBadge}>auto</span>}
                        </button>
                      ))}
                      {filteredTags.length === 0 && tagSearch && (
                        <p style={{ color: '#718096', fontSize: '14px', margin: 0 }}>No tags match "{tagSearch}"</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label>Exclude contacts with any of</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '110px', overflowY: 'auto', padding: '8px', background: '#f7fafc', borderRadius: '6px' }}>
                    {filteredTags.map(tag => (
                      <button
                        key={tag.id}
                        onClick={() => handleExcludeToggle(tag.id)}
                        style={chipStyle(excludeTagIds.has(tag.id), 'exclude')}
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '14px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={keepUpdated}
                    onChange={(e) => setKeepUpdated(e.target.checked)}
                    style={{ marginTop: '3px' }}
                  />
                  <span>
                    <strong>Keep updated automatically</strong>
                    <span style={{ display: 'block', fontSize: '12px', color: '#718096' }}>
                      Members are recalculated after every ServiceTitan sync and right before each campaign sends.
                      Turn off to save a fixed list of who matches today.
                    </span>
                  </span>
                </label>

                <div className="form-group">
                  <label>
                    {includeTagIds.size === 0
                      ? 'Pick at least one tag to see who matches'
                      : `Matching contacts right now: ${previewTotal.toLocaleString()}`}
                  </label>
                  <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                    {loadingPreview ? (
                      <p style={{ padding: '20px', textAlign: 'center', color: '#718096' }}>Loading contacts...</p>
                    ) : includeTagIds.size > 0 && preview.length === 0 ? (
                      <p style={{ padding: '20px', textAlign: 'center', color: '#718096' }}>No contacts match these tags</p>
                    ) : (
                      preview.map(contact => (
                        <div key={contact.id} style={{ display: 'flex', alignItems: 'center', padding: '10px', borderBottom: '1px solid #e2e8f0' }}>
                          <div style={{ flex: 1 }}>
                            <div>{contact.firstName} {contact.lastName}</div>
                            <div style={{ fontSize: '12px', color: '#718096' }}>{contact.phone}</div>
                          </div>
                        </div>
                      ))
                    )}
                    {previewTotal > preview.length && preview.length > 0 && (
                      <div style={{ padding: '12px', textAlign: 'center', background: '#f7fafc', color: '#718096', fontSize: '13px' }}>
                        Showing first {preview.length} of {previewTotal.toLocaleString()} contacts. All of them will be included.
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {selectionMode === 'manual' && (
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <label style={{ margin: 0 }}>
                    {`Select Contacts (${selectedContacts.size} selected of ${contacts.length})`}
                  </label>
                  <button
                    className="btn btn-secondary btn-small"
                    onClick={handleSelectAll}
                    style={{ padding: '6px 12px', fontSize: '12px' }}
                  >
                    {selectAllMode ? 'Deselect All' : `Select All (${manualContacts.length})`}
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
                  {manualContacts.length === 0 ? (
                    <p style={{ padding: '20px', textAlign: 'center', color: '#718096' }}>No contacts available</p>
                  ) : (
                    manualContacts.slice(0, 100).map(contact => (
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
                      </label>
                    ))
                  )}
                  {manualContacts.length > 100 && (
                    <div style={{ padding: '12px', textAlign: 'center', background: '#f7fafc', color: '#718096', fontSize: '13px' }}>
                      Showing first 100 of {manualContacts.length} contacts. Use Select All to include all.
                    </div>
                  )}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleCreateSegment}
                disabled={!canCreate}
              >
                {createLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
