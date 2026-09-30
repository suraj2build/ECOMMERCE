'use client';

import { useState } from 'react';
import { LocationSelect, SkuPicker, type SkuOption } from '@/components/pickers';
import { useSkuLocationFromUrl, type Balance } from '@/components/sku-location';
import { DataState, Notice, PageHeader, Section } from '@/components/ui';
import { qs } from '@/lib/api';
import { useApi } from '@/lib/session';

interface Reconciliation {
  matches: boolean;
  stored: Balance;
  replayed: Balance;
}

const FIELDS: Array<[keyof Balance, string]> = [
  ['onHand', 'On hand'],
  ['reserved', 'Reserved'],
  ['available', 'Available'],
  ['damaged', 'Damaged'],
  ['returnPending', 'Return pending'],
  ['inTransit', 'In transit'],
];

/**
 * Ledger reconciliation (GET /inventory/reconcile): the stored balance
 * next to the balance the inventory service rebuilds by replaying the
 * ledger. The match verdict and its rules (e.g. how manual adjustments
 * are treated) are the service's; this screen only shows them.
 */
export default function ReconcilePage() {
  const [sku, setSku] = useState<SkuOption | null>(null);
  const [locationId, setLocationId] = useState('');
  useSkuLocationFromUrl(setSku, setLocationId);
  const result = useApi<Reconciliation>(sku && locationId ? `/inventory/reconcile${qs({ skuId: sku.id, locationId })}` : null);

  return (
    <div>
      <PageHeader
        title="Ledger reconciliation"
        description="Compare a stored balance with a replay of its inventory ledger."
        breadcrumbs={[{ label: 'Inventory' }, { label: 'Reconciliation' }]}
      />
      <Section title="Balance to check">
        <div className="form-row">
          <SkuPicker value={sku} onChange={setSku} />
          <LocationSelect value={locationId} onChange={setLocationId} />
        </div>
      </Section>
      {sku && locationId && (
        <DataState state={result}>
          {(r) => (
            <Section title={`Result for ${sku.skuCode}`}>
              <Notice kind={r.matches ? 'success' : 'error'}>
                {r.matches ? 'The stored balance matches the ledger replay.' : 'Mismatch: the stored balance differs from the ledger replay. Escalate for investigation.'}
              </Notice>
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Stored and replayed balance</caption>
                  <thead>
                    <tr>
                      <th scope="col">Measure</th>
                      <th scope="col" className="num">
                        Stored
                      </th>
                      <th scope="col" className="num">
                        Ledger replay
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {FIELDS.map(([k, label]) => (
                      <tr key={k}>
                        <th scope="row">{label}</th>
                        <td className="num">{r.stored[k]}</td>
                        <td className="num">{r.replayed[k]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted">
                Manual adjustments are recorded without a sign on the ledger row, so the service excludes them from the replay and reports a
                match whenever any exist (P1 decision D-4).
              </p>
            </Section>
          )}
        </DataState>
      )}
    </div>
  );
}
