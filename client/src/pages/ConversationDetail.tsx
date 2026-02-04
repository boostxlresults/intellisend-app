import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import { api, Conversation } from '../api/client';

export default function ConversationDetail() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { selectedTenant } = useTenant();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<{ text: string }[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [togglingAI, setTogglingAI] = useState(false);
  const [resettingSession, setResettingSession] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchConversation = async () => {
    if (!selectedTenant || !conversationId) return;
    setLoading(true);
    try {
      const data = await api.getConversation(selectedTenant.id, conversationId);
      setConversation(data);
    } catch (error) {
      console.error('Failed to fetch conversation:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConversation();
  }, [selectedTenant, conversationId]);

  // Auto-refresh every 5 seconds to show new messages (including AI responses)
  useEffect(() => {
    const interval = setInterval(() => {
      if (selectedTenant && conversationId && !sending && !loading) {
        api.getConversation(selectedTenant.id, conversationId).then(data => {
          // Always update - compare by last message timestamp or count
          const currentLastTime = conversation?.messages?.slice(-1)[0]?.createdAt;
          const newLastTime = data.messages?.slice(-1)[0]?.createdAt;
          const currentCount = conversation?.messages?.length || 0;
          const newCount = data.messages?.length || 0;
          
          if (newCount !== currentCount || newLastTime !== currentLastTime) {
            setConversation(data);
          }
        }).catch(() => {});
      }
    }, 5000);
    
    return () => clearInterval(interval);
  }, [selectedTenant, conversationId, conversation?.messages, sending, loading]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation?.messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant || !conversationId || !newMessage.trim()) return;
    setSending(true);
    try {
      await api.sendMessage(selectedTenant.id, conversationId, newMessage);
      setNewMessage('');
      setSuggestions([]);
      fetchConversation();
    } catch (error: unknown) {
      let errorMessage = 'Unknown error';
      if (error && typeof error === 'object' && 'message' in error) {
        errorMessage = (error as { message: string }).message;
      }
      alert('Failed to send message: ' + errorMessage);
      fetchConversation();
    } finally {
      setSending(false);
    }
  };

  const handleGetSuggestions = async () => {
    if (!selectedTenant || !conversationId) return;
    setLoadingSuggestions(true);
    try {
      const result = await api.suggestReplies(selectedTenant.id, conversationId);
      setSuggestions(result.suggestions);
    } catch (error) {
      console.error('Failed to get suggestions:', error);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const handleToggleAIAgent = async () => {
    if (!selectedTenant || !conversationId || !conversation) return;
    setTogglingAI(true);
    try {
      const updated = await api.updateConversation(selectedTenant.id, conversationId, {
        aiAgentEnabled: !conversation.aiAgentEnabled,
      });
      setConversation({ ...conversation, aiAgentEnabled: updated.aiAgentEnabled });
    } catch (error) {
      console.error('Failed to toggle AI agent:', error);
    } finally {
      setTogglingAI(false);
    }
  };

  const handleResetAISession = async () => {
    if (!selectedTenant || !conversationId) return;
    if (!window.confirm('Reset the AI session for this conversation? This will allow the AI to engage fresh.')) return;
    setResettingSession(true);
    try {
      await api.resetAISession(selectedTenant.id, conversationId);
      alert('AI session reset successfully. The AI will now engage fresh with this contact.');
    } catch (error: unknown) {
      let errorMessage = 'Unknown error';
      if (error && typeof error === 'object' && 'message' in error) {
        errorMessage = (error as { message: string }).message;
      }
      alert('Failed to reset AI session: ' + errorMessage);
    } finally {
      setResettingSession(false);
    }
  };

  if (loading) {
    return <p>Loading conversation...</p>;
  }

  if (!conversation) {
    return <p>Conversation not found</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)' }}>
      <div className="page-header">
        <div>
          <Link to="/conversations" style={{ color: '#718096', textDecoration: 'none', fontSize: '14px' }}>
            &larr; Back to Conversations
          </Link>
          <h2 style={{ marginTop: '8px' }}>
            {conversation.contact?.firstName} {conversation.contact?.lastName}
            <span style={{ fontWeight: 'normal', color: '#718096', marginLeft: '10px' }}>
              {conversation.contact?.phone}
            </span>
          </h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={conversation.aiAgentEnabled !== false}
              onChange={handleToggleAIAgent}
              disabled={togglingAI}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
            <span style={{ fontSize: '14px', color: conversation.aiAgentEnabled !== false ? '#48bb78' : '#a0aec0' }}>
              AI Agent {conversation.aiAgentEnabled !== false ? 'ON' : 'OFF'}
            </span>
          </label>
          <button
            type="button"
            onClick={handleResetAISession}
            disabled={resettingSession}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              backgroundColor: '#805ad5',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: resettingSession ? 'not-allowed' : 'pointer',
              opacity: resettingSession ? 0.6 : 1,
            }}
          >
            {resettingSession ? 'Resetting...' : 'Reset AI'}
          </button>
          <span className={`status-badge ${conversation.status.toLowerCase()}`}>{conversation.status}</span>
        </div>
      </div>
      
      <div className="message-list" style={{ flex: 1 }}>
        {conversation.messages?.map(msg => (
          <div
            key={msg.id}
            className={`message ${msg.direction.toLowerCase()}`}
          >
            {msg.mediaUrl && (
              <div style={{ marginBottom: '8px' }}>
                <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer">
                  <img 
                    src={msg.mediaUrl} 
                    alt="MMS attachment" 
                    style={{ 
                      maxWidth: '200px', 
                      maxHeight: '200px', 
                      borderRadius: '8px',
                      cursor: 'pointer',
                    }} 
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </a>
              </div>
            )}
            <div>{msg.body}</div>
            <div className="message-time">
              {new Date(msg.createdAt).toLocaleString()}
              {msg.status && msg.direction === 'OUTBOUND' && (
                <span style={{ marginLeft: '8px' }}>({msg.status})</span>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      
      {suggestions.length > 0 && (
        <div className="suggestion-list" style={{ marginBottom: '10px' }}>
          <strong style={{ fontSize: '12px', color: '#718096' }}>AI Suggestions:</strong>
          {suggestions.map((s, i) => (
            <div
              key={i}
              className="suggestion-item"
              onClick={() => {
                setNewMessage(s.text);
                setSuggestions([]);
              }}
            >
              {s.text}
            </div>
          ))}
        </div>
      )}
      
      <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '10px' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleGetSuggestions}
          disabled={loadingSuggestions}
        >
          {loadingSuggestions ? '...' : 'Suggest Reply'}
        </button>
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type your message..."
          style={{ flex: 1, padding: '10px', border: '1px solid #cbd5e0', borderRadius: '6px' }}
          disabled={sending}
        />
        <button type="submit" className="btn btn-primary" disabled={sending || !newMessage.trim()}>
          {sending ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
