'use client';

import { useState } from 'react';
import { LocationSelect, SkuPicker, type SkuOption } from '@/components/pickers';
import { useSkuLocationFromUrl, type Balance } from '@/components/sku-location';
import { DataState, Notice, PageHeader, Section } from '@/components/ui';
import { qs } from '@/lib/api';
import { useApi } from '@/lib/session';

interface Reconciliation {
  matches: boolean;
  status: 'MATCH' | 'MISMATCH' | 'UNVERIFIABLE';
  unverifiableAdjustments: number;
  stored: Balance;
  replayed: Balance;
}

const VERDICT: Record<Reconciliation['status'], { kind: 'success' | 'error' | 'warning'; text: (r: Reconciliation) => string }> = {
  MATCH: { kind: 'success', text: () => 'The stored balance matches the ledger replay.' },
  MISMATCH: { kind: 'error', text: () => 'Mismatch: the stored balance differs from the ledger replay. Escalate for investigation.' },
  UNVERIFIABLE: {
    kind: 'warning',
    text: (r) =>
      `Cannot be verified: ${r.unverifiableAdjustments} older adjustment${r.unverifiableAdjustments === 1 ? '' : 's'} recorded before adjustments carried a direction, with no audit evidence of which way ${r.unverifiableAdjustments === 1 ? 'it' : 'they'} went.`,
  },
};

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
 * ledger, adjustments included (P1 decision D-4). The verdict is the
 * service's; this screen only shows it.
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
              <Notice kind={VERDICT[r.status].kind}>
                <span data-testid="reconcile-status">{VERDICT[r.status].text(r)}</span>
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
            </Section>
          )}
        </DataState>
      )}
    </div>
  );
}
