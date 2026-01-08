import { useState } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { useTenant } from './context/TenantContext';
import { api } from './api/client';
import Dashboard from './pages/Dashboard';
import Contacts from './pages/Contacts';
import ContactDetail from './pages/ContactDetail';
import Segments from './pages/Segments';
import Campaigns from './pages/Campaigns';
import Conversations from './pages/Conversations';
import ConversationDetail from './pages/ConversationDetail';
import KnowledgeBase from './pages/KnowledgeBase';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';

function App() {
  const { tenants, selectedTenant, setSelectedTenant, refreshTenants, loading } = useTenant();
  const location = useLocation();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTenantName, setNewTenantName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreateTenant = async () => {
    if (!newTenantName.trim()) return;
    setCreating(true);
    try {
      const tenant = await api.createTenant({ 
        name: newTenantName.toLowerCase().replace(/\s+/g, '-'),
        publicName: newTenantName 
      });
      await refreshTenants();
      setSelectedTenant(tenant);
      setShowCreateModal(false);
      setNewTenantName('');
    } catch (error) {
      console.error('Failed to create tenant:', error);
      alert('Failed to create tenant');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <aside className="sidebar">
        <h1>IntelliSend</h1>
        <nav>
          <NavLink to="/" className={({ isActive }) => isActive ? 'active' : ''}>Dashboard</NavLink>
          <NavLink to="/contacts" className={location.pathname.startsWith('/contacts') ? 'active' : ''}>Contacts</NavLink>
          <NavLink to="/segments" className={({ isActive }) => isActive ? 'active' : ''}>Segments</NavLink>
          <NavLink to="/campaigns" className={({ isActive }) => isActive ? 'active' : ''}>Campaigns</NavLink>
          <NavLink to="/conversations" className={location.pathname.startsWith('/conversations') ? 'active' : ''}>Conversations</NavLink>
          <NavLink to="/analytics" className={({ isActive }) => isActive ? 'active' : ''}>Analytics</NavLink>
          <NavLink to="/knowledge-base" className={({ isActive }) => isActive ? 'active' : ''}>Knowledge Base</NavLink>
          <NavLink to="/settings" className={({ isActive }) => isActive ? 'active' : ''}>Settings</NavLink>
        </nav>
      </aside>
      
      <main className="main-content">
        <header className="top-bar">
          <div className="tenant-selector" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <select
              value={selectedTenant?.id || ''}
              onChange={(e) => {
                const tenant = tenants.find(t => t.id === e.target.value);
                setSelectedTenant(tenant || null);
              }}
            >
              <option value="">Select Tenant</option>
              {tenants.map(tenant => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.publicName}
                </option>
              ))}
            </select>
            <button 
              className="btn btn-small btn-secondary" 
              onClick={() => setShowCreateModal(true)}
              style={{ padding: '6px 12px', fontSize: '13px' }}
            >
              + New Tenant
            </button>
          </div>
          {selectedTenant && (
            <span style={{ color: '#718096', fontSize: '14px' }}>
              {selectedTenant._count?.contacts || 0} contacts | {selectedTenant._count?.conversations || 0} conversations
            </span>
          )}
        </header>
        
        <div className="page-content">
          {!selectedTenant ? (
            <div className="empty-state" style={{ textAlign: 'center', padding: '60px 20px' }}>
              <h2 style={{ marginBottom: '16px' }}>Welcome to IntelliSend</h2>
              <p style={{ marginBottom: '24px', color: '#718096' }}>
                {tenants.length === 0 
                  ? 'Create your first tenant to get started with SMS campaigns.'
                  : 'Please select a tenant from the dropdown above.'}
              </p>
              {tenants.length === 0 && (
                <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                  Create Your First Tenant
                </button>
              )}
            </div>
          ) : (
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/contacts" element={<Contacts />} />
              <Route path="/contacts/:contactId" element={<ContactDetail />} />
              <Route path="/segments" element={<Segments />} />
              <Route path="/campaigns" element={<Campaigns />} />
              <Route path="/conversations" element={<Conversations />} />
              <Route path="/conversations/:conversationId" element={<ConversationDetail />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/knowledge-base" element={<KnowledgeBase />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          )}
        </div>
      </main>
      
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Create New Tenant</h3>
            <div className="form-group">
              <label>Business Name *</label>
              <input
                type="text"
                value={newTenantName}
                onChange={(e) => setNewTenantName(e.target.value)}
                placeholder="e.g., ABC Plumbing"
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                Cancel
              </button>
              <button 
                className="btn btn-primary" 
                onClick={handleCreateTenant}
                disabled={creating || !newTenantName.trim()}
              >
                {creating ? 'Creating...' : 'Create Tenant'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
