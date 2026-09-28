'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';

interface Customer360 {
  id: string;
  mobile: string;
  email: string | null;
  fullName: string | null;
  isMobileVerified: boolean;
  customerSince: string;
  lifetimeOrderCount: number;
  lifetimeSpend: number;
  recentOrders: Array<{ id: string; orderNumber: string; status: string; grandTotal: number; createdAt: string }>;
  loyalty: { availablePoints: number; pendingPoints: number };
  storeCreditBalance: number;
  openReturnsCount: number;
  openExchangesCount: number;
}

/**
 * Internal Customer 360 (M29, ADM-002) - a data-minimized staff view,
 * deliberately narrower than the customer's own self-service profile
 * (no address book, recently-viewed, or saved sizes).
 */
export default function Customer360Page() {
  const [mobile, setMobile] = useState('');
  const [view, setView] = useState<Customer360 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onLookup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setView(null);
    setLoading(true);
    try {
      const customer = await apiFetch<{ id: string }>(`/support/customers/lookup?mobile=${encodeURIComponent(mobile)}`);
      setView(await apiFetch<Customer360>(`/support/customers/${customer.id}/360`));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? 'No customer found for that mobile number.' : err instanceof Error ? err.message : 'Lookup failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.25rem' }}>Internal Customer 360</h1>
      <form onSubmit={onLookup} className="card" style={{ maxWidth: 420, marginBottom: '1.5rem' }}>
        {error && <p className="error-banner">{error}</p>}
        <div className="field">
          <label htmlFor="mobile">Customer mobile number</label>
          <input id="mobile" required value={mobile} onChange={(e) => setMobile(e.target.value)} />
        </div>
        <button className="primary" type="submit" disabled={loading}>
          {loading ? 'Looking up...' : 'Look up'}
        </button>
      </form>

      {view && (
        <div className="card" style={{ maxWidth: 640 }}>
          <h2 style={{ fontSize: '1.1rem' }}>{view.fullName ?? 'Unnamed customer'}</h2>
          <p>
            {view.mobile} {view.isMobileVerified ? '(verified)' : '(unverified)'} - {view.email ?? 'no email'}
          </p>
          <p>Customer since {new Date(view.customerSince).toLocaleDateString()}</p>
          <p>
            Lifetime orders: {view.lifetimeOrderCount} - Lifetime spend: {view.lifetimeSpend}
          </p>
          <p>
            Loyalty: {view.loyalty.availablePoints} available, {view.loyalty.pendingPoints} pending
          </p>
          <p>Store credit balance: {view.storeCreditBalance}</p>
          <p>
            Open returns: {view.openReturnsCount} - Open exchanges: {view.openExchangesCount}
          </p>
          <h3 style={{ fontSize: '1rem' }}>Recent orders</h3>
          <table>
            <thead>
              <tr>
                <th>Order #</th>
                <th>Status</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {view.recentOrders.map((o) => (
                <tr key={o.id}>
                  <td>{o.orderNumber}</td>
                  <td>{o.status}</td>
                  <td>{o.grandTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
