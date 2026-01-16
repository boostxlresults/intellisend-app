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
  { id: 'HVAC', name: 'HVAC', icon: '🌡️', description: 'Heating, ventilation, and air conditioning' },
  { id: 'PLUMBING', name: 'Plumbing', icon: '🔧', description: 'Plumbing services and repairs' },
  { id: 'ELECTRICAL', name: 'Electrical', icon: '⚡', description: 'Electrical services and upgrades' },
  { id: 'SOLAR', name: 'Solar', icon: '☀️', description: 'Solar installation and maintenance' },
  { id: 'ROOFING', name: 'Roofing', icon: '🏠', description: 'Roofing repairs and installations' },
  { id: 'LANDSCAPING', name: 'Landscaping', icon: '🌿', description: 'Lawn care and landscaping' },
  { id: 'PEST_CONTROL', name: 'Pest Control', icon: '🐛', description: 'Pest prevention and removal' },
  { id: 'PSA', name: 'Public Service Announcements', icon: '📢', description: 'Seasonal tips and safety reminders' },
];

const OPT_OUT_CHARS = 27;

export default function Templates() {
  const { selectedTenant: currentTenant } = useTenant();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
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
    return <div className="p-6">Please select a tenant</div>;
  }

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  const myTemplates = templates.filter(t => !t.isSystemTemplate);
  const systemTemplates = templates.filter(t => t.isSystemTemplate);

  const getTemplatesByCategory = (category: string) => 
    systemTemplates.filter(t => t.category === category);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Message Templates</h1>
          <p className="text-gray-500">Ready-to-use templates for your SMS campaigns</p>
        </div>
        <div className="flex gap-2">
          {systemTemplates.length === 0 && (
            <button
              onClick={handleSeedTemplates}
              disabled={seeding}
              className="border border-blue-600 text-blue-600 px-4 py-2 rounded-lg hover:bg-blue-50 disabled:opacity-50"
            >
              {seeding ? 'Loading...' : 'Load Templates'}
            </button>
          )}
          <button
            onClick={() => { setShowForm(true); setEditingTemplate(null); setFormData({ name: '', category: 'CUSTOM', bodyTemplate: '' }); }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2"
          >
            <span>+</span> Create Template
          </button>
        </div>
      </div>

      {(showForm || editingTemplate) && (
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6 border-2 border-blue-200">
          <h2 className="text-lg font-semibold mb-4">
            {editingTemplate ? 'Edit Template' : 'Create New Template'}
          </h2>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  placeholder="e.g., Spring HVAC Special"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="CUSTOM">Custom</option>
                  {INDUSTRY_CATEGORIES.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Message Template
              </label>
              <textarea
                value={formData.bodyTemplate}
                onChange={(e) => setFormData(prev => ({ ...prev, bodyTemplate: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm"
                rows={4}
                placeholder="Hi {{firstName}}! This is {{agentName}} from {{companyName}}..."
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>
                  Variables: {'{{firstName}}'}, {'{{companyName}}'}, {'{{agentName}}'}, {'{{price}}'}, {'{{discount}}'}
                </span>
                <span className={getCharCount(formData.bodyTemplate).segments > 1 ? 'text-yellow-600' : ''}>
                  {getCharCount(formData.bodyTemplate).chars} chars + {OPT_OUT_CHARS} opt-out = {getCharCount(formData.bodyTemplate).total} total ({getCharCount(formData.bodyTemplate).segments} segment{getCharCount(formData.bodyTemplate).segments > 1 ? 's' : ''})
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={editingTemplate ? handleUpdateTemplate : handleCreateTemplate}
                disabled={!formData.name || !formData.bodyTemplate}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {editingTemplate ? 'Save Changes' : 'Create Template'}
              </button>
              <button
                onClick={() => { setShowForm(false); setEditingTemplate(null); setFormData({ name: '', category: 'CUSTOM', bodyTemplate: '' }); }}
                className="border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {myTemplates.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">My Templates</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {myTemplates.map((template) => (
              <div key={template.id} className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-semibold text-gray-900">{template.name}</h3>
                  <span className="text-xs text-gray-500">{getCharCount(template.bodyTemplate).chars} chars</span>
                </div>
                <p className="text-sm text-gray-600 mb-4 line-clamp-3 font-mono bg-gray-50 p-2 rounded">
                  {template.bodyTemplate}
                </p>
                <div className="flex gap-2 text-sm">
                  <button
                    onClick={() => copyToClipboard(template.bodyTemplate, template.id)}
                    className="text-blue-600 hover:underline"
                  >
                    {copiedId === template.id ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={() => startEdit(template)}
                    className="text-green-600 hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteTemplate(template.id)}
                    className="text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Industry Templates</h2>
        <p className="text-gray-500 text-sm mb-4">Click a category to browse templates. Use "Copy & Edit" to customize for your business.</p>
        
        {systemTemplates.length === 0 ? (
          <div className="bg-gray-50 rounded-lg p-8 text-center">
            <p className="text-gray-600 mb-4">No templates loaded yet.</p>
            <button
              onClick={handleSeedTemplates}
              disabled={seeding}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {seeding ? 'Loading Templates...' : 'Load Industry Templates'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {INDUSTRY_CATEGORIES.map((category) => {
              const categoryTemplates = getTemplatesByCategory(category.id);
              const isExpanded = expandedCategory === category.id;
              
              return (
                <div key={category.id} className="bg-white rounded-lg shadow overflow-hidden">
                  <button
                    onClick={() => setExpandedCategory(isExpanded ? null : category.id)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{category.icon}</span>
                      <div className="text-left">
                        <h3 className="font-semibold text-gray-900">{category.name}</h3>
                        <p className="text-sm text-gray-500">{category.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
                        {categoryTemplates.length} templates
                      </span>
                      <span className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                        ▼
                      </span>
                    </div>
                  </button>
                  
                  {isExpanded && (
                    <div className="border-t border-gray-100 p-4 bg-gray-50">
                      <div className="grid gap-3 md:grid-cols-2">
                        {categoryTemplates.map((template) => (
                          <div key={template.id} className="bg-white rounded-lg p-4 border border-gray-200">
                            <div className="flex justify-between items-start mb-2">
                              <h4 className="font-medium text-gray-900 text-sm">{template.name}</h4>
                              <span className="text-xs text-gray-400">{getCharCount(template.bodyTemplate).chars} chars</span>
                            </div>
                            <p className="text-sm text-gray-600 mb-3 font-mono bg-gray-50 p-2 rounded text-xs">
                              {template.bodyTemplate}
                            </p>
                            <div className="flex gap-3 text-xs">
                              <button
                                onClick={() => copyToClipboard(template.bodyTemplate, template.id)}
                                className="text-blue-600 hover:underline"
                              >
                                {copiedId === template.id ? 'Copied!' : 'Copy'}
                              </button>
                              <button
                                onClick={() => useAsTemplate(template)}
                                className="text-green-600 hover:underline"
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
