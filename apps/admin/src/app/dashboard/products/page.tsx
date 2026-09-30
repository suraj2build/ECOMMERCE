'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Can, DataState, DataTable, DateText, Ident, PageHeader, Pagination, SelectField, StatusBadge, TextField } from '@/components/ui';
import { qs, type Page } from '@/lib/api';
import { useApi, useDebounced, useUrlFilter } from '@/lib/session';

interface StyleRow {
  id: string;
  styleCode: string;
  name: string;
  season: string;
  lifecycleState: string;
  updatedAt: string;
  brand: { name: string };
  category: { name: string };
  _count: { colours: number; skus: number; media: number };
}

const LIFECYCLE_STATES = ['DRAFT', 'READY_FOR_ENRICHMENT', 'READY_FOR_QA', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'];
const TAKE = 25;

export default function ProductsPage() {
  const [q, setQ] = useUrlFilter('q');
  const [state, setState, ready] = useUrlFilter('lifecycleState');
  const [skip, setSkip] = useState(0);
  const term = useDebounced(q);
  const styles = useApi<Page<StyleRow>>(ready ? `/admin/products/styles${qs({ q: term, lifecycleState: state, take: TAKE, skip })}` : null);

  return (
    <div>
      <PageHeader
        title="Products"
        description="Styles and their lifecycle. Open a style to manage colours, SKUs, media, pricing and publishing."
        breadcrumbs={[{ label: 'Merchandise' }, { label: 'Products' }]}
        actions={
          <Can anyOf={['product:write']}>
            <Link href="/dashboard/products/new" className="btn primary">
              New style
            </Link>
          </Can>
        }
      />
      <div className="filter-bar" role="search">
        <TextField
          label="Search"
          value={q}
          placeholder="Style code or name"
          onChange={(v) => {
            setQ(v);
            setSkip(0);
          }}
        />
        <SelectField
          label="Lifecycle"
          value={state}
          placeholder="All states"
          options={LIFECYCLE_STATES.map((s) => ({ value: s, label: s.replace(/_/g, ' ').toLowerCase() }))}
          onChange={(v) => {
            setState(v);
            setSkip(0);
          }}
        />
      </div>
      <DataState state={styles}>
        {(data) => (
          <>
            <DataTable
              caption="Styles"
              rows={data.items}
              rowKey={(r) => r.id}
              empty="No styles match these filters."
              columns={[
                {
                  header: 'Style',
                  cell: (r) => (
                    <Link href={`/dashboard/products/${r.id}`}>
                      <Ident>{r.styleCode}</Ident>
                    </Link>
                  ),
                },
                { header: 'Name', cell: (r) => r.name },
                { header: 'Brand', cell: (r) => r.brand.name },
                { header: 'Category', cell: (r) => r.category.name },
                { header: 'Season', cell: (r) => r.season },
                { header: 'State', cell: (r) => <StatusBadge status={r.lifecycleState} /> },
                { header: 'Colours', numeric: true, cell: (r) => r._count.colours },
                { header: 'SKUs', numeric: true, cell: (r) => r._count.skus },
                { header: 'Media', numeric: true, cell: (r) => r._count.media },
                { header: 'Updated', cell: (r) => <DateText value={r.updatedAt} /> },
              ]}
            />
            <Pagination total={data.total} take={TAKE} skip={skip} onChange={setSkip} />
          </>
        )}
      </DataState>
    </div>
  );
}
