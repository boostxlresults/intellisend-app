import { useState, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import { api } from '../api/client';

interface SequenceStep {
  id?: string;
  order: number;
  delayMinutes: number;
  delayUnit: string;
  bodyTemplate: string;
  mediaUrl?: string;
}

interface Sequence {
  id: string;
  name: string;
  description?: string;
  status: string;
  triggerType: string;
  steps: SequenceStep[];
  _count?: { enrollments: number };
  createdAt: string;
}

export default function Sequences() {
  const { currentTenant } = useTenant();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newSequence, setNewSequence] = useState({
    name: '',
    description: '',
    steps: [{ order: 1, delayMinutes: 0, delayUnit: 'minutes', bodyTemplate: '' }] as SequenceStep[],
  });

  useEffect(() => {
    if (currentTenant) {
      loadSequences();
    }
  }, [currentTenant]);

  const loadSequences = async () => {
    if (!currentTenant) return;
    try {
      const data = await api.getSequences(currentTenant.id);
      setSequences(data);
    } catch (error) {
      console.error('Error loading sequences:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSequence = async () => {
    if (!currentTenant || !newSequence.name) return;
    try {
      await api.createSequence(currentTenant.id, newSequence);
      setShowForm(false);
      setNewSequence({
        name: '',
        description: '',
        steps: [{ order: 1, delayMinutes: 0, delayUnit: 'minutes', bodyTemplate: '' }],
      });
      loadSequences();
    } catch (error) {
      console.error('Error creating sequence:', error);
    }
  };

  const addStep = () => {
    setNewSequence(prev => ({
      ...prev,
      steps: [...prev.steps, { order: prev.steps.length + 1, delayMinutes: 1440, delayUnit: 'minutes', bodyTemplate: '' }],
    }));
  };

  const updateStep = (index: number, updates: Partial<SequenceStep>) => {
    setNewSequence(prev => ({
      ...prev,
      steps: prev.steps.map((step, i) => i === index ? { ...step, ...updates } : step),
    }));
  };

  const removeStep = (index: number) => {
    if (newSequence.steps.length <= 1) return;
    setNewSequence(prev => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i + 1 })),
    }));
  };

  const formatDelay = (minutes: number, unit: string) => {
    if (unit === 'days') return `${minutes} day${minutes !== 1 ? 's' : ''}`;
    if (unit === 'hours') return `${minutes} hour${minutes !== 1 ? 's' : ''}`;
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  };

  if (!currentTenant) {
    return <div className="p-6">Please select a tenant</div>;
  }

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Drip Sequences</h1>
          <p className="text-gray-500">Create automated multi-step message sequences</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          Create Sequence
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">New Sequence</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={newSequence.name}
                onChange={(e) => setNewSequence(prev => ({ ...prev, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                placeholder="e.g., New Customer Welcome"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <input
                type="text"
                value={newSequence.description}
                onChange={(e) => setNewSequence(prev => ({ ...prev, description: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                placeholder="Optional description"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-gray-700">Steps</label>
                <button
                  onClick={addStep}
                  className="text-blue-600 text-sm hover:underline"
                >
                  + Add Step
                </button>
              </div>

              <div className="space-y-4">
                {newSequence.steps.map((step, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-medium">Step {index + 1}</span>
                      {index > 0 && (
                        <button
                          onClick={() => removeStep(index)}
                          className="text-red-500 text-sm hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    {index > 0 && (
                      <div className="flex gap-2 mb-3">
                        <div className="flex-1">
                          <label className="block text-xs text-gray-500 mb-1">Wait</label>
                          <input
                            type="number"
                            value={step.delayMinutes}
                            onChange={(e) => updateStep(index, { delayMinutes: parseInt(e.target.value) || 0 })}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                            min="0"
                          />
                        </div>
                        <div className="w-24">
                          <label className="block text-xs text-gray-500 mb-1">Unit</label>
                          <select
                            value={step.delayUnit}
                            onChange={(e) => updateStep(index, { delayUnit: e.target.value })}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                          >
                            <option value="minutes">Minutes</option>
                            <option value="hours">Hours</option>
                            <option value="days">Days</option>
                          </select>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Message</label>
                      <textarea
                        value={step.bodyTemplate}
                        onChange={(e) => updateStep(index, { bodyTemplate: e.target.value })}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                        rows={3}
                        placeholder="Hi {{firstName}}, ..."
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-4">
              <button
                onClick={handleCreateSequence}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                Create Sequence
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

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {sequences.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No sequences yet. Create your first automated sequence.
          </div>
        ) : (
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Steps</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Enrolled</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sequences.map((sequence) => (
                <tr key={sequence.id}>
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900">{sequence.name}</div>
                    {sequence.description && (
                      <div className="text-sm text-gray-500">{sequence.description}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-gray-500">{sequence.steps.length} steps</td>
                  <td className="px-6 py-4 text-gray-500">{sequence._count?.enrollments || 0}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      sequence.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                      sequence.status === 'PAUSED' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {sequence.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <button className="text-blue-600 hover:underline text-sm">View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
