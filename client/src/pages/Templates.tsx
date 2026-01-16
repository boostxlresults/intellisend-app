import { useState, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import { api } from '../api/client';

interface Template {
  id: string;
  name: string;
  category: string;
  bodyTemplate: string;
  mediaUrl?: string;
  isSystemTemplate: boolean;
  variables?: string;
  createdAt: string;
}

const INDUSTRY_CATEGORIES = [
  { id: 'HVAC', name: 'HVAC', icon: '🌡️', color: '#3B82F6', description: 'Heating, ventilation, and air conditioning' },
  { id: 'PLUMBING', name: 'Plumbing', icon: '🔧', color: '#0EA5E9', description: 'Plumbing services and repairs' },
  { id: 'ELECTRICAL', name: 'Electrical', icon: '⚡', color: '#F59E0B', description: 'Electrical services and upgrades' },
  { id: 'SOLAR', name: 'Solar', icon: '☀️', color: '#EAB308', description: 'Solar installation and maintenance' },
  { id: 'ROOFING', name: 'Roofing', icon: '🏠', color: '#6366F1', description: 'Roofing repairs and installations' },
  { id: 'LANDSCAPING', name: 'Landscaping', icon: '🌿', color: '#22C55E', description: 'Lawn care and landscaping' },
  { id: 'PEST_CONTROL', name: 'Pest Control', icon: '🐛', color: '#EF4444', description: 'Pest prevention and removal' },
  { id: 'PSA', name: 'Public Service', icon: '📢', color: '#8B5CF6', description: 'Seasonal tips and safety reminders' },
];

const OPT_OUT_CHARS = 27;

const styles = {
  container: {
    padding: '32px 40px',
    maxWidth: '1400px',
    margin: '0 auto',
  } as React.CSSProperties,
  header: {
    marginBottom: '32px',
  } as React.CSSProperties,
  headerTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '8px',
  } as React.CSSProperties,
  title: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#111827',
    letterSpacing: '-0.025em',
    margin: 0,
  } as React.CSSProperties,
  subtitle: {
    fontSize: '15px',
    color: '#6B7280',
    margin: 0,
  } as React.CSSProperties,
  primaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 20px',
    background: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 1px 3px rgba(59, 130, 246, 0.3), 0 4px 12px rgba(59, 130, 246, 0.15)',
    transition: 'all 0.2s ease',
  } as React.CSSProperties,
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 16px',
    background: 'white',
    color: '#374151',
    border: '1px solid #E5E7EB',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  } as React.CSSProperties,
  formCard: {
    background: 'white',
    borderRadius: '16px',
    border: '1px solid #E5E7EB',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 6px 16px rgba(0,0,0,0.04)',
    padding: '28px',
    marginBottom: '32px',
  } as React.CSSProperties,
  formTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#111827',
    marginBottom: '24px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  } as React.CSSProperties,
  formGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '20px',
    marginBottom: '20px',
  } as React.CSSProperties,
  formGroup: {
    marginBottom: '0',
  } as React.CSSProperties,
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: '500',
    color: '#374151',
    marginBottom: '8px',
  } as React.CSSProperties,
  input: {
    width: '100%',
    padding: '12px 14px',
    border: '1px solid #E5E7EB',
    borderRadius: '10px',
    fontSize: '14px',
    color: '#111827',
    background: '#FAFAFA',
    transition: 'all 0.15s ease',
    outline: 'none',
  } as React.CSSProperties,
  textarea: {
    width: '100%',
    padding: '14px',
    border: '1px solid #E5E7EB',
    borderRadius: '10px',
    fontSize: '14px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    color: '#111827',
    background: '#FAFAFA',
    minHeight: '120px',
    resize: 'vertical' as const,
    lineHeight: '1.6',
    transition: 'all 0.15s ease',
    outline: 'none',
  } as React.CSSProperties,
  helperRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '10px',
    fontSize: '12px',
  } as React.CSSProperties,
  variables: {
    color: '#6B7280',
  } as React.CSSProperties,
  charCount: {
    fontWeight: '500',
    padding: '4px 10px',
    borderRadius: '6px',
    background: '#F3F4F6',
  } as React.CSSProperties,
  charCountWarn: {
    background: '#FEF3C7',
    color: '#B45309',
  } as React.CSSProperties,
  formActions: {
    display: 'flex',
    gap: '12px',
    marginTop: '24px',
    paddingTop: '24px',
    borderTop: '1px solid #F3F4F6',
  } as React.CSSProperties,
  section: {
    marginBottom: '40px',
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#111827',
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  } as React.CSSProperties,
  sectionBadge: {
    fontSize: '12px',
    fontWeight: '500',
    padding: '4px 10px',
    borderRadius: '20px',
    background: '#EFF6FF',
    color: '#3B82F6',
  } as React.CSSProperties,
  myTemplatesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: '20px',
  } as React.CSSProperties,
  templateCard: {
    background: 'white',
    borderRadius: '14px',
    border: '1px solid #E5E7EB',
    padding: '20px',
    transition: 'all 0.2s ease',
    cursor: 'default',
  } as React.CSSProperties,
  templateCardHover: {
    borderColor: '#3B82F6',
    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.1)',
    transform: 'translateY(-2px)',
  } as React.CSSProperties,
  templateHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '14px',
  } as React.CSSProperties,
  templateName: {
    fontSize: '15px',
    fontWeight: '600',
    color: '#111827',
    margin: 0,
  } as React.CSSProperties,
  templateChars: {
    fontSize: '11px',
    color: '#9CA3AF',
    fontWeight: '500',
    background: '#F9FAFB',
    padding: '4px 8px',
    borderRadius: '6px',
  } as React.CSSProperties,
  templateBody: {
    fontSize: '13px',
    color: '#4B5563',
    background: '#F9FAFB',
    padding: '14px',
    borderRadius: '10px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    lineHeight: '1.6',
    marginBottom: '16px',
    maxHeight: '100px',
    overflow: 'hidden',
    position: 'relative' as const,
  } as React.CSSProperties,
  templateActions: {
    display: 'flex',
    gap: '12px',
    paddingTop: '14px',
    borderTop: '1px solid #F3F4F6',
  } as React.CSSProperties,
  actionBtn: {
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    padding: '6px 12px',
    borderRadius: '6px',
    border: 'none',
    background: 'transparent',
    transition: 'all 0.15s ease',
  } as React.CSSProperties,
  categoryList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px',
  } as React.CSSProperties,
  categoryCard: {
    background: 'white',
    borderRadius: '14px',
    border: '1px solid #E5E7EB',
    overflow: 'hidden',
    transition: 'all 0.2s ease',
  } as React.CSSProperties,
  categoryHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 22px',
    cursor: 'pointer',
    transition: 'background 0.15s ease',
    border: 'none',
    background: 'transparent',
    width: '100%',
    textAlign: 'left' as const,
  } as React.CSSProperties,
  categoryHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  } as React.CSSProperties,
  categoryIcon: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '22px',
  } as React.CSSProperties,
  categoryInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
  } as React.CSSProperties,
  categoryName: {
    fontSize: '15px',
    fontWeight: '600',
    color: '#111827',
    margin: 0,
  } as React.CSSProperties,
  categoryDesc: {
    fontSize: '13px',
    color: '#6B7280',
    margin: 0,
  } as React.CSSProperties,
  categoryHeaderRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
  } as React.CSSProperties,
  categoryCount: {
    fontSize: '12px',
    fontWeight: '500',
    padding: '5px 12px',
    borderRadius: '20px',
    background: '#F3F4F6',
    color: '#6B7280',
  } as React.CSSProperties,
  chevron: {
    fontSize: '14px',
    color: '#9CA3AF',
    transition: 'transform 0.2s ease',
  } as React.CSSProperties,
  categoryContent: {
    borderTop: '1px solid #F3F4F6',
    background: '#FAFAFA',
    padding: '20px 22px',
    animation: 'slideDown 0.2s ease',
  } as React.CSSProperties,
  systemTemplatesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '16px',
  } as React.CSSProperties,
  systemTemplateCard: {
    background: 'white',
    borderRadius: '12px',
    border: '1px solid #E5E7EB',
    padding: '18px',
    transition: 'all 0.15s ease',
  } as React.CSSProperties,
  emptyState: {
    background: 'linear-gradient(135deg, #F9FAFB 0%, #F3F4F6 100%)',
    borderRadius: '16px',
    padding: '60px 40px',
    textAlign: 'center' as const,
    border: '2px dashed #E5E7EB',
  } as React.CSSProperties,
  emptyIcon: {
    fontSize: '48px',
    marginBottom: '16px',
  } as React.CSSProperties,
  emptyTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '8px',
  } as React.CSSProperties,
  emptyText: {
    fontSize: '14px',
    color: '#6B7280',
    marginBottom: '24px',
    maxWidth: '400px',
    margin: '0 auto 24px',
    lineHeight: '1.6',
  } as React.CSSProperties,
};

