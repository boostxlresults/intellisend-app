import { useState, useCallback, useRef, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import { api } from '../api/client';

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeType = 'TRIGGER' | 'SEND_SMS' | 'WAIT' | 'BRANCH' | 'TAG' | 'END';

interface JourneyNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  label: string;
  config: Record<string, string | number | boolean>;
  // For BRANCH nodes: two children (yes/no). For others: one child.
  childIds: string[];
}

interface JourneyEdge {
  id: string;
  fromId: string;
  toId: string;
  label?: string; // 'Yes' | 'No' for branch edges
}

interface Journey {
  id?: string;
  name: string;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_WIDTH = 200;
const NODE_HEIGHT = 72;
const CANVAS_W = 1400;
const CANVAS_H = 900;

const NODE_COLORS: Record<NodeType, string> = {
  TRIGGER: '#6366f1',
  SEND_SMS: '#0ea5e9',
  WAIT: '#f59e0b',
  BRANCH: '#8b5cf6',
  TAG: '#10b981',
  END: '#ef4444',
};

const NODE_ICONS: Record<NodeType, string> = {
  TRIGGER: '⚡',
  SEND_SMS: '💬',
  WAIT: '⏳',
  BRANCH: '🔀',
  TAG: '🏷️',
  END: '🏁',
};

const NODE_LABELS: Record<NodeType, string> = {
  TRIGGER: 'Trigger',
  SEND_SMS: 'Send SMS',
  WAIT: 'Wait',
  BRANCH: 'Branch / If',
  TAG: 'Add Tag',
  END: 'End Journey',
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Default Journey ──────────────────────────────────────────────────────────

function makeDefaultJourney(): Journey {
  const triggerId = uid();
  const smsId = uid();
  const waitId = uid();
  const branchId = uid();
  const yesId = uid();
  const noId = uid();
  const endId = uid();

  return {
    name: 'New Journey',
    status: 'DRAFT',
    nodes: [
      { id: triggerId, type: 'TRIGGER', x: 600, y: 40, label: 'Contact Added to Segment', config: { triggerType: 'SEGMENT_ADDED' }, childIds: [smsId] },
      { id: smsId, type: 'SEND_SMS', x: 600, y: 160, label: 'Welcome Message', config: { bodyTemplate: 'Hi {{firstName}}, welcome! Reply Y to learn more.', delayMinutes: 0 }, childIds: [waitId] },
      { id: waitId, type: 'WAIT', x: 600, y: 280, label: 'Wait 24 Hours', config: { delayMinutes: 1440, delayUnit: 'hours' }, childIds: [branchId] },
      { id: branchId, type: 'BRANCH', x: 600, y: 400, label: 'Replied Y?', config: { condition: 'REPLIED_YES' }, childIds: [yesId, noId] },
      { id: yesId, type: 'SEND_SMS', x: 380, y: 540, label: 'Book Appointment', config: { bodyTemplate: 'Great! Our team will reach out shortly to schedule your appointment.', delayMinutes: 0 }, childIds: [endId] },
      { id: noId, type: 'SEND_SMS', x: 820, y: 540, label: 'Follow-Up Nudge', config: { bodyTemplate: 'Hi {{firstName}}, just checking in — can we help you today? Reply Y to connect with our team.', delayMinutes: 0 }, childIds: [] },
      { id: endId, type: 'END', x: 380, y: 660, label: 'End', config: {}, childIds: [] },
    ],
    edges: [
      { id: uid(), fromId: triggerId, toId: smsId },
      { id: uid(), fromId: smsId, toId: waitId },
      { id: uid(), fromId: waitId, toId: branchId },
      { id: uid(), fromId: branchId, toId: yesId, label: 'Yes' },
      { id: uid(), fromId: branchId, toId: noId, label: 'No' },
      { id: uid(), fromId: yesId, toId: endId },
    ],
  };
}

// ─── SVG Edges ────────────────────────────────────────────────────────────────

function EdgeLine({ from, to, label }: { from: JourneyNode; to: JourneyNode; label?: string }) {
  const x1 = from.x + NODE_WIDTH / 2;
  const y1 = from.y + NODE_HEIGHT;
  const x2 = to.x + NODE_WIDTH / 2;
  const y2 = to.y;
  const midY = (y1 + y2) / 2;
  const path = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  const labelX = (x1 + x2) / 2;
  const labelY = midY;

  return (
    <g>
      <path d={path} fill="none" stroke="#cbd5e0" strokeWidth={2} markerEnd="url(#arrow)" />
      {label && (
        <>
          <rect x={labelX - 18} y={labelY - 10} width={36} height={18} rx={4} fill="white" stroke="#e2e8f0" />
          <text x={labelX} y={labelY + 4} textAnchor="middle" fontSize={11} fill={label === 'Yes' ? '#10b981' : '#ef4444'} fontWeight={600}>{label}</text>
        </>
      )}
    </g>
  );
}

// ─── Node Card ────────────────────────────────────────────────────────────────

function NodeCard({
  node,
  selected,
  onSelect,
  onDragStart,
}: {
  node: JourneyNode;
  selected: boolean;
  onSelect: (id: string) => void;
  onDragStart: (id: string, e: React.MouseEvent) => void;
}) {
  const color = NODE_COLORS[node.type];
  const icon = NODE_ICONS[node.type];

  return (
    <g
      transform={`translate(${node.x}, ${node.y})`}
      style={{ cursor: 'grab' }}
      onMouseDown={(e) => { e.stopPropagation(); onDragStart(node.id, e); }}
      onClick={(e) => { e.stopPropagation(); onSelect(node.id); }}
    >
      {/* Shadow */}
      <rect x={3} y={3} width={NODE_WIDTH} height={NODE_HEIGHT} rx={10} fill="rgba(0,0,0,0.08)" />
      {/* Card */}
      <rect
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={10}
        fill="white"
        stroke={selected ? color : '#e2e8f0'}
        strokeWidth={selected ? 2.5 : 1.5}
      />
      {/* Left accent bar */}
      <rect width={6} height={NODE_HEIGHT} rx={10} fill={color} />
      <rect width={6} height={NODE_HEIGHT - 20} y={10} fill={color} />
      {/* Icon circle */}
      <circle cx={30} cy={NODE_HEIGHT / 2} r={14} fill={color + '22'} />
      <text x={30} y={NODE_HEIGHT / 2 + 5} textAnchor="middle" fontSize={14}>{icon}</text>
      {/* Type label */}
      <text x={52} y={28} fontSize={10} fill={color} fontWeight={700} letterSpacing={0.5}>{NODE_LABELS[node.type].toUpperCase()}</text>
      {/* Node label */}
      <text x={52} y={50} fontSize={12} fill="#2d3748" fontWeight={500}>
        {node.label.length > 22 ? node.label.slice(0, 22) + '…' : node.label}
      </text>
      {/* Config preview */}
      {node.type === 'WAIT' && node.config.delayMinutes && (
        <text x={52} y={64} fontSize={10} fill="#718096">
          {Number(node.config.delayMinutes) >= 1440
            ? `${Math.round(Number(node.config.delayMinutes) / 1440)}d`
            : Number(node.config.delayMinutes) >= 60
            ? `${Math.round(Number(node.config.delayMinutes) / 60)}h`
            : `${node.config.delayMinutes}m`}
        </text>
      )}
    </g>
  );
}

// ─── Sidebar Panel ────────────────────────────────────────────────────────────

function SidebarPanel({
  node,
  onUpdate,
  onDelete,
  onClose,
  onAddChild,
}: {
  node: JourneyNode;
  onUpdate: (id: string, updates: Partial<JourneyNode>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onAddChild: (parentId: string, type: NodeType, label?: string) => void;
}) {
  const color = NODE_COLORS[node.type];

  return (
    <div style={{
      position: 'absolute', right: 0, top: 0, bottom: 0, width: 320,
      background: 'white', borderLeft: '1px solid #e2e8f0',
      boxShadow: '-4px 0 16px rgba(0,0,0,0.08)',
      display: 'flex', flexDirection: 'column', zIndex: 10,
    }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
          {NODE_ICONS[node.type]}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color, fontWeight: 700, letterSpacing: 0.5 }}>{NODE_LABELS[node.type].toUpperCase()}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#2d3748' }}>Configure Node</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#718096' }}>×</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {/* Label */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#4a5568', display: 'block', marginBottom: 4 }}>Node Label</label>
          <input
            type="text"
            value={node.label}
            onChange={e => onUpdate(node.id, { label: e.target.value })}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #cbd5e0', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
          />
        </div>

        {/* TRIGGER config */}
        {node.type === 'TRIGGER' && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#4a5568', display: 'block', marginBottom: 4 }}>Trigger Event</label>
            <select
              value={node.config.triggerType as string || 'SEGMENT_ADDED'}
              onChange={e => onUpdate(node.id, { config: { ...node.config, triggerType: e.target.value } })}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #cbd5e0', borderRadius: 6, fontSize: 13 }}
            >
              <option value="SEGMENT_ADDED">Contact Added to Segment</option>
              <option value="OPT_IN">Contact Opts In (Reply Y)</option>
              <option value="CAMPAIGN_REPLY">Contact Replies to Campaign</option>
              <option value="TAG_ADDED">Tag Added to Contact</option>
              <option value="MANUAL">Manual Enrollment</option>
            </select>
          </div>
        )}

        {/* SEND_SMS config */}
        {node.type === 'SEND_SMS' && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#4a5568', display: 'block', marginBottom: 4 }}>Message Body</label>
              <textarea
                value={node.config.bodyTemplate as string || ''}
                onChange={e => onUpdate(node.id, { config: { ...node.config, bodyTemplate: e.target.value } })}
                rows={4}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #cbd5e0', borderRadius: 6, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
                placeholder="Hi {{firstName}}, ..."
              />
              <div style={{ fontSize: 11, color: '#718096', marginTop: 4 }}>
                Variables: {'{{firstName}}'}, {'{{lastName}}'}, {'{{companyName}}'}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#4a5568', display: 'block', marginBottom: 4 }}>Send Delay</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="number"
                  min={0}
                  value={node.config.delayValue as number || 0}
                  onChange={e => onUpdate(node.id, { config: { ...node.config, delayValue: parseInt(e.target.value) || 0 } })}
                  style={{ width: 80, padding: '8px 10px', border: '1px solid #cbd5e0', borderRadius: 6, fontSize: 13 }}
                />
                <select
                  value={node.config.delayUnit as string || 'minutes'}
                  onChange={e => onUpdate(node.id, { config: { ...node.config, delayUnit: e.target.value } })}
                  style={{ flex: 1, padding: '8px 10px', border: '1px solid #cbd5e0', borderRadius: 6, fontSize: 13 }}
                >
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
              </div>
            </div>
          </>
        )}

        {/* WAIT config */}
        {node.type === 'WAIT' && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#4a5568', display: 'block', marginBottom: 4 }}>Wait Duration</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                min={1}
                value={node.config.delayValue as number || 1}
                onChange={e => onUpdate(node.id, { config: { ...node.config, delayValue: parseInt(e.target.value) || 1 } })}
                style={{ width: 80, padding: '8px 10px', border: '1px solid #cbd5e0', borderRadius: 6, fontSize: 13 }}
              />
              <select
                value={node.config.delayUnit as string || 'hours'}
                onChange={e => onUpdate(node.id, { config: { ...node.config, delayUnit: e.target.value } })}
                style={{ flex: 1, padding: '8px 10px', border: '1px solid #cbd5e0', borderRadius: 6, fontSize: 13 }}
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </div>
          </div>
        )}

