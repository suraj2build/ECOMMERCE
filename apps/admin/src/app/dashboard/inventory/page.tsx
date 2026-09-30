'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LocationSelect } from '@/components/pickers';
import { Can, DataState, DataTable, DateText, Ident, PageHeader, Pagination, TextField } from '@/components/ui';
import { qs, type Page } from '@/lib/api';
import { useApi, useDebounced, useUrlFilter } from '@/lib/session';

interface StockRow {
  skuId: string;
  locationId: string;
  sku: { id: string; skuCode: string; style: { id: string; styleCode: string; name: string }; colour: { name: string }; size: { label: string } };
  location: { id: string; code: string; name: string };
  onHand: number;
  reserved: number;
  damaged: number;
  returnPending: number;
  inTransit: number;
  available: number;
  updatedAt: string;
}

const TAKE = 50;

/**
 * Stock positions from the inventory ledger's balance rows. "Available"
 * is the inventory service's own figure (on hand minus reserved) as
 * returned by the API - the console does not derive it.
 */
export default function StockPage() {
  const [q, setQ] = useUrlFilter('q');
  const [locationId, setLocationId, ready] = useUrlFilter('locationId');
  const [skip, setSkip] = useState(0);
  const term = useDebounced(q);
  const stock = useApi<Page<StockRow>>(ready ? `/admin/inventory/stock${qs({ q: term, locationId, take: TAKE, skip })}` : null);

  return (
    <div>
      <PageHeader
        title="Stock"
        description="On-hand, reserved, available and non-sellable quantities per SKU and location."
        breadcrumbs={[{ label: 'Inventory' }, { label: 'Stock' }]}
        actions={
          <Can anyOf={['inventory:adjust']}>
            <Link href="/dashboard/inventory-adjustments" className="btn">
              New adjustment
            </Link>
          </Can>
        }
      />
      <div className="filter-bar" role="search">
        <TextField
          label="Search"
          value={q}
          placeholder="SKU code, style code or name"
          onChange={(v) => {
            setQ(v);
            setSkip(0);
          }}
        />
        <LocationSelect
          value={locationId}
          allowAny="All locations"
          onChange={(v) => {
            setLocationId(v);
            setSkip(0);
          }}
        />
      </div>
      <DataState state={stock}>
        {(data) => (
          <>
            <DataTable
              caption="Stock positions"
              rows={data.items}
              rowKey={(r) => `${r.skuId}/${r.locationId}`}
              empty="No stock positions match."
              columns={[
                { header: 'SKU', cell: (r) => <Ident>{r.sku.skuCode}</Ident> },
                {
                  header: 'Item',
                  cell: (r) => (
                    <Link href={`/dashboard/products/${r.sku.style.id}`}>
                      {r.sku.style.name} · {r.sku.colour.name} · {r.sku.size.label}
                    </Link>
                  ),
                },
                { header: 'Location', cell: (r) => r.location.name },
                { header: 'On hand', numeric: true, cell: (r) => r.onHand },
                { header: 'Reserved', numeric: true, cell: (r) => r.reserved },
                { header: 'Available', numeric: true, cell: (r) => <strong>{r.available}</strong> },
                { header: 'Damaged', numeric: true, cell: (r) => r.damaged },
                { header: 'Return pending', numeric: true, cell: (r) => r.returnPending },
                { header: 'In transit', numeric: true, cell: (r) => r.inTransit },
                { header: 'Updated', cell: (r) => <DateText value={r.updatedAt} withTime /> },
                {
                  header: 'Actions',
                  cell: (r) => (
                    <span className="row">
                      <Can anyOf={['inventory:adjust']}>
                        <Link className="btn small" href={`/dashboard/inventory-adjustments${qs({ sku: r.sku.skuCode, locationId: r.locationId })}`}>
                          Adjust
                        </Link>
                      </Can>
                      <Link className="btn small" href={`/dashboard/inventory/reconcile${qs({ sku: r.sku.skuCode, locationId: r.locationId })}`}>
                        Reconcile
                      </Link>
                    </span>
                  ),
                },
              ]}
            />
            <Pagination total={data.total} take={TAKE} skip={skip} onChange={setSkip} />
          </>
        )}
      </DataState>
    </div>
  );
}