export default function Templates() {
  const { selectedTenant: currentTenant } = useTenant();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    category: 'CUSTOM',
    bodyTemplate: '',
  });

  useEffect(() => {
    if (currentTenant) {
      loadTemplates();
    }
  }, [currentTenant]);

  const loadTemplates = async () => {
    if (!currentTenant) return;
    try {
      const data = await api.getTemplates(currentTenant.id);
      setTemplates(data);
    } catch (error) {
      console.error('Error loading templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSeedTemplates = async () => {
    setSeeding(true);
    try {
      await api.seedSystemTemplates();
      await loadTemplates();
    } catch (error) {
      console.error('Error seeding templates:', error);
    } finally {
      setSeeding(false);
    }
  };

  const handleCreateTemplate = async () => {
    if (!currentTenant || !formData.name || !formData.bodyTemplate) return;
    try {
      await api.createTemplate(currentTenant.id, formData);
      setShowForm(false);
      setFormData({ name: '', category: 'CUSTOM', bodyTemplate: '' });
      loadTemplates();
    } catch (error) {
      console.error('Error creating template:', error);
    }
  };

  const handleUpdateTemplate = async () => {
    if (!currentTenant || !editingTemplate) return;
    try {
      await api.updateTemplate(currentTenant.id, editingTemplate.id, formData);
      setEditingTemplate(null);
      setFormData({ name: '', category: 'CUSTOM', bodyTemplate: '' });
      loadTemplates();
    } catch (error) {
      console.error('Error updating template:', error);
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!currentTenant || !confirm('Delete this template?')) return;
    try {
      await api.deleteTemplate(currentTenant.id, templateId);
      loadTemplates();
    } catch (error) {
      console.error('Error deleting template:', error);
    }
  };

  const startEdit = (template: Template) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      category: template.category,
      bodyTemplate: template.bodyTemplate,
    });
    setShowForm(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const useAsTemplate = (template: Template) => {
    setFormData({
      name: `${template.name} (Copy)`,
      category: template.category,
      bodyTemplate: template.bodyTemplate,
    });
    setShowForm(true);
    setEditingTemplate(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getCharCount = (text: string) => {
    const total = text.length + OPT_OUT_CHARS;
    const segments = Math.ceil(total / 160);
    return { chars: text.length, total, segments };
  };

  if (!currentTenant) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>📋</div>
          <div style={styles.emptyTitle}>Select a Tenant</div>
          <div style={styles.emptyText}>Please select a tenant from the dropdown above to manage templates.</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={{ textAlign: 'center', padding: '60px', color: '#6B7280' }}>
          Loading templates...
        </div>
      </div>
    );
  }

  const myTemplates = templates.filter(t => !t.isSystemTemplate);
  const systemTemplates = templates.filter(t => t.isSystemTemplate);
  const getTemplatesByCategory = (category: string) => systemTemplates.filter(t => t.category === category);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerTop}>
          <div>
            <h1 style={styles.title}>Message Templates</h1>
            <p style={styles.subtitle}>Ready-to-use templates for your SMS campaigns</p>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            {systemTemplates.length === 0 && (
              <button
                onClick={handleSeedTemplates}
                disabled={seeding}
                style={{ ...styles.secondaryBtn, opacity: seeding ? 0.6 : 1 }}
              >
                {seeding ? 'Loading...' : '📥 Load Templates'}
              </button>
            )}
            <button
              onClick={() => { setShowForm(true); setEditingTemplate(null); setFormData({ name: '', category: 'CUSTOM', bodyTemplate: '' }); }}
              style={styles.primaryBtn}
              onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.4), 0 8px 20px rgba(59, 130, 246, 0.2)'; }}
              onMouseOut={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(59, 130, 246, 0.3), 0 4px 12px rgba(59, 130, 246, 0.15)'; }}
            >
              <span style={{ fontSize: '16px' }}>+</span> Create Template
            </button>
          </div>
        </div>
      </div>

      {(showForm || editingTemplate) && (
        <div style={styles.formCard}>
          <div style={styles.formTitle}>
            <span style={{ fontSize: '20px' }}>{editingTemplate ? '✏️' : '✨'}</span>
            {editingTemplate ? 'Edit Template' : 'Create New Template'}
          </div>
          
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Template Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                style={styles.input}
                placeholder="e.g., Spring HVAC Special"
                onFocus={(e) => { e.target.style.borderColor = '#3B82F6'; e.target.style.background = 'white'; }}
                onBlur={(e) => { e.target.style.borderColor = '#E5E7EB'; e.target.style.background = '#FAFAFA'; }}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Category</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                style={styles.input}
                onFocus={(e) => { e.target.style.borderColor = '#3B82F6'; e.target.style.background = 'white'; }}
                onBlur={(e) => { e.target.style.borderColor = '#E5E7EB'; e.target.style.background = '#FAFAFA'; }}
              >
                <option value="CUSTOM">Custom</option>
                {INDUSTRY_CATEGORIES.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label style={styles.label}>Message Template</label>
            <textarea
              value={formData.bodyTemplate}
              onChange={(e) => setFormData(prev => ({ ...prev, bodyTemplate: e.target.value }))}
              style={styles.textarea}
              placeholder="Hi {{firstName}}! This is {{agentName}} from {{companyName}}..."
              onFocus={(e) => { e.target.style.borderColor = '#3B82F6'; e.target.style.background = 'white'; }}
              onBlur={(e) => { e.target.style.borderColor = '#E5E7EB'; e.target.style.background = '#FAFAFA'; }}
            />
            <div style={styles.helperRow}>
              <span style={styles.variables}>
                Variables: <code style={{ background: '#F3F4F6', padding: '2px 6px', borderRadius: '4px', fontSize: '11px' }}>{'{{firstName}}'}</code> <code style={{ background: '#F3F4F6', padding: '2px 6px', borderRadius: '4px', fontSize: '11px' }}>{'{{companyName}}'}</code> <code style={{ background: '#F3F4F6', padding: '2px 6px', borderRadius: '4px', fontSize: '11px' }}>{'{{agentName}}'}</code> <code style={{ background: '#F3F4F6', padding: '2px 6px', borderRadius: '4px', fontSize: '11px' }}>{'{{price}}'}</code>
              </span>
              <span style={{
                ...styles.charCount,
                ...(getCharCount(formData.bodyTemplate).segments > 1 ? styles.charCountWarn : {})
              }}>
                {getCharCount(formData.bodyTemplate).chars} + {OPT_OUT_CHARS} = {getCharCount(formData.bodyTemplate).total} chars
                {getCharCount(formData.bodyTemplate).segments > 1 && ` (${getCharCount(formData.bodyTemplate).segments} segments)`}
              </span>
            </div>
          </div>

          <div style={styles.formActions}>
            <button
              onClick={editingTemplate ? handleUpdateTemplate : handleCreateTemplate}
              disabled={!formData.name || !formData.bodyTemplate}
              style={{ ...styles.primaryBtn, opacity: (!formData.name || !formData.bodyTemplate) ? 0.5 : 1 }}
            >
              {editingTemplate ? 'Save Changes' : 'Create Template'}
            </button>
            <button
              onClick={() => { setShowForm(false); setEditingTemplate(null); setFormData({ name: '', category: 'CUSTOM', bodyTemplate: '' }); }}
              style={styles.secondaryBtn}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {myTemplates.length > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>
            <span style={{ fontSize: '18px' }}>📁</span>
            My Templates
            <span style={styles.sectionBadge}>{myTemplates.length}</span>
          </div>
          <div style={styles.myTemplatesGrid}>
            {myTemplates.map((template) => (
              <div
                key={template.id}
                style={{
                  ...styles.templateCard,
                  ...(hoveredCard === template.id ? styles.templateCardHover : {}),
                  borderLeft: `4px solid #3B82F6`,
                }}
                onMouseEnter={() => setHoveredCard(template.id)}
                onMouseLeave={() => setHoveredCard(null)}
              >
                <div style={styles.templateHeader}>
                  <h3 style={styles.templateName}>{template.name}</h3>
                  <span style={styles.templateChars}>{getCharCount(template.bodyTemplate).chars} chars</span>
                </div>
                <div style={styles.templateBody}>
                  {template.bodyTemplate}
                </div>
                <div style={styles.templateActions}>
                  <button
                    onClick={() => copyToClipboard(template.bodyTemplate, template.id)}
                    style={{ ...styles.actionBtn, color: '#3B82F6' }}
                    onMouseOver={(e) => { e.currentTarget.style.background = '#EFF6FF'; }}
                    onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {copiedId === template.id ? '✓ Copied' : '📋 Copy'}
                  </button>
                  <button
                    onClick={() => startEdit(template)}
                    style={{ ...styles.actionBtn, color: '#059669' }}
                    onMouseOver={(e) => { e.currentTarget.style.background = '#ECFDF5'; }}
                    onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    ✏️ Edit
                  </button>
                  <button
                    onClick={() => handleDeleteTemplate(template.id)}
                    style={{ ...styles.actionBtn, color: '#DC2626' }}
                    onMouseOver={(e) => { e.currentTarget.style.background = '#FEF2F2'; }}
                    onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    🗑️ Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={styles.section}>
        <div style={styles.sectionTitle}>
          <span style={{ fontSize: '18px' }}>🏭</span>
          Industry Templates
          <span style={styles.sectionBadge}>{systemTemplates.length} templates</span>
        </div>
        <p style={{ fontSize: '14px', color: '#6B7280', marginBottom: '20px' }}>
          Click a category to browse templates. Use "Copy & Edit" to customize for your business.
        </p>
        
        {systemTemplates.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>📚</div>
            <div style={styles.emptyTitle}>No Templates Loaded</div>
            <div style={styles.emptyText}>
              Load our library of 40+ industry-specific templates designed for home services businesses.
            </div>
            <button
              onClick={handleSeedTemplates}
              disabled={seeding}
              style={{ ...styles.primaryBtn, opacity: seeding ? 0.6 : 1 }}
            >
              {seeding ? 'Loading Templates...' : '📥 Load Industry Templates'}
            </button>
          </div>
        ) : (
          <div style={styles.categoryList}>
            {INDUSTRY_CATEGORIES.map((category) => {
              const categoryTemplates = getTemplatesByCategory(category.id);
              const isExpanded = expandedCategory === category.id;
              
              if (categoryTemplates.length === 0) return null;
              
              return (
                <div
                  key={category.id}
                  style={{
                    ...styles.categoryCard,
                    ...(isExpanded ? { borderColor: category.color, boxShadow: `0 4px 12px ${category.color}15` } : {}),
                  }}
                >
                  <button
                    onClick={() => setExpandedCategory(isExpanded ? null : category.id)}
                    style={{
                      ...styles.categoryHeader,
                      background: isExpanded ? '#FAFAFA' : 'transparent',
                    }}
                    onMouseOver={(e) => { if (!isExpanded) e.currentTarget.style.background = '#FAFAFA'; }}
                    onMouseOut={(e) => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={styles.categoryHeaderLeft}>
                      <div style={{ ...styles.categoryIcon, background: `${category.color}15` }}>
                        {category.icon}
                      </div>
                      <div style={styles.categoryInfo}>
                        <h3 style={styles.categoryName}>{category.name}</h3>
                        <p style={styles.categoryDesc}>{category.description}</p>
                      </div>
                    </div>
                    <div style={styles.categoryHeaderRight}>
                      <span style={{ ...styles.categoryCount, background: isExpanded ? `${category.color}20` : '#F3F4F6', color: isExpanded ? category.color : '#6B7280' }}>
                        {categoryTemplates.length} templates
                      </span>
                      <span style={{ ...styles.chevron, transform: isExpanded ? 'rotate(180deg)' : 'none' }}>
                        ▼
                      </span>
                    </div>
                  </button>
                  
                  {isExpanded && (
                    <div style={styles.categoryContent}>
                      <div style={styles.systemTemplatesGrid}>
                        {categoryTemplates.map((template) => (
                          <div
                            key={template.id}
                            style={{
                              ...styles.systemTemplateCard,
                              ...(hoveredCard === template.id ? { borderColor: category.color, boxShadow: `0 4px 12px ${category.color}10` } : {}),
                            }}
                            onMouseEnter={() => setHoveredCard(template.id)}
                            onMouseLeave={() => setHoveredCard(null)}
                          >
                            <div style={styles.templateHeader}>
                              <h4 style={{ ...styles.templateName, fontSize: '14px' }}>
                                {template.name.replace(`${category.name} - `, '').replace(`${category.id} - `, '')}
                              </h4>
                              <span style={styles.templateChars}>{getCharCount(template.bodyTemplate).chars}</span>
                            </div>
                            <div style={{ ...styles.templateBody, fontSize: '12px', maxHeight: '80px' }}>
                              {template.bodyTemplate}
                            </div>
                            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                              <button
                                onClick={() => copyToClipboard(template.bodyTemplate, template.id)}
                                style={{ ...styles.actionBtn, color: '#3B82F6', fontSize: '12px', padding: '4px 10px' }}
                                onMouseOver={(e) => { e.currentTarget.style.background = '#EFF6FF'; }}
                                onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
                              >
                                {copiedId === template.id ? '✓ Copied' : 'Copy'}
                              </button>
                              <button
                                onClick={() => useAsTemplate(template)}
                                style={{ ...styles.actionBtn, color: '#059669', fontSize: '12px', padding: '4px 10px' }}
                                onMouseOver={(e) => { e.currentTarget.style.background = '#ECFDF5'; }}
                                onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
                              >
                                Copy & Edit
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
