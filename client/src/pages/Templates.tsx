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

const CATEGORIES = [
  { id: 'APPOINTMENT_REMINDER', name: 'Appointment Reminders' },
  { id: 'REVIEW_REQUEST', name: 'Review Requests' },
  { id: 'SEASONAL_PROMO', name: 'Seasonal Promotions' },
  { id: 'RE_ENGAGEMENT', name: 'Re-Engagement' },
  { id: 'WELCOME', name: 'Welcome Messages' },
  { id: 'CONFIRMATION', name: 'Confirmations' },
  { id: 'FOLLOW_UP', name: 'Follow-Up' },
  { id: 'CUSTOM', name: 'Custom' },
];

export default function Templates() {
  const { currentTenant } = useTenant();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    category: 'CUSTOM',
    bodyTemplate: '',
  });
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    if (currentTenant) {
      loadTemplates();
    }
  }, [currentTenant, selectedCategory]);

  const loadTemplates = async () => {
    if (!currentTenant) return;
    try {
      const data = await api.getTemplates(currentTenant.id, selectedCategory || undefined);
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
      loadTemplates();
    } catch (error) {
      console.error('Error seeding templates:', error);
    } finally {
      setSeeding(false);
    }
  };

  const handleCreateTemplate = async () => {
    if (!currentTenant || !newTemplate.name || !newTemplate.bodyTemplate) return;
    try {
      await api.createTemplate(currentTenant.id, newTemplate);
      setShowForm(false);
      setNewTemplate({ name: '', category: 'CUSTOM', bodyTemplate: '' });
      loadTemplates();
    } catch (error) {
      console.error('Error creating template:', error);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (!currentTenant) {
    return <div className="p-6">Please select a tenant</div>;
  }

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  const systemTemplates = templates.filter(t => t.isSystemTemplate);
  const customTemplates = templates.filter(t => !t.isSystemTemplate);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Message Templates</h1>
          <p className="text-gray-500">Pre-built and custom message templates for common scenarios</p>
        </div>
        <div className="flex gap-2">
          {systemTemplates.length === 0 && (
            <button
              onClick={handleSeedTemplates}
              disabled={seeding}
              className="border border-blue-600 text-blue-600 px-4 py-2 rounded-lg hover:bg-blue-50 disabled:opacity-50"
            >
              {seeding ? 'Loading...' : 'Load System Templates'}
            </button>
          )}
          <button
            onClick={() => setShowForm(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Create Template
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setSelectedCategory(null)}
          className={`px-3 py-1 rounded-full text-sm ${
            selectedCategory === null ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          All
        </button>
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-3 py-1 rounded-full text-sm ${
              selectedCategory === cat.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">New Template</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={newTemplate.name}
                onChange={(e) => setNewTemplate(prev => ({ ...prev, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={newTemplate.category}
                onChange={(e) => setNewTemplate(prev => ({ ...prev, category: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                {CATEGORIES.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Message Template</label>
              <textarea
                value={newTemplate.bodyTemplate}
                onChange={(e) => setNewTemplate(prev => ({ ...prev, bodyTemplate: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                rows={4}
                placeholder="Use {{firstName}}, {{companyName}}, etc. for variables"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleCreateTemplate}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                Create Template
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <div key={template.id} className="bg-white rounded-lg shadow p-4">
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-semibold text-gray-900">{template.name}</h3>
              {template.isSystemTemplate && (
                <span className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded">System</span>
              )}
            </div>
            <div className="text-xs text-gray-500 mb-2">
              {CATEGORIES.find(c => c.id === template.category)?.name || template.category}
            </div>
            <p className="text-sm text-gray-600 mb-4 line-clamp-3">{template.bodyTemplate}</p>
            <button
              onClick={() => copyToClipboard(template.bodyTemplate)}
              className="text-blue-600 text-sm hover:underline"
            >
              Copy Template
            </button>
          </div>
        ))}
      </div>

      {templates.length === 0 && (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No templates found. Load system templates or create your own.
        </div>
      )}
    </div>
  );
}
