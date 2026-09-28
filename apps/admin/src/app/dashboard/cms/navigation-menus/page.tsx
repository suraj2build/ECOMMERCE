'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

interface NavigationMenu {
  id: string;
  key: string;
  items: Array<{ label: string; url: string; sortOrder?: number }>;
}

export default function NavigationMenusPage() {
  const [menus, setMenus] = useState<NavigationMenu[]>([]);
  const [key, setKey] = useState('main-nav');
  const [itemsJson, setItemsJson] = useState('[{"label":"Men","url":"/men","sortOrder":1}]');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setMenus(await apiFetch<NavigationMenu[]>('/cms/navigation-menus'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load navigation menus.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const items = JSON.parse(itemsJson);
      await apiFetch(`/cms/navigation-menus/${key}`, { method: 'PUT', body: JSON.stringify({ items }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save navigation menu (check the JSON is valid).');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.25rem' }}>CMS - Navigation Menus</h1>
      {error && <p className="error-banner">{error}</p>}
      <form onSubmit={onSave} className="card" style={{ maxWidth: 560, marginBottom: '1.5rem' }}>
        <div className="field">
          <label htmlFor="key">Menu key</label>
          <input id="key" required value={key} onChange={(e) => setKey(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="items">Items (JSON array of {'{'}label, url, sortOrder{'}'})</label>
          <textarea id="items" rows={4} value={itemsJson} onChange={(e) => setItemsJson(e.target.value)} />
        </div>
        <button className="primary" type="submit">
          Save menu
        </button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Items</th>
          </tr>
        </thead>
        <tbody>
          {menus.map((m) => (
            <tr key={m.id}>
              <td>{m.key}</td>
              <td>{m.items.map((i) => i.label).join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
