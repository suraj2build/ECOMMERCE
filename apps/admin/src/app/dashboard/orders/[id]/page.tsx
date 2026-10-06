'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { FulfilmentActions } from '@/components/fulfilment-actions';
import { SkuPicker, type SkuOption } from '@/components/pickers';
import {
  ActionMessage,
  Can,
  Checkbox,
  ConfirmDialog,
  DataState,
  DataTable,
  DateText,
  Ident,
  Money,
  Notice,
  PageHeader,
  Section,
  SelectField,
  StatusBadge,
  TextArea,
  TextField,
} from '@/components/ui';
import { apiSend, newIdempotencyKey } from '@/lib/api';
import { useAction, useApi, useCan } from '@/lib/session';

interface OrderLine {
  id: string;
  skuId: string;
  styleId: string;
  styleName: string;
  colourName: string;
  sizeLabel: string;
  quantity: number;
  unitPriceInclusive: number;
  lineTotalInclusive: number;
  status: string;
  fulfilmentId: string | null;
  cancelledReason: string | null;
  exceptionReason: string | null;
  pickTask: { id: string; status: string; pickedQuantity: number | null; exceptionType: string | null } | null;
}

interface Fulfilment {
  id: string;
  status: string;
  /** Booked with a courier vs actually collected (AO-D5). */
  dispatchStage?: string;
  carrierName: string | null;
  trackingRef: string | null;
  packedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  shipment: {
    id: string;
    provider: string;
    trackingRef: string | null;
    status: string;
    deliveryAttempts: number;
    maxDeliveryAttempts: number;
    bookedAt: string | null;
    deliveredAt: string | null;
  } | null;
}

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  paymentMethod: string;
  refundRequired: boolean;
  contactName: string;
  contactMobile: string;
  shippingAddress: { line1?: string; line2?: string; city?: string; state?: string; pincode?: string };
  shippingCost: number;
  subtotal: number;
  taxAmount: number;
  grandTotal: number;
  currency: string;
  invoiceStatus: string;
  invoiceFailureReason: string | null;
  invoiceAttempts: number;
  codCollection: { amount: number; collectedAt: string } | null;
  lines: OrderLine[];
  fulfilments: Fulfilment[];
  createdAt: string;
}

