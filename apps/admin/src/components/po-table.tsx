'use client';

import Link from 'next/link';
import { DataTable, DateText, Ident, Money, StatusBadge } from './ui';

export interface PoRow {
  id: string;
  poNumber: string;
  status: string;
  totalCost: number;
  currency: string;
  expectedDate: string | null;
  createdAt: string;
  supplier: { id: string; code: string; name: string };
  location: { id: string; code: string; name: string };
  _count: { lines: number; goodsReceipts: number };
}

export const PO_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED', 'CANCELLED'];

export function PoTable({ rows }: { rows: PoRow[] }) {
  return (
    <DataTable
      caption="Purchase orders"
      rows={rows}
      rowKey={(r) => r.id}
      empty="No purchase orders match."
      columns={[
        {
          header: 'PO',
          cell: (r) => (
            <Link href={`/dashboard/purchase-orders/${r.id}`}>
              <Ident>{r.poNumber}</Ident>
            </Link>
          ),
        },
        { header: 'Supplier', cell: (r) => r.supplier.name },
        { header: 'Deliver to', cell: (r) => r.location.name },
        { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
        { header: 'Lines', numeric: true, cell: (r) => r._count.lines },
        { header: 'GRNs', numeric: true, cell: (r) => r._count.goodsReceipts },
        { header: 'Total', numeric: true, cell: (r) => <Money value={r.totalCost} currency={r.currency} /> },
        { header: 'Expected', cell: (r) => <DateText value={r.expectedDate} /> },
        { header: 'Created', cell: (r) => <DateText value={r.createdAt} /> },
      ]}
    />
  );
}

