'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DataState, DataTable, DateText, Ident, Money, PageHeader, Pagination, SelectField, StatusBadge, TextField, YesNo } from '@/components/ui';
import { qs, type Page } from '@/lib/api';
import { useApi, useDebounced, useUrlFilter } from '@/lib/session';

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  paymentMethod: string;
  grandTotal: number;
  currency: string;
  invoiceStatus: string;
  refundRequired: boolean;
  createdAt: string;
  _count: { lines: number };
}

const TAKE = 25;
const STATUSES = ['CONFIRMED', 'PROCESSING', 'DELIVERED', 'CANCELLED', 'RTO', 'EXCEPTION'];

export default function OrdersPage() {
  const [q, setQ] = useUrlFilter('q');
  const [status, setStatus] = useUrlFilter('status');
  const [invoiceStatus, setInvoiceStatus, ready] = useUrlFilter('invoiceStatus');
  const [skip, setSkip] = useState(0);
  const term = useDebounced(q);
  const orders = useApi<Page<OrderRow>>(ready ? `/admin/orders${qs({ q: term, status, invoiceStatus, take: TAKE, skip })}` : null);

  return (
    <div>
      <PageHeader title="Orders" breadcrumbs={[{ label: 'Orders' }, { label: 'Orders' }]} description="Search by order number. Open an order to fulfil, cancel lines or start a return." />
      <div className="filter-bar" role="search">
        <TextField
          label="Order number"
          value={q}
          placeholder="e.g. ORD-2026-000123"
          onChange={(v) => {
            setQ(v);
            setSkip(0);
          }}
        />
        <SelectField
          label="Status"
          value={status}
          placeholder="All statuses"
          options={STATUSES.map((s) => ({ value: s, label: s.toLowerCase() }))}
          onChange={(v) => {
            setStatus(v);
            setSkip(0);
          }}
        />
        <SelectField
          label="Invoice"
          value={invoiceStatus}
          placeholder="Any invoice status"
          options={['PENDING', 'ISSUED', 'FAILED'].map((s) => ({ value: s, label: s.toLowerCase() }))}
          onChange={(v) => {
            setInvoiceStatus(v);
            setSkip(0);
          }}
        />
      </div>
      <DataState state={orders}>
        {(data) => (
          <>
            <DataTable
              caption="Orders"
              rows={data.items}
              rowKey={(r) => r.id}
              empty="No orders match."
              columns={[
                {
                  header: 'Order',
                  cell: (r) => (
                    <Link href={`/dashboard/orders/${r.id}`}>
                      <Ident>{r.orderNumber}</Ident>
                    </Link>
                  ),
                },
                { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                { header: 'Payment', cell: (r) => r.paymentMethod },
                { header: 'Lines', numeric: true, cell: (r) => r._count.lines },
                { header: 'Total', numeric: true, cell: (r) => <Money value={r.grandTotal} currency={r.currency} /> },
                { header: 'Invoice', cell: (r) => <StatusBadge status={r.invoiceStatus} /> },
                { header: 'Refund required', cell: (r) => <YesNo value={r.refundRequired} /> },
                { header: 'Placed', cell: (r) => <DateText value={r.createdAt} withTime /> },
              ]}
            />
            <Pagination total={data.total} take={TAKE} skip={skip} onChange={setSkip} />
          </>
        )}
      </DataState>
    </div>
  );
}
