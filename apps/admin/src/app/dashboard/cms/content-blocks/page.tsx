'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

interface ContentBlock {
  id: string;
  key: string;
  title: string;
  content: string;
  isActive: boolean;
}

export default function ContentBlocksPage() {
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setBlocks(await apiFetch<ContentBlock[]>('/cms/content-blocks'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load content blocks.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/cms/content-blocks', { method: 'POST', body: JSON.stringify({ key, title, content }) });
      setKey('');
      setTitle('');
      setContent('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create content block.');
    }
  }

  async function toggleActive(block: ContentBlock) {
    setError(null);
    try {
      await apiFetch(`/cms/content-blocks/${block.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !block.isActive }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update content block.');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.25rem' }}>CMS - Content Blocks</h1>
      {error && <p className="error-banner">{error}</p>}
      <form onSubmit={onCreate} className="card" style={{ maxWidth: 480, marginBottom: '1.5rem' }}>
        <div className="field">
          <label htmlFor="key">Key (stable identifier)</label>
          <input id="key" required value={key} onChange={(e) => setKey(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="title">Title</label>
          <input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="content">Content (HTML)</label>
          <textarea id="content" required value={content} onChange={(e) => setContent(e.target.value)} />
        </div>
        <button className="primary" type="submit">
          Create content block
        </button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Title</th>
            <th>Active</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((b) => (
            <tr key={b.id}>
              <td>{b.key}</td>
              <td>{b.title}</td>
              <td>{b.isActive ? 'Yes' : 'No'}</td>
              <td>
                <button type="button" onClick={() => toggleActive(b)}>
                  {b.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
