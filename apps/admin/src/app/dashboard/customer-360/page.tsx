'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Can, DataTable, DateText, Ident, Money, Notice, PageHeader, Section, StatusBadge, TextField } from '@/components/ui';
import { apiFetch, ApiError, errorMessage, qs } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { useCan } from '@/lib/session';

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
 * (no address book, recently-viewed, or saved sizes). Found by exact
 * mobile number only; there is no customer browse or search.
 */
export default function Customer360Page() {
  const canOrders = useCan('order:read');
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
      const customer = await apiFetch<{ id: string }>(`/support/customers/lookup${qs({ mobile })}`);
      setView(await apiFetch<Customer360>(`/support/customers/${customer.id}/360`));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? 'No customer found for that mobile number.' : errorMessage(err, 'Lookup failed.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Customer 360"
        breadcrumbs={[{ label: 'Customers' }, { label: 'Customer 360' }]}
        description="Look up one customer by their exact mobile number. Addresses, browsing history and saved sizes are deliberately not shown."
      />
      <form onSubmit={onLookup} className="card row" style={{ maxWidth: 560, alignItems: 'flex-end' }}>
        <TextField label="Customer mobile number" required value={mobile} onChange={setMobile} autoComplete="off" />
        <button className="primary" type="submit" disabled={loading} style={{ marginBottom: '0.75rem' }}>
          {loading ? 'Looking up...' : 'Look up'}
        </button>
      </form>
      {error && <Notice kind="error">{error}</Notice>}

      {view && (
        <>
          <section className="kpis" aria-label="Customer summary">
            <div className="kpi">
              <div className="kpi-label">Lifetime orders</div>
              <div className="kpi-value">{formatNumber(view.lifetimeOrderCount)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Lifetime spend</div>
              <div className="kpi-value">
                <Money value={view.lifetimeSpend} />
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Loyalty available</div>
              <div className="kpi-value">{formatNumber(view.loyalty.availablePoints)}</div>
              <div className="kpi-hint">{formatNumber(view.loyalty.pendingPoints)} pending</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Store credit</div>
              <div className="kpi-value">
                <Money value={view.storeCreditBalance} />
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Open returns</div>
              <div className="kpi-value">{formatNumber(view.openReturnsCount)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Open exchanges</div>
              <div className="kpi-value">{formatNumber(view.openExchangesCount)}</div>
            </div>
          </section>
          <div className="grid-2">
            <Section title={view.fullName ?? 'Unnamed customer'}>
              <dl className="dl">
                <dt>Mobile</dt>
                <dd>
                  {view.mobile} {view.isMobileVerified ? <StatusBadge status="ACTIVE" /> : <span className="muted">(unverified)</span>}
                </dd>
                <dt>Email</dt>
                <dd>{view.email ?? '—'}</dd>
                <dt>Customer since</dt>
                <dd>
                  <DateText value={view.customerSince} />
                </dd>
              </dl>
              <Can anyOf={['loyalty:adjust']}>
                <p>
                  <Link href={`/dashboard/loyalty${qs({ mobile: view.mobile })}`}>Adjust loyalty points</Link>
                </p>
              </Can>
            </Section>
            <Section title="Recent orders">
              <DataTable
                caption="Recent orders"
                rows={view.recentOrders}
                rowKey={(o) => o.id}
                empty="No orders."
                columns={[
                  { header: 'Order', cell: (o) => (canOrders ? <Link href={`/dashboard/orders/${o.id}`}><Ident>{o.orderNumber}</Ident></Link> : <Ident>{o.orderNumber}</Ident>) },
                  { header: 'Status', cell: (o) => <StatusBadge status={o.status} /> },
                  { header: 'Total', numeric: true, cell: (o) => <Money value={o.grandTotal} /> },
                  { header: 'Placed', cell: (o) => <DateText value={o.createdAt} /> },
                ]}
              />
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
