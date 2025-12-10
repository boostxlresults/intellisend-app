import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { useTenant } from './context/TenantContext';
import Dashboard from './pages/Dashboard';
import Contacts from './pages/Contacts';
import ContactDetail from './pages/ContactDetail';
import Segments from './pages/Segments';
import Campaigns from './pages/Campaigns';
import Conversations from './pages/Conversations';
import ConversationDetail from './pages/ConversationDetail';
import KnowledgeBase from './pages/KnowledgeBase';
import Settings from './pages/Settings';

function App() {
  const { tenants, selectedTenant, setSelectedTenant, loading } = useTenant();
  const location = useLocation();

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
          <NavLink to="/knowledge-base" className={({ isActive }) => isActive ? 'active' : ''}>Knowledge Base</NavLink>
          <NavLink to="/settings" className={({ isActive }) => isActive ? 'active' : ''}>Settings</NavLink>
        </nav>
      </aside>
      
      <main className="main-content">
        <header className="top-bar">
          <div className="tenant-selector">
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
          </div>
          {selectedTenant && (
            <span style={{ color: '#718096', fontSize: '14px' }}>
              {selectedTenant._count?.contacts || 0} contacts | {selectedTenant._count?.conversations || 0} conversations
            </span>
          )}
        </header>
        
        <div className="page-content">
          {!selectedTenant ? (
            <div className="empty-state">
              <p>Please select or create a tenant to get started.</p>
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
              <Route path="/knowledge-base" element={<KnowledgeBase />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
