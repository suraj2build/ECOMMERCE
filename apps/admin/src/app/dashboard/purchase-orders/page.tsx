'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PO_STATUSES, PoTable, type PoRow } from '@/components/po-table';
import { Can, DataState, PageHeader, Pagination, SelectField, TextField } from '@/components/ui';
import { qs, type Page } from '@/lib/api';
import { useApi, useDebounced, useUrlFilter } from '@/lib/session';

const TAKE = 25;

export default function PurchaseOrdersPage() {
  const [q, setQ] = useUrlFilter('q');
  const [status, setStatus, ready] = useUrlFilter('status');
  const [skip, setSkip] = useState(0);
  const term = useDebounced(q);
  const pos = useApi<Page<PoRow>>(ready ? `/admin/purchase-orders${qs({ q: term, status, take: TAKE, skip })}` : null);

  return (
    <div>
      <PageHeader
        title="Purchase orders"
        breadcrumbs={[{ label: 'Procurement' }, { label: 'Purchase orders' }]}
        actions={
          <Can anyOf={['po:create']}>
            <Link href="/dashboard/purchase-orders/new" className="btn primary">
              New purchase order
            </Link>
          </Can>
        }
      />
      <div className="filter-bar" role="search">
        <TextField
          label="Search"
          value={q}
          placeholder="PO number or supplier"
          onChange={(v) => {
            setQ(v);
            setSkip(0);
          }}
        />
        <SelectField
          label="Status"
          value={status}
          placeholder="All statuses"
          options={PO_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ').toLowerCase() }))}
          onChange={(v) => {
            setStatus(v);
            setSkip(0);
          }}
        />
      </div>
      <DataState state={pos}>
        {(data) => (
          <>
            <PoTable rows={data.items} />
            <Pagination total={data.total} take={TAKE} skip={skip} onChange={setSkip} />
          </>
        )}
      </DataState>
    </div>
  );
}
