'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

interface Channel {
  id: string;
  key: string;
  name: string;
  providerName: string;
  isActive: boolean;
}

interface ChannelListing {
  id: string;
  skuId: string;
  status: string;
  lastPublishedAt: string | null;
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [listings, setListings] = useState<ChannelListing[]>([]);
  const [skuId, setSkuId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function loadChannels() {
    try {
      const data = await apiFetch<Channel[]>('/channels');
      setChannels(data);
      if (data.length > 0 && !selectedChannelId) setSelectedChannelId(data[0]!.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load channels.');
    }
  }

  async function loadListings(channelId: string) {
    if (!channelId) return;
    try {
      setListings(await apiFetch<ChannelListing[]>(`/channels/${channelId}/listings`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load listings.');
    }
  }

  useEffect(() => {
    void loadChannels();
  }, []);

  useEffect(() => {
    void loadListings(selectedChannelId);
  }, [selectedChannelId]);

  async function onPublish(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch(`/channels/${selectedChannelId}/skus/${skuId}/publish`, { method: 'POST' });
      setSkuId('');
      await loadListings(selectedChannelId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish SKU.');
    }
  }

  async function onUnpublish(listing: ChannelListing) {
    setError(null);
    try {
      await apiFetch(`/channels/${selectedChannelId}/skus/${listing.skuId}/unpublish`, { method: 'POST' });
      await loadListings(selectedChannelId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unpublish SKU.');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.25rem' }}>Channel Publishing</h1>
      {error && <p className="error-banner">{error}</p>}
      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="channel">Channel</label>
        <select id="channel" value={selectedChannelId} onChange={(e) => setSelectedChannelId(e.target.value)}>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.providerName})
            </option>
          ))}
        </select>
      </div>

      <form onSubmit={onPublish} className="card" style={{ maxWidth: 420, marginBottom: '1.5rem' }}>
        <div className="field">
          <label htmlFor="skuId">SKU ID to publish</label>
          <input id="skuId" required value={skuId} onChange={(e) => setSkuId(e.target.value)} />
        </div>
        <button className="primary" type="submit" disabled={!selectedChannelId}>
          Publish SKU
        </button>
      </form>

      <table>
        <thead>
          <tr>
            <th>SKU ID</th>
            <th>Status</th>
            <th>Last published</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {listings.map((l) => (
            <tr key={l.id}>
              <td>{l.skuId}</td>
              <td>{l.status}</td>
              <td>{l.lastPublishedAt ? new Date(l.lastPublishedAt).toLocaleString() : '-'}</td>
              <td>
                <button type="button" onClick={() => onUnpublish(l)}>
                  Unpublish
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
