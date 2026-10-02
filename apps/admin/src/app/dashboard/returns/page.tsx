'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DataState, DataTable, DateText, Ident, PageHeader, SelectField, StatusBadge } from '@/components/ui';
import { qs } from '@/lib/api';
import { useApi, useCan, useUrlFilter } from '@/lib/session';

interface ReturnRow {
  id: string;
  returnNumber: string;
  orderId: string;
  status: string;
  method: string;
  createdAt: string;
  lines: Array<{ id: string }>;
}

const STATUSES = ['REQUESTED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'RECEIVED', 'DISPOSITIONED', 'CANCELLED'];

/**
 * Returns queue (GET /returns). With no status filter the return service
 * lists open warehouse work, oldest first, paged in batches of 100.
 */
export default function ReturnsPage() {
  const [skip, setSkip] = useState(0);
  const [status, setStatus, ready] = useUrlFilter('status');
  const returns = useApi<ReturnRow[]>(ready ? `/returns${qs({ status, take: 100, skip })}` : null);
  const canOrders = useCan('order:read');
  const orderIds = [...new Set((returns.data ?? []).map((r) => r.orderId))];
  const labels = useApi<{ orders: Record<string, string> }>(canOrders && orderIds.length ? `/admin/lookup/labels${qs({ orderIds: orderIds.join(',') })}` : null);

  return (
    <div>
      <PageHeader
        title="Returns"
        breadcrumbs={[{ label: 'Post-purchase' }, { label: 'Returns' }]}
        description="Returns are started from an order. Receive, QC and disposition them here; refunds follow from a QC pass."
      />
      <div className="filter-bar">
        <SelectField
          label="Status"
          value={status}
          placeholder="Open work (requested to received)"
          options={STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ').toLowerCase() }))}
          onChange={(value) => { setSkip(0); setStatus(value); }}
        />
      </div>
      <DataState state={returns}>
        {(rows) => (
          <>
            <DataTable
              caption="Returns"
              rows={rows}
              rowKey={(r) => r.id}
              empty="No returns in this view."
              columns={[
                {
                  header: 'Return',
                  cell: (r) => (
                    <Link href={`/dashboard/returns/${r.id}`}>
                      <Ident>{r.returnNumber}</Ident>
                    </Link>
                  ),
                },
                {
                  header: 'Order',
                  cell: (r) =>
                    canOrders ? (
                      <Link href={`/dashboard/orders/${r.orderId}`}>
                        <Ident>{labels.data?.orders[r.orderId] ?? '…'}</Ident>
                      </Link>
                    ) : (
                      '—'
                    ),
                },
                { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                { header: 'Method', cell: (r) => (r.method === 'PICKUP' ? 'Carrier pickup' : 'Drop-off') },
                { header: 'Lines', numeric: true, cell: (r) => r.lines.length },
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
