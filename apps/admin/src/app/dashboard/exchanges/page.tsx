'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DataState, DataTable, DateText, Ident, Money, PageHeader, SelectField, StatusBadge } from '@/components/ui';
import { qs } from '@/lib/api';
import { useApi, useCan, useUrlFilter } from '@/lib/session';

interface ExchangeRow {
  id: string;
  exchangeNumber: string;
  orderId: string;
  status: string;
  paymentDirection: string;
  paymentStatus: string;
  priceDifference: string;
  createdAt: string;
}

const STATUSES = ['REQUESTED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'RECEIVED', 'REPLACEMENT_ALLOCATED', 'COMPLETED', 'QC_FAILED', 'REPLACEMENT_UNAVAILABLE', 'CANCELLED'];

/** Exchanges queue (GET /exchanges). Unfiltered, the exchange service lists open work, paged in batches of 100. */
export default function ExchangesPage() {
  const [skip, setSkip] = useState(0);
  const [status, setStatus, ready] = useUrlFilter('status');
  const exchanges = useApi<ExchangeRow[]>(ready ? `/exchanges${qs({ status, take: 100, skip })}` : null);
  const canOrders = useCan('order:read');
  const orderIds = [...new Set((exchanges.data ?? []).map((r) => r.orderId))];
  const labels = useApi<{ orders: Record<string, string> }>(canOrders && orderIds.length ? `/admin/lookup/labels${qs({ orderIds: orderIds.join(',') })}` : null);

  return (
    <div>
      <PageHeader
        title="Exchanges"
        breadcrumbs={[{ label: 'Post-purchase' }, { label: 'Exchanges' }]}
        description="Exchanges are started from an order line. The original item is collected and QC'd; the replacement ships through the normal pick, pack and ship pipeline."
      />
      <div className="filter-bar">
        <SelectField
          label="Status"
          value={status}
          placeholder="Open work"
          options={STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ').toLowerCase() }))}
          onChange={(value) => { setSkip(0); setStatus(value); }}
        />
      </div>
      <DataState state={exchanges}>
        {(rows) => (
          <>
          <DataTable
            caption="Exchanges"
            rows={rows}
            rowKey={(r) => r.id}
            empty="No exchanges in this view."
            columns={[
              {
                header: 'Exchange',
                cell: (r) => (
                  <Link href={`/dashboard/exchanges/${r.id}`}>
                    <Ident>{r.exchangeNumber}</Ident>
                  </Link>
                ),
              },
              { header: 'Order', cell: (r) => (canOrders ? <Ident>{labels.data?.orders[r.orderId] ?? '…'}</Ident> : '—') },
              { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
              { header: 'Settlement', cell: (r) => r.paymentDirection.replace(/_/g, ' ').toLowerCase() },
              { header: 'Price difference', numeric: true, cell: (r) => <Money value={r.priceDifference} /> },
              { header: 'Payment', cell: (r) => <StatusBadge status={r.paymentStatus} /> },
              { header: 'Requested', cell: (r) => <DateText value={r.createdAt} withTime /> },
            ]}
          />
          <div className="filter-bar"><button type="button" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - 100))}>Previous</button><button type="button" disabled={rows.length < 100} onClick={() => setSkip(skip + 100)}>Next</button></div>
          </>
        )}
      </DataState>
    </div>
  );
}
