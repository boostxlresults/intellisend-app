import { useEffect, useMemo, useState } from 'react';
import { api, CsrAgentAction, CsrAgentTurn } from '../api/client';

/**
 * Review panel for the Claude virtual CSR on one conversation.
 *
 * Practice (shadow) mode: shows the drafted reply and every ServiceTitan
 * change the agent wants to make. A CSR can edit the reply, approve (changes
 * run in order, then the reply sends) or reject with feedback.
 * Supervised mode: shows single actions waiting for approval.
 * Always: a full activity log of what the agent looked up and did.
 */

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  READ: { bg: '#EDF2F7', fg: '#4A5568', label: 'looked up' },
  EXECUTED: { bg: '#C6F6D5', fg: '#22543D', label: 'done' },
  APPROVED_EXECUTED: { bg: '#C6F6D5', fg: '#22543D', label: 'approved and done' },
  PROPOSED: { bg: '#FEFCBF', fg: '#744210', label: 'needs approval' },
  REJECTED: { bg: '#FED7D7', fg: '#822727', label: 'rejected' },
  FAILED: { bg: '#FED7D7', fg: '#822727', label: 'failed' },
  BLOCKED: { bg: '#FEEBC8', fg: '#7B341E', label: 'blocked by safety rule' },
  PENDING: { bg: '#EDF2F7', fg: '#4A5568', label: 'running' },
};

function slotLabels(turns: CsrAgentTurn[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of turns) for (const a of t.actions) {
    const windows = (a.result as any)?.windows;
    if (a.tool === 'check_availability' && Array.isArray(windows)) {
      for (const w of windows) m.set(w.slot_id, w.arrival_window);
    }
  }
  return m;
}

function describe(a: CsrAgentAction, slots: Map<string, string>): string {
  const i = a.input as any;
  const r = (a.result ?? {}) as any;
  switch (a.tool) {
    case 'lookup_customer_by_phone': return `Looked up the customer by phone${typeof r.found === 'number' ? `: ${r.found} found` : ''}`;
    case 'search_customers': return `Searched ServiceTitan for ${[i.name, i.street, i.zip].filter(Boolean).join(', ')}${typeof r.found === 'number' ? `: ${r.found} found` : ''}`;
    case 'get_customer_details': return `Pulled account details for customer #${i.customer_id}`;
    case 'check_availability': return `Checked the board for ${r.job_type ?? i.job_type_key}${Array.isArray(r.windows) ? `: ${r.windows.length} open windows` : ''}`;
    case 'book_appointment': return `Book ${i.job_type_key} on ${slots.get(i.slot_id) ?? 'the chosen window'} (unassigned) for customer #${i.customer_id}. Tech note: "${i.summary}"${r.job_number ? `. Job #${r.job_number}` : ''}`;
    case 'create_customer': return `Create a new ServiceTitan account: ${i.name}, ${i.street}${i.unit ? ` ${i.unit}` : ''}, ${i.city} ${i.state} ${i.zip}`;
    case 'add_customer_contact': return `Add ${i.type} ${i.value} to customer #${i.customer_id}`;
    case 'add_note': return `Add a ${i.target} note to #${i.id}: "${i.text}"`;
    case 'hand_off_to_human': return `Handed off to a person (${i.urgency}): ${i.reason}`;
    case 'send_reply': return 'Wrote the reply';
    case 'end_without_reply': return `Chose not to reply: ${i.reason}`;
    default: return a.tool;
  }
}

