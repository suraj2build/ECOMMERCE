'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { DataState, DateText, Money, Notice } from '@/components/ui';
import { useApi } from '@/lib/session';

export interface DispatchAddress {
  name: string;
  mobile?: string | null;
  line1: string | null;
  line2?: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

export interface DispatchDocuments {
  fulfilmentId: string;
  status: string;
  reference: string;
  orderNumber: string;
  orderDate: string;
  shipTo: DispatchAddress;
  shipFrom: DispatchAddress | null;
  paymentMethod: string;
  cashToCollect: number | null;
  parcel: { weightGrams: number | null; lengthCm: number | null; widthCm: number | null; heightCm: number | null };
  lines: Array<{ skuCode: string; name: string; colour: string; size: string; quantity: number; barcode: string | null }>;
  shipment: { provider: string; trackingRef: string | null; bookedAt: string | null; handedOverAt: string | null; handoverReference: string | null } | null;
}

/** True when the sender address can be printed (line, city and PIN code). */
function hasAddress(a: DispatchAddress | null): boolean {
  return Boolean(a && a.line1 && a.city && a.pincode);
}

/** Shown on screen only: a document printed without a sender address has no return address. */
function MissingSenderAddress() {
  return (
    <div className="no-print">
      <Notice kind="warning">
        The warehouse address is not set up, so this document has no sender or return address. Add it in{' '}
        <Link href="/dashboard/business">Business &amp; warehouse</Link> before printing.
      </Notice>
    </div>
  );
}

function Address({ a }: { a: DispatchAddress }) {
  return (
    <address style={{ fontStyle: 'normal' }}>
      <strong>{a.name}</strong>
      <br />
      {a.line1}
      {a.line2 && (
        <>
          <br />
          {a.line2}
        </>
      )}
      <br />
      {[a.city, a.state].filter(Boolean).join(', ')} {a.pincode}
      {a.mobile && (
        <>
          <br />
          Phone: {a.mobile}
        </>
      )}
    </address>
  );
}

/**
 * Printable dispatch documents for one package (AO-D5 work). The packing
 * slip lists what goes in the parcel; the address label carries the
 * addresses and references. Neither is a courier's own shipping label:
 * those come from the carrier once one is chosen (LR-008). Uses the
 * browser's print dialog; the admin's navigation is hidden when printing.
 */
export default function DispatchDocumentsPage() {
  const { id } = useParams<{ id: string }>();
  const doc = useSearchParams().get('doc') === 'label' ? 'label' : 'slip';
  const data = useApi<DispatchDocuments>(`/orders/fulfilments/${id}/documents`);
  return (
    <div className="print-doc">
      <div className="no-print row" style={{ marginBottom: '1rem' }}>
        <Link className="btn" href={`/dashboard/fulfilments/${id}/documents?doc=slip`} aria-current={doc === 'slip' ? 'page' : undefined}>
          Packing slip
        </Link>
        <Link className="btn" href={`/dashboard/fulfilments/${id}/documents?doc=label`} aria-current={doc === 'label' ? 'page' : undefined}>
          Address label
        </Link>
        <button type="button" className="primary" onClick={() => window.print()}>
          Print
        </button>
        <Link href="/dashboard/fulfilments">Back to Pack &amp; ship</Link>
      </div>
      <DataState state={data}>
        {(d) =>
          doc === 'slip' ? (
            <article aria-label="Packing slip">
              {!hasAddress(d.shipFrom) && <MissingSenderAddress />}
              <h1>Packing slip</h1>
              <p>
                Order <strong className="mono">{d.reference}</strong> · placed <DateText value={d.orderDate} />
              </p>
              <div className="grid-2">
                <section>
                  <h2>Ship to</h2>
                  <Address a={d.shipTo} />
                </section>
                {d.shipFrom && (
                  <section>
                    <h2>From</h2>
                    <Address a={d.shipFrom} />
                  </section>
                )}
              </div>
              <table>
                <caption className="sr-only">Items in this parcel</caption>
                <thead>
                  <tr>
                    <th scope="col">SKU</th>
                    <th scope="col">Item</th>
                    <th scope="col">Barcode</th>
                    <th scope="col" className="num">
                      Qty
                    </th>
                    <th scope="col">Packed</th>
                  </tr>
                </thead>
                <tbody>
                  {d.lines.map((l, i) => (
                    <tr key={`${l.skuCode}-${i}`}>
                      <td className="mono">{l.skuCode}</td>
                      <td>
                        {l.name} · {l.colour} · {l.size}
                      </td>
                      <td className="mono">{l.barcode ?? '—'}</td>
                      <td className="num">{l.quantity}</td>
                      <td aria-label="Tick when packed">☐</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                Units: <strong>{d.lines.reduce((s, l) => s + l.quantity, 0)}</strong>
                {d.parcel.weightGrams !== null && <> · Parcel weight {d.parcel.weightGrams} g</>}
                {d.parcel.lengthCm !== null && (
                  <>
                    {' '}
                    · {d.parcel.lengthCm} × {d.parcel.widthCm} × {d.parcel.heightCm} cm
                  </>
                )}
              </p>
            </article>
          ) : (
            <article aria-label="Address label" className="address-label">
              <section>
                <h2>Deliver to</h2>
                <Address a={d.shipTo} />
              </section>
              <p>
                Order <strong className="mono">{d.reference}</strong>
                {d.shipment?.trackingRef && (
                  <>
                    {' '}
                    · {d.shipment.provider} tracking <strong className="mono">{d.shipment.trackingRef}</strong>
                  </>
                )}
              </p>
              <p>
                {d.paymentMethod === 'COD' ? (
                  <>
                    Cash on delivery{d.cashToCollect !== null && <> · collect <Money value={d.cashToCollect} /></>}
                  </>
                ) : d.paymentMethod === 'EXCHANGE' ? (
                  'Exchange replacement · nothing to collect'
                ) : (
                  'Prepaid'
                )}
                {d.parcel.weightGrams !== null && <> · {d.parcel.weightGrams} g</>}
              </p>
              {d.shipFrom && (
                <section>
                  <h2>If undelivered, return to</h2>
                  <Address a={d.shipFrom} />
                </section>
              )}
              {!hasAddress(d.shipFrom) && <MissingSenderAddress />}
              {!d.shipment && <Notice kind="info">Not booked with a courier yet; the tracking reference appears here after booking.</Notice>}
            </article>
          )
        }
      </DataState>
    </div>
  );
}
