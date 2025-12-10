import { useState, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import { api, KBArticle } from '../api/client';

export default function KnowledgeBase() {
  const { selectedTenant } = useTenant();
  const [articles, setArticles] = useState<KBArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [content, setContent] = useState('');

  const fetchArticles = async () => {
    if (!selectedTenant) return;
    setLoading(true);
    try {
      const data = await api.getKBArticles(selectedTenant.id);
      setArticles(data);
    } catch (error) {
      console.error('Failed to fetch KB articles:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArticles();
  }, [selectedTenant]);

  const handleCreateArticle = async () => {
    if (!selectedTenant || !title.trim() || !topic.trim() || !content.trim()) {
      alert('Please fill in all fields');
      return;
    }
    try {
      await api.createKBArticle(selectedTenant.id, {
        title,
        topic,
        content,
      });
      setShowCreateModal(false);
      setTitle('');
      setTopic('');
      setContent('');
      fetchArticles();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to create article: ' + message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Knowledge Base</h2>
        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
          Add Article
        </button>
      </div>
      
      <div className="card">
        {loading ? (
          <p>Loading articles...</p>
        ) : articles.length === 0 ? (
          <p className="empty-state">No knowledge base articles yet</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Topic</th>
                <th>Source</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {articles.map(article => (
                <tr key={article.id}>
                  <td>{article.title}</td>
                  <td><span className="tag">{article.topic}</span></td>
                  <td>{article.sourceType}</td>
                  <td>{new Date(article.id).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <h3>Add Knowledge Base Article</h3>
            <div className="form-group">
              <label>Title *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Article title"
              />
            </div>
            <div className="form-group">
              <label>Topic *</label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g., pricing, services, faq"
              />
            </div>
            <div className="form-group">
              <label>Content *</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Article content..."
                style={{ minHeight: '200px' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreateArticle}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