function Badge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.PENDING;
  return (
    <span style={{ background: s.bg, color: s.fg, fontSize: '11px', padding: '2px 8px', borderRadius: '10px', whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  );
}

export default function VirtualCsrPanel({ tenantId, conversationId }: { tenantId: string; conversationId: string }) {
  const [turns, setTurns] = useState<CsrAgentTurn[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const draft = turns.find((t) => t.status === 'DRAFT') ?? null;
  const pendingSingles = turns
    .filter((t) => t.status !== 'DRAFT')
    .flatMap((t) => t.actions.filter((a) => a.status === 'PROPOSED'));
  const slots = useMemo(() => slotLabels(turns), [turns]);

  const load = async () => {
    try {
      const [cfg, data] = await Promise.all([
        api.getVirtualCsrConfig(tenantId),
        api.getVirtualCsrTurns(tenantId, conversationId),
      ]);
      setEnabled(cfg.enabled && cfg.agentEngine === 'claude');
      setTurns(data);
    } catch (error) {
      console.error('Failed to load virtual CSR activity:', error);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [tenantId, conversationId]);

  // Load the draft text into the editor when a new draft arrives.
  useEffect(() => {
    setDraftText(draft?.replyText ?? '');
    setNote('');
  }, [draft?.id]);

  if (!enabled && turns.length === 0) return null;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const approve = () => act(async () => {
    if (!draft) return;
    const edited = draftText.trim() !== (draft.replyText ?? '').trim() ? draftText : undefined;
    const r = await api.approveCsrTurn(tenantId, draft.id, edited, note || undefined);
    if (r.error) alert(`Not sent. A ServiceTitan change failed: ${r.error}`);
  });

  const reject = () => act(async () => {
    if (!draft) return;
    await api.rejectCsrTurn(tenantId, draft.id, note || undefined);
  });

  return (
    <div style={{ border: '1px solid #BEE3F8', background: '#F7FBFF', borderRadius: '8px', padding: '12px', margin: '10px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <strong style={{ fontSize: '14px' }}>Virtual CSR</strong>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button className="btn btn-secondary btn-small" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => setShowLog(!showLog)}>
            {showLog ? 'Hide activity' : 'Show activity'}
          </button>
          {enabled && (
            <button
              className="btn btn-secondary btn-small"
              style={{ padding: '4px 10px', fontSize: '12px' }}
              disabled={busy}
              onClick={() => act(() => api.runVirtualCsr(tenantId, conversationId))}
            >
              Draft a reply now
            </button>
          )}
        </div>
      </div>

      {draft && (
        <div>
          <div style={{ fontSize: '12px', color: '#2B6CB0', marginBottom: '6px' }}>
            Practice mode draft. Nothing has been sent or changed in ServiceTitan yet.
          </div>
          {draft.actions.some((a) => a.status === 'PROPOSED') && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Approving will also:</div>
              {draft.actions.filter((a) => a.status === 'PROPOSED').map((a) => (
                <div key={a.id} style={{ fontSize: '13px', padding: '4px 0' }}>• {describe(a, slots)}</div>
              ))}
            </div>
          )}
          {draft.actions.some((a) => a.status === 'BLOCKED' || a.status === 'FAILED') && (
            <div style={{ fontSize: '12px', color: '#9C4221', marginBottom: '8px' }}>
              {draft.actions.filter((a) => a.status === 'BLOCKED' || a.status === 'FAILED').map((a) => (
                <div key={a.id}>Stopped: {describe(a, slots)} ({a.error})</div>
              ))}
            </div>
          )}
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={3}
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e0', fontFamily: 'inherit' }}
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Feedback for the agent (optional): what should it have done differently?"
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e0', margin: '6px 0' }}
          />
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" disabled={busy} onClick={reject}>Reject</button>
            <button className="btn btn-primary" disabled={busy || !draftText.trim()} onClick={approve}>
              {draftText.trim() !== (draft.replyText ?? '').trim() ? 'Approve with my edits' : 'Approve and send'}
            </button>
          </div>
        </div>
      )}

      {pendingSingles.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Waiting for approval</div>
          {pendingSingles.map((a) => (
            <div key={a.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px', padding: '4px 0' }}>
              <span style={{ flex: 1 }}>{describe(a, slots)}</span>
              <button className="btn btn-secondary btn-small" disabled={busy} style={{ padding: '3px 8px', fontSize: '12px' }}
                onClick={() => act(() => api.rejectCsrAction(tenantId, a.id))}>Reject</button>
              <button className="btn btn-primary btn-small" disabled={busy} style={{ padding: '3px 8px', fontSize: '12px' }}
                onClick={() => act(async () => {
                  const r = await api.approveCsrAction(tenantId, a.id);
                  if (!r.ok) alert(`Failed: ${r.error}`);
                })}>Approve</button>
            </div>
          ))}
        </div>
      )}

      {!draft && pendingSingles.length === 0 && !showLog && (
        <div style={{ fontSize: '12px', color: '#718096' }}>
          {turns[0] ? `Last activity: ${turns[0].status.toLowerCase().replace('_', ' ')} at ${new Date(turns[0].createdAt).toLocaleString()}` : 'No agent activity yet.'}
        </div>
      )}

      {showLog && (
        <div style={{ marginTop: '10px', maxHeight: '260px', overflowY: 'auto', borderTop: '1px solid #E2E8F0', paddingTop: '8px' }}>
          {turns.length === 0 && <div style={{ fontSize: '12px', color: '#718096' }}>No agent activity yet.</div>}
          {turns.map((t) => (
            <div key={t.id} style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', color: '#4A5568', fontWeight: 600 }}>
                {new Date(t.createdAt).toLocaleString()} · {t.mode} · {t.status.toLowerCase().replace('_', ' ')}
                {t.reviewNote ? ` · feedback: "${t.reviewNote}"` : ''}
              </div>
              {t.actions.filter((a) => a.tool !== 'send_reply').map((a) => (
                <div key={a.id} style={{ display: 'flex', gap: '8px', fontSize: '12px', padding: '2px 0' }}>
                  <Badge status={a.status} />
                  <span>{describe(a, slots)}{a.error ? ` (${a.error})` : ''}</span>
                </div>
              ))}
              {(t.finalText || t.replyText) && (
                <div style={{ fontSize: '12px', color: '#2D3748', fontStyle: 'italic', marginTop: '2px' }}>
                  “{t.finalText || t.replyText}”
                </div>
              )}
              {t.error && <div style={{ fontSize: '12px', color: '#C53030' }}>Error: {t.error}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