        {/* BRANCH config */}
        {node.type === 'BRANCH' && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#4a5568', display: 'block', marginBottom: 4 }}>Branch Condition</label>
            <select
              value={node.config.condition as string || 'REPLIED_YES'}
              onChange={e => onUpdate(node.id, { config: { ...node.config, condition: e.target.value } })}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #cbd5e0', borderRadius: 6, fontSize: 13 }}
            >
              <option value="REPLIED_YES">Contact Replied "Y" / Yes</option>
              <option value="REPLIED_ANY">Contact Replied (any message)</option>
              <option value="NO_REPLY">No Reply Received</option>
              <option value="OPTED_IN">Contact is Opted In</option>
              <option value="HAS_TAG">Contact Has Tag</option>
              <option value="POSITIVE_SENTIMENT">Positive Sentiment Detected</option>
              <option value="BOOKING_INTENT">Booking Intent Detected</option>
            </select>
            {node.config.condition === 'HAS_TAG' && (
              <input
                type="text"
                value={node.config.tagName as string || ''}
                onChange={e => onUpdate(node.id, { config: { ...node.config, tagName: e.target.value } })}
                placeholder="Tag name..."
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #cbd5e0', borderRadius: 6, fontSize: 13, marginTop: 8, boxSizing: 'border-box' }}
              />
            )}
            <div style={{ marginTop: 12, padding: '10px 12px', background: '#f7fafc', borderRadius: 8, fontSize: 12, color: '#718096' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                <span style={{ color: '#10b981', fontWeight: 700 }}>✓ YES path</span>
                <span>→ First connected node</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ color: '#ef4444', fontWeight: 700 }}>✗ NO path</span>
                <span>→ Second connected node</span>
              </div>
            </div>
          </div>
        )}

        {/* TAG config */}
        {node.type === 'TAG' && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#4a5568', display: 'block', marginBottom: 4 }}>Tag to Apply</label>
            <input
              type="text"
              value={node.config.tagName as string || ''}
              onChange={e => onUpdate(node.id, { config: { ...node.config, tagName: e.target.value } })}
              placeholder="e.g., Hot Lead, Interested, Booked"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #cbd5e0', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
            />
          </div>
        )}

        {/* Add next step */}
        {node.type !== 'END' && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#4a5568', marginBottom: 8 }}>Add Next Step</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {(['SEND_SMS', 'WAIT', 'BRANCH', 'TAG', 'END'] as NodeType[]).map(type => (
                <button
                  key={type}
                  onClick={() => onAddChild(node.id, type)}
                  style={{
                    padding: '8px 10px', border: `1px solid ${NODE_COLORS[type]}33`,
                    borderRadius: 8, background: NODE_COLORS[type] + '11',
                    cursor: 'pointer', fontSize: 12, color: NODE_COLORS[type],
                    fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
                  }}
                >
                  {NODE_ICONS[type]} {NODE_LABELS[type]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {node.type !== 'TRIGGER' && (
        <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0' }}>
          <button
            onClick={() => onDelete(node.id)}
            style={{ width: '100%', padding: '8px', background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 6, color: '#e53e3e', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            🗑 Delete Node
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function Toolbar({
  journey,
  onNameChange,
  onSave,
  onStatusToggle,
  saving,
}: {
  journey: Journey;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onStatusToggle: () => void;
  saving: boolean;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(journey.name);

  return (
    <div style={{
      height: 56, background: 'white', borderBottom: '1px solid #e2e8f0',
      display: 'flex', alignItems: 'center', padding: '0 20px', gap: 16,
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      {/* Journey name */}
      {editingName ? (
        <input
          autoFocus
          value={nameVal}
          onChange={e => setNameVal(e.target.value)}
          onBlur={() => { setEditingName(false); onNameChange(nameVal); }}
          onKeyDown={e => { if (e.key === 'Enter') { setEditingName(false); onNameChange(nameVal); } }}
          style={{ fontSize: 16, fontWeight: 700, border: '1px solid #6366f1', borderRadius: 6, padding: '4px 10px', outline: 'none' }}
        />
      ) : (
        <div
          onClick={() => setEditingName(true)}
          style={{ fontSize: 16, fontWeight: 700, color: '#2d3748', cursor: 'text', padding: '4px 10px', borderRadius: 6, border: '1px solid transparent' }}
          title="Click to rename"
        >
          {journey.name} ✏️
        </div>
      )}

      {/* Status badge */}
      <div style={{
        padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700,
        background: journey.status === 'ACTIVE' ? '#c6f6d5' : journey.status === 'PAUSED' ? '#fefcbf' : '#e2e8f0',
        color: journey.status === 'ACTIVE' ? '#276749' : journey.status === 'PAUSED' ? '#744210' : '#4a5568',
      }}>
        {journey.status}
      </div>

      <div style={{ flex: 1 }} />

      {/* Node type legend */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {(Object.keys(NODE_COLORS) as NodeType[]).map(type => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#718096' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: NODE_COLORS[type] }} />
            {NODE_LABELS[type]}
          </div>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      {/* Actions */}
      <button
        onClick={onStatusToggle}
        style={{
          padding: '7px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          background: journey.status === 'ACTIVE' ? '#fefcbf' : '#c6f6d5',
          border: `1px solid ${journey.status === 'ACTIVE' ? '#f6e05e' : '#9ae6b4'}`,
          color: journey.status === 'ACTIVE' ? '#744210' : '#276749',
        }}
      >
        {journey.status === 'ACTIVE' ? '⏸ Pause' : '▶ Activate'}
      </button>
      <button
        onClick={onSave}
        disabled={saving}
        style={{
          padding: '7px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          background: '#6366f1', color: 'white', border: 'none',
          opacity: saving ? 0.7 : 1,
        }}
      >
        {saving ? 'Saving…' : '💾 Save Journey'}
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function JourneyBuilder() {
  const { selectedTenant } = useTenant();
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [activeJourney, setActiveJourney] = useState<Journey | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showList, setShowList] = useState(true);
  const [loadingJourneys, setLoadingJourneys] = useState(false);

  // Drag state
  const draggingRef = useRef<{ nodeId: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Load journeys from sequences API
  const loadJourneys = useCallback(async () => {
    if (!selectedTenant) return;
    setLoadingJourneys(true);
    try {
      const seqs = await api.getSequences(selectedTenant.id);
      // Convert sequences that have journey metadata stored in description
      const converted: Journey[] = seqs
        .filter((s: { description?: string }) => s.description?.startsWith('__JOURNEY__'))
        .map((s: { id: string; name: string; status: string; description?: string }) => {
          try {
            const data = JSON.parse(s.description!.replace('__JOURNEY__', ''));
            return { ...data, id: s.id, name: s.name, status: s.status };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      setJourneys(converted);
    } catch (e) {
      console.error('Failed to load journeys:', e);
    } finally {
      setLoadingJourneys(false);
    }
  }, [selectedTenant]);

  useEffect(() => {
    loadJourneys();
  }, [loadJourneys]);

  const handleNewJourney = () => {
    setActiveJourney(makeDefaultJourney());
    setSelectedNodeId(null);
    setShowList(false);
  };

  const handleOpenJourney = (j: Journey) => {
    setActiveJourney({ ...j });
    setSelectedNodeId(null);
    setShowList(false);
  };

  const handleSave = async () => {
    if (!activeJourney || !selectedTenant) return;
    setSaving(true);
    try {
      // Serialize journey as a sequence with __JOURNEY__ prefix in description
      const payload = {
        name: activeJourney.name,
        description: '__JOURNEY__' + JSON.stringify({ nodes: activeJourney.nodes, edges: activeJourney.edges }),
        triggerType: 'MANUAL',
        status: activeJourney.status,
        // Convert SEND_SMS nodes to sequence steps for backend compatibility
        steps: activeJourney.nodes
          .filter(n => n.type === 'SEND_SMS')
          .map((n, i) => ({
            order: i + 1,
            delayMinutes: n.config.delayValue
              ? (n.config.delayUnit === 'hours' ? Number(n.config.delayValue) * 60 : n.config.delayUnit === 'days' ? Number(n.config.delayValue) * 1440 : Number(n.config.delayValue))
              : 0,
            delayUnit: n.config.delayUnit || 'minutes',
            bodyTemplate: n.config.bodyTemplate as string || '',
          })),
      };

      if (activeJourney.id) {
        await api.updateSequence(selectedTenant.id, activeJourney.id, payload);
      } else {
        const created = await api.createSequence(selectedTenant.id, payload);
        setActiveJourney(prev => prev ? { ...prev, id: created.id } : prev);
      }
      await loadJourneys();
      alert('Journey saved successfully!');
    } catch (e) {
      console.error('Save failed:', e);
      alert('Failed to save journey. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateNode = useCallback((id: string, updates: Partial<JourneyNode>) => {
    setActiveJourney(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: prev.nodes.map(n => n.id === id ? { ...n, ...updates } : n),
      };
    });
  }, []);

  const handleDeleteNode = useCallback((id: string) => {
    setActiveJourney(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: prev.nodes.filter(n => n.id !== id),
        edges: prev.edges.filter(e => e.fromId !== id && e.toId !== id),
      };
    });
    setSelectedNodeId(null);
  }, []);

  const handleAddChild = useCallback((parentId: string, type: NodeType, label?: string) => {
    const newId = uid();
    const parent = activeJourney?.nodes.find(n => n.id === parentId);
    if (!parent) return;

    const isBranch = parent.type === 'BRANCH';
    const isSecondBranchChild = isBranch && parent.childIds.length === 1;

    const newNode: JourneyNode = {
      id: newId,
      type,
      x: isSecondBranchChild ? parent.x + 240 : parent.x,
      y: parent.y + 140,
      label: label || NODE_LABELS[type],
      config: {},
      childIds: [],
    };

    const newEdge: JourneyEdge = {
      id: uid(),
      fromId: parentId,
      toId: newId,
      label: isBranch ? (parent.childIds.length === 0 ? 'Yes' : 'No') : undefined,
    };

    setActiveJourney(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: [...prev.nodes, newNode],
        edges: [...prev.edges, newEdge],
        // Update parent childIds
        // (visual only — backend uses edges)
      };
    });
    setSelectedNodeId(newId);
  }, [activeJourney]);

  // Drag handlers
  const handleDragStart = useCallback((nodeId: string, e: React.MouseEvent) => {
    const node = activeJourney?.nodes.find(n => n.id === nodeId);
    if (!node) return;
    draggingRef.current = { nodeId, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y };
  }, [activeJourney]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return;
    const { nodeId, startX, startY, origX, origY } = draggingRef.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    setActiveJourney(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, x: origX + dx, y: origY + dy } : n),
      };
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  const selectedNode = activeJourney?.nodes.find(n => n.id === selectedNodeId) || null;

  // ── Journey List View ──────────────────────────────────────────────────────

  if (showList || !activeJourney) {
    return (
      <div style={{ padding: '32px 40px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#2d3748' }}>🗺️ Journey Builder</h2>
            <p style={{ margin: '4px 0 0', color: '#718096', fontSize: 14 }}>Visual drag-and-drop automation flows with branching logic</p>
          </div>
          <button
            onClick={handleNewJourney}
            style={{ padding: '10px 20px', background: '#6366f1', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            + New Journey
          </button>
        </div>

        {loadingJourneys ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#718096' }}>Loading journeys…</div>
        ) : journeys.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '60px 40px', background: 'white',
            borderRadius: 16, border: '2px dashed #e2e8f0',
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🗺️</div>
            <h3 style={{ margin: '0 0 8px', color: '#2d3748' }}>No Journeys Yet</h3>
            <p style={{ color: '#718096', marginBottom: 24 }}>Build visual automation flows with branching logic, wait steps, and conditional paths.</p>
            <button
              onClick={handleNewJourney}
              style={{ padding: '12px 28px', background: '#6366f1', color: 'white', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
            >
              Create Your First Journey
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {journeys.map(j => (
              <div
                key={j.id}
                onClick={() => handleOpenJourney(j)}
                style={{
                  background: 'white', borderRadius: 12, border: '1px solid #e2e8f0',
                  padding: '20px 24px', cursor: 'pointer',
                  transition: 'box-shadow 0.15s',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(99,102,241,0.15)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#2d3748' }}>{j.name}</div>
                  <div style={{
                    padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                    background: j.status === 'ACTIVE' ? '#c6f6d5' : '#e2e8f0',
                    color: j.status === 'ACTIVE' ? '#276749' : '#4a5568',
                  }}>
                    {j.status}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: '#718096' }}>
                  {j.nodes.length} nodes · {j.edges.length} connections
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                  {Array.from(new Set(j.nodes.map(n => n.type))).map(type => (
                    <span key={type} style={{
                      padding: '2px 8px', borderRadius: 20, fontSize: 11,
                      background: NODE_COLORS[type] + '18', color: NODE_COLORS[type], fontWeight: 600,
                    }}>
                      {NODE_ICONS[type]} {NODE_LABELS[type]}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Canvas View ────────────────────────────────────────────────────────────

  const nodeMap = new Map(activeJourney.nodes.map(n => [n.id, n]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', background: '#f8fafc', position: 'relative' }}>
      <Toolbar
        journey={activeJourney}
        onNameChange={name => setActiveJourney(prev => prev ? { ...prev, name } : prev)}
        onSave={handleSave}
        onStatusToggle={() => setActiveJourney(prev => prev ? {
          ...prev,
          status: prev.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
        } : prev)}
        saving={saving}
      />

      {/* Back button */}
      <div style={{ position: 'absolute', top: 68, left: 16, zIndex: 20 }}>
        <button
          onClick={() => setShowList(true)}
          style={{ padding: '6px 14px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: '#4a5568', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
        >
          ← All Journeys
        </button>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <svg
          width={CANVAS_W}
          height={CANVAS_H}
          style={{ display: 'block', background: 'radial-gradient(circle, #e2e8f0 1px, transparent 1px)', backgroundSize: '28px 28px' }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={() => setSelectedNodeId(null)}
        >
          <defs>
            <marker id="arrow" markerWidth={10} markerHeight={7} refX={10} refY={3.5} orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#cbd5e0" />
            </marker>
          </defs>

          {/* Edges */}
          {activeJourney.edges.map(edge => {
            const from = nodeMap.get(edge.fromId);
            const to = nodeMap.get(edge.toId);
            if (!from || !to) return null;
            return <EdgeLine key={edge.id} from={from} to={to} label={edge.label} />;
          })}

          {/* Nodes */}
          {activeJourney.nodes.map(node => (
            <NodeCard
              key={node.id}
              node={node}
              selected={selectedNodeId === node.id}
              onSelect={setSelectedNodeId}
              onDragStart={handleDragStart}
            />
          ))}
        </svg>
      </div>

      {/* Sidebar */}
      {selectedNode && (
        <SidebarPanel
          node={selectedNode}
          onUpdate={handleUpdateNode}
          onDelete={handleDeleteNode}
          onClose={() => setSelectedNodeId(null)}
          onAddChild={handleAddChild}
        />
      )}
    </div>
  );
}
