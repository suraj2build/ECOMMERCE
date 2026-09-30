'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui';
import { apiFetch } from '@/lib/api';

interface LandingPage {
  id: string;
  slug: string;
  title: string;
  isPublished: boolean;
}

export default function LandingPagesPage() {
  const [pages, setPages] = useState<LandingPage[]>([]);
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [blockKeys, setBlockKeys] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setPages(await apiFetch<LandingPage[]>('/cms/landing-pages'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load landing pages.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/cms/landing-pages', {
        method: 'POST',
        body: JSON.stringify({
          slug,
          title,
          blockKeys: blockKeys
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean),
        }),
      });
      setSlug('');
      setTitle('');
      setBlockKeys('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create landing page.');
    }
  }

  async function togglePublish(page: LandingPage) {
    setError(null);
    try {
      await apiFetch(`/cms/landing-pages/${page.id}/${page.isPublished ? 'unpublish' : 'publish'}`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update landing page.');
    }
  }

  return (
    <div>
      <PageHeader title="Landing pages" breadcrumbs={[{ label: 'Content' }, { label: 'Landing pages' }]} description="Campaign landing pages; only published pages are visible on the storefront." />
      {error && <p className="error-banner" role="alert">{error}</p>}
      <form onSubmit={onCreate} className="card" style={{ maxWidth: 480, marginBottom: '1.5rem' }}>
        <div className="field">
          <label htmlFor="slug">Slug</label>
          <input id="slug" required value={slug} onChange={(e) => setSlug(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="title">Title</label>
          <input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="blockKeys">Content block keys (comma-separated)</label>
          <input id="blockKeys" value={blockKeys} onChange={(e) => setBlockKeys(e.target.value)} />
        </div>
        <button className="primary" type="submit">
          Create landing page
        </button>
      </form>
      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Slug</th>
            <th>Title</th>
            <th>Published</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {pages.map((p) => (
            <tr key={p.id}>
              <td>{p.slug}</td>
              <td>{p.title}</td>
              <td>{p.isPublished ? 'Yes' : 'No'}</td>
              <td>
                <button type="button" onClick={() => togglePublish(p)}>
                  {p.isPublished ? 'Unpublish' : 'Publish'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
