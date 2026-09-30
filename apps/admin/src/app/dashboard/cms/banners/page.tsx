'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui';
import { apiFetch, ApiError } from '@/lib/api';

interface Banner {
  id: string;
  title: string;
  imageUrl: string;
  placement: string;
  sortOrder: number;
  isActive: boolean;
}

export default function BannersPage() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [title, setTitle] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [placement, setPlacement] = useState('HOMEPAGE_HERO');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setBanners(await apiFetch<Banner[]>('/cms/banners'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load banners.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/cms/banners', { method: 'POST', body: JSON.stringify({ title, imageUrl, placement, sortOrder: banners.length }) });
      setTitle('');
      setImageUrl('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create banner.');
    }
  }

  async function toggleActive(banner: Banner) {
    setError(null);
    try {
      await apiFetch(`/cms/banners/${banner.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !banner.isActive }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update banner.');
    }
  }

  return (
    <div>
      <PageHeader title="Banners" breadcrumbs={[{ label: 'Content' }, { label: 'Banners' }]} description="Homepage banners shown on the storefront. Changes go live without a deployment." />
      {error && <p className="error-banner" role="alert">{error}</p>}
      <form onSubmit={onCreate} className="card" style={{ maxWidth: 480, marginBottom: '1.5rem' }}>
        <div className="field">
          <label htmlFor="title">Title</label>
          <input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="imageUrl">Image URL</label>
          <input id="imageUrl" required value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="placement">Placement</label>
          <input id="placement" required value={placement} onChange={(e) => setPlacement(e.target.value)} />
        </div>
        <button className="primary" type="submit">
          Create banner
        </button>
      </form>
      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Placement</th>
            <th>Active</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {banners.map((b) => (
            <tr key={b.id}>
              <td>{b.title}</td>
              <td>{b.placement}</td>
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
    </div>
  );
}
