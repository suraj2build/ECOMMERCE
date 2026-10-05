'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ActionMessage, Can, DataState, DateText, Notice, PageHeader, Section, TextField } from '@/components/ui';
import { apiSend } from '@/lib/api';
import { useAction, useApi } from '@/lib/session';

interface AwaitingShipment {
  id: string;
  provider: string;
  trackingRef: string | null;
  bookedAt: string | null;
  reference: string;
  fulfilmentId: string;
  units: number;
  parcelWeightGrams: number | null;
}

/**
 * Handover manifest (AO-D5): parcels booked with a courier but not yet
 * handed over, grouped by courier. Print it for the courier to sign, then
 * confirm the handover. Handover is recorded separately from booking; the
 * stock sale is still posted at booking until the consequences review of
 * moving it is done (docs/admin/DISPATCH.md).
 */
export default function HandoverPage() {
  const data = useApi<{ total: number; limit: number; shipments: AwaitingShipment[] }>('/shipments/handover');
  const action = useAction();
  const [selected, setSelected] = useState<string[]>([]);
  const [reference, setReference] = useState('');
  const groups = useMemo(() => {
    const map = new Map<string, AwaitingShipment[]>();
    for (const s of data.data?.shipments ?? []) map.set(s.provider, [...(map.get(s.provider) ?? []), s]);
    return [...map.entries()];
  }, [data.data]);

  return (
    <div className="print-doc">
      <div className="no-print">
        <PageHeader
          title="Courier handover"
          breadcrumbs={[{ label: 'Orders' }, { label: 'Pack & ship', href: '/dashboard/fulfilments' }, { label: 'Courier handover' }]}
          description="Parcels booked with a courier and waiting to be collected. Print the manifest for the courier, then confirm what they took."
          actions={
            <button type="button" className="btn" onClick={() => window.print()}>
              Print manifest
            </button>
          }
        />
        <ActionMessage message={action.message} />
      </div>
      <DataState state={data}>
        {(d) =>
          groups.length === 0 ? (
            <p>No parcels are waiting for a courier.</p>
          ) : (
            <>
              {d.total > d.shipments.length && (
                <Notice kind="warning">
                  {d.total} parcels are waiting; the oldest {d.shipments.length} are listed. Confirm these first and the rest will follow.
                </Notice>
              )}
              {groups.map(([provider, rows]) => (
                <Section key={provider} title={`Manifest: ${provider} (${rows.length} parcel${rows.length === 1 ? '' : 's'})`}>
                  <table>
                    <caption className="sr-only">Parcels for {provider}</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="no-print">
                          Handed over
                        </th>
                        <th scope="col">Order</th>
                        <th scope="col">Tracking</th>
                        <th scope="col" className="num">
                          Units
                        </th>
                        <th scope="col" className="num">
                          Weight (g)
                        </th>
                        <th scope="col">Booked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((s) => (
                        <tr key={s.id}>
                          <td className="no-print">
                            <input
                              type="checkbox"
                              aria-label={`Handed over: ${s.reference}`}
                              checked={selected.includes(s.id)}
                              onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
                            />
                          </td>
                          <td>
                            <Link href={`/dashboard/fulfilments/${s.fulfilmentId}/documents`}>{s.reference}</Link>
                          </td>
                          <td className="mono">{s.trackingRef ?? '—'}</td>
                          <td className="num">{s.units}</td>
                          <td className="num">{s.parcelWeightGrams ?? '—'}</td>
                          <td>
                            <DateText value={s.bookedAt} withTime />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="print-only">
                    Parcels: {rows.length} · Handed over by: ____________________ · Received for {provider} by: ____________________ · Date/time:
                    ______________
                  </p>
                </Section>
              ))}
              <Can anyOf={['shipping:manage']}>
                <form
                  className="no-print"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const ok = await action.run(
                      () => apiSend('POST', '/shipments/handover', { shipmentIds: selected, reference: reference.trim() || undefined }),
                      `${selected.length} parcel${selected.length === 1 ? '' : 's'} recorded as handed over.`,
                    );
                    if (ok) {
                      setSelected([]);
                      setReference('');
                      data.reload();
                    }
                  }}
                >
                  <TextField label="Courier's manifest or pickup reference (optional)" value={reference} onChange={setReference} />
                  <button className="primary" type="submit" disabled={action.busy || selected.length === 0}>
                    Confirm handover of {selected.length} parcel{selected.length === 1 ? '' : 's'}
                  </button>
                </form>
              </Can>
            </>
          )
        }
      </DataState>
    </div>
  );
}
