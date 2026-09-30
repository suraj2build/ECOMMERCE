'use client';

import Link from 'next/link';
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
 * lists open warehouse work, oldest first, capped at 100.
 */
export default function ReturnsPage() {
  const [status, setStatus, ready] = useUrlFilter('status');
  const returns = useApi<ReturnRow[]>(ready ? `/returns${qs({ status })}` : null);
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
          onChange={setStatus}
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
            {rows.length === 100 && <p className="muted">Showing the first 100 (the return service caps this queue). Filter by status to narrow it.</p>}
          </>
        )}
      </DataState>
    </div>
  );
}