type LineDialog =
  | { kind: 'cancel'; line: OrderLine }
  | { kind: 'exception'; line: OrderLine }
  | { kind: 'resolve'; line: OrderLine }
  | { kind: 'refund'; line: OrderLine }
  | { kind: 'exchange'; line: OrderLine };

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const order = useApi<Order>(`/orders/${id}`);
  const canReturns = useCan('return:read');
  const canExchanges = useCan('exchange:read');
  const canRefunds = useCan('payment:refund');
  const canCollectCod = useCan('payment:cod:collect');
  const returns = useApi<Array<{ id: string; returnNumber: string; status: string; method: string; createdAt: string }>>(canReturns ? `/orders/${id}/returns` : null);
  const exchanges = useApi<Array<{ id: string; exchangeNumber: string; status: string; createdAt: string }>>(canExchanges ? `/orders/${id}/exchanges` : null);
  const refunds = useApi<Array<{ id: string; orderLineId: string; method: string; status: string; amount: string; failureReason: string | null; createdAt: string }>>(
    canRefunds ? `/orders/${id}/refunds` : null,
  );

  const action = useAction();
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<LineDialog | null>(null);
  const [orderDialog, setOrderDialog] = useState<'rto' | 'invoice' | 'fulfil' | 'return' | 'cod' | null>(null);
  const [reason, setReason] = useState('');
  const [resolution, setResolution] = useState('REINSTATE');
  const [method, setMethod] = useState('DROP_OFF');
  const [replacement, setReplacement] = useState<SkuOption | null>(null);
  const [key, setKey] = useState('');
  const [codAmount, setCodAmount] = useState('');
  const [codReference, setCodReference] = useState('');

  const reloadAll = () => {
    order.reload();
    returns.reload();
    exchanges.reload();
    refunds.reload();
  };

  function openLine(d: LineDialog) {
    setReason('');
    setReplacement(null);
    setKey(newIdempotencyKey(d.kind));
    action.clear();
    setDialog(d);
  }

  function openOrder(d: 'rto' | 'invoice' | 'fulfil' | 'return' | 'cod') {
    setReason('');
    setKey(newIdempotencyKey(d));
    action.clear();
    setOrderDialog(d);
  }

  async function submitLine(d: LineDialog) {
    const o = order.data!;
    const calls: Record<LineDialog['kind'], () => Promise<unknown>> = {
      cancel: () => apiSend('POST', `/orders/${o.id}/lines/${d.line.id}/cancel`, { reason: reason || undefined, idempotencyKey: key }),
      exception: () => apiSend('POST', `/orders/${o.id}/lines/${d.line.id}/exception`, { reason }),
      resolve: () => apiSend('POST', `/orders/${o.id}/lines/${d.line.id}/exception/resolve`, { resolution, reason }),
      refund: () => apiSend('POST', '/refunds', { orderId: o.id, orderLineId: d.line.id, idempotencyKey: key }),
      exchange: () =>
        apiSend('POST', '/exchanges', { orderId: o.id, orderLineId: d.line.id, replacementSkuId: replacement?.id, reason, method, idempotencyKey: key }),
    };
    const labels: Record<LineDialog['kind'], string> = {
      cancel: 'Line cancelled.',
      exception: 'Exception flagged.',
      resolve: 'Exception resolved.',
      refund: 'Refund processed - see its status below.',
      exchange: 'Exchange requested.',
    };
    const ok = await action.run(calls[d.kind], labels[d.kind]);
    if (ok) {
      setDialog(null);
      reloadAll();
    }
  }

  async function submitOrder(d: 'rto' | 'invoice' | 'fulfil' | 'return' | 'cod') {
    const o = order.data!;
    const calls = {
      cod: () => apiSend('POST', `/orders/${o.id}/cod-collection`, { amount: Number(codAmount), reference: codReference.trim() }),
      rto: () => apiSend('POST', `/orders/${o.id}/rto`, { reason }),
      invoice: () => apiSend('POST', `/orders/${o.id}/retry-invoice`),
      fulfil: () => apiSend('POST', `/orders/${o.id}/fulfilments`, { lineIds: selected }),
      return: () =>
        apiSend('POST', '/returns', { orderId: o.id, lines: selected.map((orderLineId) => ({ orderLineId, reason })), method, idempotencyKey: key }),
    };
    const labels = { cod: 'COD collection recorded; the order is now reported as a purchase.', rto: 'Marked return-to-origin.', invoice: 'Invoice retried.', fulfil: 'Fulfilment created.', return: 'Return requested.' };
    const ok = await action.run(calls[d], labels[d]);
    if (ok) {
      setOrderDialog(null);
      setSelected([]);
      reloadAll();
    }
  }

  // AO-D5 option B: a line in a package booked with the courier is cancelled
  // with its whole package (Cancel booking on Pack & ship), not on its own.
  const inBookedPackage = (l: OrderLine) => Boolean(l.fulfilmentId && order.data?.fulfilments.some((f) => f.id === l.fulfilmentId && f.status === 'BOOKED'));

  return (
    <DataState state={order}>
      {(o) => (
        <div>
          <PageHeader
            title={`Order ${o.orderNumber}`}
            description={
              <>
                <StatusBadge status={o.status} /> {o.paymentMethod} · placed <DateText value={o.createdAt} withTime />
              </>
            }
            breadcrumbs={[{ label: 'Orders' }, { label: 'Orders', href: '/dashboard/orders' }, { label: o.orderNumber }]}
            actions={
              <>
                {/* RTO applies once every active line has shipped (the server's rule). */}
                {o.status !== 'RTO' && o.lines.some((l) => l.status === 'SHIPPED') && o.lines.every((l) => l.status === 'SHIPPED' || l.status === 'CANCELLED') && (
                  <Can anyOf={['order:rto']}>
                    <button type="button" className="btn danger" onClick={() => openOrder('rto')}>
                      Mark RTO
                    </button>
                  </Can>
                )}
                {o.invoiceStatus === 'FAILED' && (
                  <Can anyOf={['invoice:create']}>
                    <button type="button" className="btn" onClick={() => openOrder('invoice')}>
                      Retry invoice
                    </button>
                  </Can>
                )}
              </>
            }
          />
          <ActionMessage message={dialog || orderDialog ? null : action.message} />
          {o.refundRequired && <Notice kind="warning">This order has a refund outstanding (a cancelled or returned prepaid line).</Notice>}
          {o.invoiceStatus === 'FAILED' && (
            <Notice kind="error">
              Invoice generation failed after {o.invoiceAttempts} attempt(s): {o.invoiceFailureReason ?? 'no reason recorded'}
            </Notice>
          )}

          <div className="grid-2">
            <Section title="Customer and delivery">
              <dl className="dl">
                <dt>Contact</dt>
                <dd>{o.contactName}</dd>
                <dt>Mobile</dt>
                <dd>{o.contactMobile}</dd>
                <dt>Ship to</dt>
                <dd>{[o.shippingAddress.line1, o.shippingAddress.line2, o.shippingAddress.city, o.shippingAddress.state, o.shippingAddress.pincode].filter(Boolean).join(', ')}</dd>
              </dl>
            </Section>
            <Section title="Totals">
              <dl className="dl">
                <dt>Subtotal</dt>
                <dd>
                  <Money value={o.subtotal} />
                </dd>
                <dt>Tax</dt>
                <dd>
                  <Money value={o.taxAmount} />
                </dd>
                <dt>Shipping</dt>
                <dd>
                  <Money value={o.shippingCost} />
                </dd>
                <dt>Grand total</dt>
                <dd>
                  <strong>
                    <Money value={o.grandTotal} currency={o.currency} />
                  </strong>
                </dd>
                <dt>Invoice</dt>
                <dd>
                  <StatusBadge status={o.invoiceStatus} />
                </dd>
                {o.paymentMethod === 'COD' && (
                  <>
                    <dt>COD collection</dt>
                    <dd>
                      {o.codCollection ? (
                        <>
                          <Money value={o.codCollection.amount} /> collected <DateText value={o.codCollection.collectedAt} />
                        </>
                      ) : o.lines.some((l) => l.status === 'DELIVERED') && o.lines.every((l) => l.status === 'DELIVERED' || l.status === 'CANCELLED') ? (
                        canCollectCod ? (
                          <button
                            type="button"
                            className="btn small"
                            onClick={() => {
                              setCodAmount('');
                              setCodReference('');
                              openOrder('cod');
                            }}
                          >
                            Record COD collection
                          </button>
                        ) : (
                          <span className="muted">Awaiting Finance</span>
                        )
                      ) : (
                        <span className="muted">After delivery</span>
                      )}
                    </dd>
                  </>
                )}
              </dl>
            </Section>
          </div>

          <Section
            title="Lines"
            actions={
              <span className="row">
                <Can anyOf={['order:fulfil']}>
                  <button type="button" className="btn small" disabled={selected.length === 0} onClick={() => openOrder('fulfil')}>
                    Create fulfilment from selected
                  </button>
                </Can>
                <Can anyOf={['return:initiate']}>
                  <button type="button" className="btn small" disabled={selected.length === 0} onClick={() => openOrder('return')}>
                    Start return for selected
                  </button>
                </Can>
              </span>
            }
          >
            <DataTable
              caption="Order lines"
              rows={o.lines}
              rowKey={(l) => l.id}
              columns={[
                {
                  header: 'Select',
                  cell: (l) => (
                    <Checkbox
                      label={`Select ${l.styleName} ${l.sizeLabel}`}
                      checked={selected.includes(l.id)}
                      onChange={(on) => setSelected((s) => (on ? [...s, l.id] : s.filter((x) => x !== l.id)))}
                    />
                  ),
                },
                {
                  header: 'Item',
                  cell: (l) => (
                    <Link href={`/dashboard/products/${l.styleId}`}>
                      {l.styleName} · {l.colourName} · {l.sizeLabel}
                    </Link>
                  ),
                },
                { header: 'Qty', numeric: true, cell: (l) => l.quantity },
                { header: 'Line total', numeric: true, cell: (l) => <Money value={l.lineTotalInclusive} /> },
                {
                  header: 'Status',
                  cell: (l) => (
                    <>
                      <StatusBadge status={l.status} />
                      {l.exceptionReason && <div className="muted">{l.exceptionReason}</div>}
                      {l.cancelledReason && <div className="muted">{l.cancelledReason}</div>}
                    </>
                  ),
                },
                {
                  header: 'Pick',
                  cell: (l) =>
                    l.pickTask ? (
                      <>
                        <StatusBadge status={l.pickTask.status} />
                        {l.pickTask.exceptionType && <div className="muted">{l.pickTask.exceptionType}</div>}
                      </>
                    ) : (
                      '—'
                    ),
                },
                {
                  header: 'Actions',
                  cell: (l) => (
                    // Only the actions the server allows for a line in this
                    // status: cancel and exceptions before shipping, exchange
                    // after delivery, refund for a cancelled prepaid line or
                    // a delivered (returnable) one.
                    <span className="row">
                      {inBookedPackage(l) && <span className="muted">Booked with the courier: cancel from Pack &amp; ship</span>}
                      {!['SHIPPED', 'DELIVERED', 'CANCELLED'].includes(l.status) && !inBookedPackage(l) && (
                        <Can anyOf={['order:cancel']}>
                          <button type="button" className="btn small" onClick={() => openLine({ kind: 'cancel', line: l })}>
                            Cancel
                          </button>
                        </Can>
                      )}
                      <Can anyOf={['order:exception:manage']}>
                        {l.status === 'EXCEPTION' ? (
                          <button type="button" className="btn small" onClick={() => openLine({ kind: 'resolve', line: l })}>
                            Resolve exception
                          </button>
                        ) : (
                          !['SHIPPED', 'DELIVERED', 'CANCELLED'].includes(l.status) && !inBookedPackage(l) && (
                            <button type="button" className="btn small" onClick={() => openLine({ kind: 'exception', line: l })}>
                              Flag exception
                            </button>
                          )
                        )}
                      </Can>
                      {l.status === 'DELIVERED' && (
                        <Can anyOf={['exchange:initiate']}>
                          <button type="button" className="btn small" onClick={() => openLine({ kind: 'exchange', line: l })}>
                            Exchange
                          </button>
                        </Can>
                      )}
                      {(l.status === 'DELIVERED' || (l.status === 'CANCELLED' && o.paymentMethod === 'PREPAID' && o.refundRequired)) && (
                        <Can anyOf={['payment:refund']}>
                          <button type="button" className="btn small" onClick={() => openLine({ kind: 'refund', line: l })}>
                            Refund
                          </button>
                        </Can>
                      )}
                    </span>
                  ),
                },
              ]}
            />
          </Section>

          <Section title={`Fulfilments (${o.fulfilments.length})`}>
            {o.fulfilments.length === 0 && <p className="muted">No fulfilments yet. Picked lines can be grouped into a fulfilment above.</p>}
            {o.fulfilments.map((f, i) => (
              <div key={f.id} className="card" style={{ background: 'var(--color-surface-muted)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>
                    Package {i + 1} <StatusBadge status={f.dispatchStage ?? f.status} />
                  </strong>
                  <span className="muted">{o.lines.filter((l) => l.fulfilmentId === f.id).map((l) => `${l.styleName} ${l.sizeLabel}`).join(', ')}</span>
                </div>
                <dl className="dl" style={{ margin: '0.5rem 0' }}>
                  <dt>Packed</dt>
                  <dd>
                    <DateText value={f.packedAt} withTime />
                  </dd>
                  <dt>Shipped</dt>
                  <dd>
                    <DateText value={f.shippedAt} withTime /> {f.carrierName && `· ${f.carrierName}`} {f.trackingRef && <Ident>{f.trackingRef}</Ident>}
                  </dd>
                  <dt>Delivered</dt>
                  <dd>
                    <DateText value={f.deliveredAt} withTime />
                  </dd>
                  <dt>Carrier shipment</dt>
                  <dd>
                    {f.shipment ? (
                      <>
                        <StatusBadge status={f.shipment.status} /> {f.shipment.provider} <Ident>{f.shipment.trackingRef ?? ''}</Ident> · attempts{' '}
                        {f.shipment.deliveryAttempts}/{f.shipment.maxDeliveryAttempts}
                      </>
                    ) : (
                      'Not booked'
                    )}
                  </dd>
                </dl>
                <FulfilmentActions fulfilment={f} onChanged={reloadAll} />
              </div>
            ))}
          </Section>

          <div className="grid-3">
            <Can anyOf={['return:read']}>
              <Section title="Returns">
                <DataState state={returns}>
                  {(rows) => (
                    <DataTable
                      caption="Returns"
                      rows={rows}
                      rowKey={(r) => r.id}
                      empty="None."
                      columns={[
                        {
                          header: 'Return',
                          cell: (r) => (
                            <Link href={`/dashboard/returns/${r.id}`}>
                              <Ident>{r.returnNumber}</Ident>
                            </Link>
                          ),
                        },
                        { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                      ]}
                    />
                  )}
                </DataState>
              </Section>
            </Can>
            <Can anyOf={['exchange:read']}>
              <Section title="Exchanges">
                <DataState state={exchanges}>
                  {(rows) => (
                    <DataTable
                      caption="Exchanges"
                      rows={rows}
                      rowKey={(r) => r.id}
                      empty="None."
                      columns={[
                        {
                          header: 'Exchange',
                          cell: (r) => (
                            <Link href={`/dashboard/exchanges/${r.id}`}>
                              <Ident>{r.exchangeNumber}</Ident>
                            </Link>
                          ),
                        },
                        { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                      ]}
                    />
                  )}
                </DataState>
              </Section>
            </Can>
            <Can anyOf={['payment:refund']}>
              <Section title="Refunds">
                <DataState state={refunds}>
                  {(rows) => (
                    <DataTable
                      caption="Refunds"
                      rows={rows}
                      rowKey={(r) => r.id}
                      empty="None."
                      columns={[
                        { header: 'Line', cell: (r) => o.lines.find((l) => l.id === r.orderLineId)?.styleName ?? '—' },
                        { header: 'Method', cell: (r) => r.method.replace(/_/g, ' ').toLowerCase() },
                        { header: 'Amount', numeric: true, cell: (r) => <Money value={r.amount} /> },
                        {
                          header: 'Status',
                          cell: (r) => (
                            <>
                              <StatusBadge status={r.status} />
                              {r.failureReason && <div className="muted">{r.failureReason}</div>}
                            </>
                          ),
                        },
                      ]}
                    />
                  )}
                </DataState>
              </Section>
            </Can>
          </div>

          <ConfirmDialog
            open={dialog !== null}
            title={
              dialog
                ? { cancel: 'Cancel line', exception: 'Flag exception', resolve: 'Resolve exception', refund: 'Refund line', exchange: 'Exchange line' }[dialog.kind]
                : ''
            }
            confirmLabel={dialog ? { cancel: 'Cancel line', exception: 'Flag', resolve: 'Resolve', refund: 'Issue refund', exchange: 'Request exchange' }[dialog.kind] : 'Confirm'}
            danger={dialog?.kind === 'cancel'}
            busy={action.busy}
            onCancel={() => setDialog(null)}
            onConfirm={() => dialog && void submitLine(dialog)}
          >
            {dialog && (
              <>
                <p>
                  {dialog.line.styleName} · {dialog.line.colourName} · {dialog.line.sizeLabel} × {dialog.line.quantity}
                </p>
                {dialog.kind === 'cancel' && <p className="muted">Only lines that have not shipped can be cancelled; stock, payment and loyalty follow the cancellation rules.</p>}
                {dialog.kind === 'refund' && (
                  <p className="muted">The refund service decides eligibility (a cancelled line or a QC-passed return) and the method: original payment for prepaid, store credit for COD.</p>
                )}
                {dialog.kind === 'resolve' && (
                  <SelectField
                    label="Resolution"
                    value={resolution}
                    onChange={setResolution}
                    options={[
                      { value: 'REINSTATE', label: 'Reinstate the line' },
                      { value: 'CANCEL', label: 'Cancel the line' },
                    ]}
                  />
                )}
                {dialog.kind === 'exchange' && (
                  <>
                    <SkuPicker label="Replacement SKU" value={replacement} onChange={setReplacement} hint="Usually another size or colour of the same style. The exchange service checks eligibility and settles any price difference." />
                    <SelectField
                      label="Collection method"
                      value={method}
                      onChange={setMethod}
                      options={[
                        { value: 'DROP_OFF', label: 'Customer drop-off' },
                        { value: 'PICKUP', label: 'Carrier pickup' },
                      ]}
                    />
                  </>
                )}
                {dialog.kind !== 'refund' && (
                  <TextArea label={dialog.kind === 'cancel' ? 'Reason (optional)' : 'Reason'} value={reason} onChange={setReason} required={dialog.kind !== 'cancel'} />
                )}
                {action.message?.kind === 'error' && <ActionMessage message={action.message} />}
              </>
            )}
          </ConfirmDialog>

          <ConfirmDialog
            open={orderDialog !== null}
            title={orderDialog ? { cod: 'Record COD collection', rto: 'Mark return-to-origin', invoice: 'Retry invoice', fulfil: 'Create fulfilment', return: 'Start return' }[orderDialog] : ''}
            confirmLabel={orderDialog ? { cod: 'Record collection', rto: 'Mark RTO', invoice: 'Retry', fulfil: 'Create fulfilment', return: 'Start return' }[orderDialog] : 'Confirm'}
            danger={orderDialog === 'rto'}
            busy={action.busy}
            onCancel={() => setOrderDialog(null)}
            onConfirm={() => orderDialog && void submitOrder(orderDialog)}
          >
            {orderDialog === 'fulfil' && <p>Group {selected.length} picked line(s) into one package. Only PICKED lines can be grouped.</p>}
            {orderDialog === 'return' && (
              <>
                <p>Return {selected.length} line(s). The return service checks the return window and eligibility.</p>
                <SelectField
                  label="Collection method"
                  value={method}
                  onChange={setMethod}
                  options={[
                    { value: 'DROP_OFF', label: 'Customer drop-off' },
                    { value: 'PICKUP', label: 'Carrier pickup' },
                  ]}
                />
              </>
            )}
            {orderDialog === 'invoice' && <p>Re-attempts invoice generation. Safe to repeat.</p>}
            {orderDialog === 'cod' && (
              <>
                <p>Confirm the cash the courier collected for this order. This reports the order as a purchase to analytics; it can be recorded once.</p>
                <TextField label="Amount collected (INR)" type="number" min={0} step="0.01" value={codAmount} onChange={setCodAmount} required />
                <TextField label="Remittance or receipt reference" value={codReference} onChange={setCodReference} required />
              </>
            )}
            {(orderDialog === 'rto' || orderDialog === 'return') && <TextArea label="Reason" value={reason} onChange={setReason} required />}
            {action.message?.kind === 'error' && <ActionMessage message={action.message} />}
          </ConfirmDialog>
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            Actions are validated by the order, return, exchange and refund services; a refusal is shown with the service&apos;s reason.
          </p>
        </div>
      )}
    </DataState>
  );
}
