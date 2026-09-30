'use client';

import { useEffect } from 'react';
import { apiFetch, qs } from '@/lib/api';
import { useApi } from '@/lib/session';
import type { SkuOption } from './pickers';
import { DataState } from './ui';

/**
 * Pre-selects a SKU and location from `?sku=CODE&locationId=...` (links
 * from the stock list), resolving the code through the SKU lookup.
 */
export function useSkuLocationFromUrl(setSku: (s: SkuOption) => void, setLocationId: (id: string) => void) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loc = params.get('locationId');
    if (loc) setLocationId(loc);
    const code = params.get('sku');
    if (code) {
      apiFetch<SkuOption[]>(`/admin/lookup/skus${qs({ q: code })}`)
        .then((rows) => {
          const exact = rows.find((r) => r.skuCode === code);
          if (exact) setSku(exact);
        })
        .catch(() => undefined);
    }
    // Runs once on mount; the setters are stable state setters.
  }, [setSku, setLocationId]);
}

export interface Balance {
  onHand: number;
  reserved: number;
  damaged: number;
  returnPending: number;
  inTransit: number;
  available: number;
}

/** GET /inventory/balance for one SKU at one location, shown as the inventory service reports it. */
export function BalanceCard({ skuId, locationId, version, title = 'Current balance' }: { skuId: string; locationId: string; version: number; title?: string }) {
  const balance = useApi<Balance>(`/inventory/balance${qs({ skuId, locationId })}`);
  const { reload } = balance;
  // `version` changes after a successful mutation; re-read the balance then.
  useEffect(() => {
    if (version > 0) reload();
  }, [version, reload]);
  return (
    <section className="card" aria-label={title} aria-live="polite">
      <h2>{title}</h2>
      <DataState state={balance}>
        {(b) => (
          <dl className="dl">
            <dt>On hand</dt>
            <dd data-testid="balance-onhand">{b.onHand}</dd>
            <dt>Reserved</dt>
            <dd>{b.reserved}</dd>
            <dt>Available</dt>
            <dd data-testid="balance-available">
              <strong>{b.available}</strong>
            </dd>
            <dt>Damaged</dt>
            <dd>{b.damaged}</dd>
            <dt>Return pending</dt>
            <dd>{b.returnPending}</dd>
            <dt>In transit</dt>
            <dd>{b.inTransit}</dd>
          </dl>
        )}
      </DataState>
    </section>
  );
}
