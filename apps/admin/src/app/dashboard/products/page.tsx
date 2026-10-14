'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Can, DataState, DataTable, DateText, Ident, PageHeader, Pagination, SelectField, StatusBadge, TextField } from '@/components/ui';
import { qs, type Page } from '@/lib/api';
import { displayImageUrl } from '@/lib/media';
import { useApi, useDebounced, useUrlFilter } from '@/lib/session';
import type { ReferenceData } from '@/components/product-workspace/types';

interface StyleRow {
  id: string;
  styleCode: string;
  name: string;
  season: string;
  gender: string | null;
  lifecycleState: string;
  updatedAt: string;
  brand: { name: string };
  category: { name: string };
  media: Array<{ url: string }>;
  _count: { colours: number; skus: number; media: number };
}

const STATES: Array<[string, string]> = [
  ['DRAFT', 'Draft'],
  ['READY_FOR_ENRICHMENT', 'Being prepared'],
  ['READY_FOR_QA', 'Checked, not published'],
  ['PUBLISHED', 'Published'],
  ['UNPUBLISHED', 'Unpublished'],
  ['ARCHIVED', 'Archived'],
];
const TAKE = 25;

export default function ProductsPage() {
  const [q, setQ] = useUrlFilter('q');
  const [state, setState, ready] = useUrlFilter('lifecycleState');
  const [categoryId, setCategoryId] = useUrlFilter('categoryId');
  const [gender, setGender] = useUrlFilter('gender');
  const [skip, setSkip] = useState(0);
  const term = useDebounced(q);
  const reference = useApi<ReferenceData>('/products/reference');
  const styles = useApi<Page<StyleRow>>(ready ? `/admin/products/styles${qs({ q: term, lifecycleState: state, categoryId, gender, take: TAKE, skip })}` : null);
  const reset = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setSkip(0);
  };

  return (
    <div>
      <PageHeader
        title="Products"
        description="Open a product to continue where you left off: basics, colours and sizes, photos, pricing, readiness and publishing."
        breadcrumbs={[{ label: 'Merchandise' }, { label: 'Products' }]}
        actions={
          <Can anyOf={['product:write']}>
            <Link href="/dashboard/products/import" className="btn">
              Import from a spreadsheet
            </Link>
            <Link href="/dashboard/products/new" className="btn primary">
              New product
            </Link>
          </Can>
        }
      />
      <div className="filter-bar" role="search">
        <TextField label="Search" value={q} placeholder="Style code or name" onChange={reset(setQ)} />
        <SelectField
          label="Category"
          value={categoryId}
          placeholder="All categories"
          options={(reference.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))}
          onChange={reset(setCategoryId)}
        />
        <SelectField
          label="Department"
          value={gender}
          placeholder="Men and Women"
          options={[
            { value: 'Men', label: 'Men' },
            { value: 'Women', label: 'Women' },
          ]}
          onChange={reset(setGender)}
        />
        <SelectField label="Status" value={state} placeholder="Any status" options={STATES.map(([value, label]) => ({ value, label }))} onChange={reset(setState)} />
      </div>
      <DataState state={styles}>
        {(data) => (
          <>
            <DataTable
              caption="Products"
              rows={data.items}
              rowKey={(r) => r.id}
              empty={
                <>
                  No products match these filters. <Link href="/dashboard/products/new">Add a product</Link> or <Link href="/dashboard/products/import">import a spreadsheet</Link>.
                </>
              }
              columns={[
                {
                  header: 'Photo',
                  cell: (r) => {
                    const src = displayImageUrl(r.media[0]?.url);
                    return src ? (
                      <img className="thumb" src={src} alt="" loading="lazy" />
                    ) : (
                      <span className="thumb empty" aria-label="No photo" />
                    );
                  },
                },
                {
                  header: 'Product',
                  cell: (r) => (
                    <Link href={`/dashboard/products/${r.id}`}>
                      {r.name}
                      <br />
                      <Ident>{r.styleCode}</Ident>
                    </Link>
                  ),
                },
                { header: 'Category', cell: (r) => r.category.name },
                { header: 'Department', cell: (r) => r.gender ?? '—' },
                { header: 'Status', cell: (r) => <StatusBadge status={r.lifecycleState} /> },
                { header: 'Colours', numeric: true, cell: (r) => r._count.colours },
                { header: 'Sizes (SKUs)', numeric: true, cell: (r) => r._count.skus },
                { header: 'Photos', numeric: true, cell: (r) => r._count.media },
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
