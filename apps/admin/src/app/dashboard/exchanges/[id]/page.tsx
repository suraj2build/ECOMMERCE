'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { FulfilmentActions, REPLACEMENT_CANCEL, shipmentDisplayStatus } from '@/components/fulfilment-actions';
import { ActionMessage, Can, ConfirmDialog, DataState, DateText, Ident, Money, Notice, PageHeader, Section, SelectField, StatusBadge, TextArea } from '@/components/ui';
import { apiSend, newIdempotencyKey, qs } from '@/lib/api';
import { useAction, useApi, useCan } from '@/lib/session';

interface ExchangeDetail {
  id: string;
  exchangeNumber: string;
  orderId: string;
  orderLineId: string;
  originalSkuId: string;
  replacementSkuId: string;
  quantity: number;
  reason: string;
  status: string;
  method: string;
  originalLineValue: string;
  replacementValue: string;
  priceDifference: string;
  paymentDirection: string;
  paymentStatus: string;
  pickupStatus: string | null;
  pickupTrackingRef: string | null;
  receivedAt: string | null;
  qcResult: string | null;
  disposition: string | null;
  qcNotes: string | null;
  replacementAllocatedAt: string | null;
  replacementFulfilledAt: string | null;
  createdAt: string;
  replacementFulfilment: {
    pickTask: { id: string; status: string; allocatedQuantity: number; pickedQuantity: number | null } | null;
    fulfilment: {
      id: string;
      status: string;
      packedAt: string | null;
      shippedAt: string | null;
      deliveredAt: string | null;
      shipment: { id: string; provider: string; status: string; trackingRef: string | null; deliveryAttempts: number; handedOverAt: string | null } | null;
    } | null;
    cancelledBookings: Array<{ id: string; trackingRef: string | null; bookingCancelledAt: string | null; courierReference: string | null }>;
  };
}

type Step = 'pickup' | 'pickup/complete' | 'receive' | 'fulfilment' | 'replacement-fulfilled' | 'cancel';
const STEPS: Record<Step, { label: string; perm: string; body: string; danger?: boolean; requireText?: string }> = {
  pickup: { label: 'Schedule carrier pickup', perm: 'exchange:receive', body: 'Books a reverse pickup of the original item.' },
  'pickup/complete': { label: 'Mark picked up', perm: 'exchange:receive', body: 'The carrier has collected the original item.' },
  receive: { label: 'Mark received', perm: 'exchange:receive', body: 'The original item is at the warehouse, ready for QC.' },
  fulfilment: {
    label: 'Create replacement package',
    perm: 'exchange:fulfil',
    body: 'Groups the picked replacement into a package. It then ships through the normal pack / ready-to-ship / ship / deliver steps below. No second order is created.',
  },
  'replacement-fulfilled': {
    label: 'Confirm fulfilled outside the pipeline',
    perm: 'exchange:fulfil',
    danger: true,
    requireText: 'CONFIRM',
    body: 'Recovery path only: records that the replacement reached the customer outside the tracked warehouse and shipping pipeline, and completes the exchange. Use it only when the normal package flow cannot be used.',
  },
  cancel: { label: 'Cancel exchange', perm: 'exchange:initiate', danger: true, body: 'Cancels the exchange request.' },
};

/** Only the steps the exchange service accepts from the current status are offered (it still decides). */
function headerStepValid(step: Step, e: { status: string; method: string }): boolean {
  switch (step) {
    case 'pickup':
      return e.status === 'REQUESTED' && e.method === 'PICKUP';
    case 'pickup/complete':
      return e.status === 'PICKUP_SCHEDULED';
    case 'receive':
      return e.method === 'DROP_OFF' ? e.status === 'REQUESTED' : e.status === 'PICKED_UP';
    case 'cancel':
      return e.status === 'REQUESTED' || e.status === 'PICKUP_SCHEDULED';
    default:
      return true;
  }
}

export default function ExchangeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const ex = useApi<ExchangeDetail>(`/exchanges/${id}`);
  const canProduct = useCan('product:read');
  const canOrders = useCan('order:read');
  const e0 = ex.data;
  const skuLabels = useApi<{ skus: Record<string, string> }>(canProduct && e0 ? `/admin/lookup/labels${qs({ skuIds: `${e0.originalSkuId},${e0.replacementSkuId}` })}` : null);
  const orderLabel = useApi<{ orders: Record<string, string> }>(canOrders && e0 ? `/admin/lookup/labels${qs({ orderIds: e0.orderId })}` : null);
  const action = useAction();
  const [step, setStep] = useState<Step | null>(null);
  const [key, setKey] = useState('');
  const [reason, setReason] = useState('');
  const [qcOpen, setQcOpen] = useState(false);
  const [qc, setQc] = useState({ qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE', notes: '' });

  return (
    <DataState state={ex}>
      {(e) => {
        const rf = e.replacementFulfilment;
        return (
          <div>
            <PageHeader
              title={`Exchange ${e.exchangeNumber}`}
              description={
                <>
                  <StatusBadge status={e.status} /> requested <DateText value={e.createdAt} withTime /> ·{' '}
                  <Link href={`/dashboard/orders/${e.orderId}`}>
                    order <Ident>{orderLabel.data?.orders[e.orderId] ?? ''}</Ident>
                  </Link>
                </>
              }
              breadcrumbs={[{ label: 'Post-purchase' }, { label: 'Exchanges', href: '/dashboard/exchanges' }, { label: e.exchangeNumber }]}
              actions={
                <>
                  {(['pickup', 'pickup/complete', 'receive', 'cancel'] as Step[]).filter((s) => headerStepValid(s, e)).map((s) => (
                    <Can key={s} anyOf={[STEPS[s].perm]}>
                      <button
                        type="button"
                        className={STEPS[s].danger ? 'btn danger' : 'btn'}
                        onClick={() => {
                          setKey(newIdempotencyKey('exchange-pickup'));
                          setReason('');
                          action.clear();
                          setStep(s);
                        }}
                      >
                        {STEPS[s].label}
                      </button>
                    </Can>
                  ))}
                  {e.status === 'RECEIVED' && (
                    <Can anyOf={['exchange:qc']}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          action.clear();
                          setQcOpen(true);
                        }}
                      >
                        Record QC
                      </button>
                    </Can>
                  )}
                </>
              }
            />
            <ActionMessage message={step || qcOpen ? null : action.message} />
            {e.status === 'QC_FAILED' && e.paymentStatus === 'CAPTURED' && (
              <Notice kind="warning">QC failed after the customer paid a price difference. This is never refunded automatically; Finance/CS decide the resolution.</Notice>
            )}

            <div className="grid-2">
              <Section title="Items and settlement">
                <dl className="dl">
                  <dt>Original</dt>
                  <dd>
                    <Ident>{skuLabels.data?.skus[e.originalSkuId] ?? e.originalSkuId.slice(0, 8)}</Ident> × {e.quantity} (<Money value={e.originalLineValue} />)
                  </dd>
                  <dt>Replacement</dt>
                  <dd>
                    <Ident>{skuLabels.data?.skus[e.replacementSkuId] ?? e.replacementSkuId.slice(0, 8)}</Ident> (<Money value={e.replacementValue} />)
                  </dd>
                  <dt>Price difference</dt>
                  <dd>
                    <Money value={e.priceDifference} />
                  </dd>
                  <dt>Settlement</dt>
                  <dd>
                    {e.paymentDirection.replace(/_/g, ' ').toLowerCase()} · <StatusBadge status={e.paymentStatus} />
                  </dd>
                  <dt>Reason</dt>
                  <dd>{e.reason}</dd>
                </dl>
              </Section>
              <Section title="Original item">
                <dl className="dl">
                  <dt>Method</dt>
                  <dd>{e.method === 'PICKUP' ? 'Carrier pickup' : 'Drop-off'}</dd>
                  <dt>Pickup</dt>
                  <dd>
                    <StatusBadge status={e.pickupStatus} /> <Ident>{e.pickupTrackingRef ?? ''}</Ident>
                  </dd>
                  <dt>Received</dt>
                  <dd>
                    <DateText value={e.receivedAt} withTime />
                  </dd>
                  <dt>QC</dt>
                  <dd>
                    <StatusBadge status={e.qcResult} /> {e.disposition && e.disposition.replace(/_/g, ' ').toLowerCase()} {e.qcNotes && `· ${e.qcNotes}`}
                  </dd>
                </dl>
              </Section>
            </div>

            <Section title="Replacement fulfilment">
              <dl className="dl" style={{ marginBottom: '0.75rem' }}>
                <dt>Allocated</dt>
                <dd>
                  <DateText value={e.replacementAllocatedAt} withTime />
                </dd>
                <dt>Pick task</dt>
                <dd>
                  {rf.pickTask ? (
                    <>
                      <StatusBadge status={rf.pickTask.status} />{' '}
                      <Can anyOf={['warehouse:read']}>
                        <Link href="/dashboard/warehouse/picks">open pick queue</Link>
                      </Can>
                    </>
                  ) : (
                    'Created when the replacement is allocated'
                  )}
                </dd>
                <dt>Package</dt>
                <dd>{rf.fulfilment ? <StatusBadge status={rf.fulfilment.status} /> : 'Not packaged yet'}</dd>
                <dt>Shipment</dt>
                <dd>
                  {rf.fulfilment?.shipment ? (
                    <>
                      <StatusBadge status={shipmentDisplayStatus(rf.fulfilment.shipment)} /> {rf.fulfilment.shipment.provider} <Ident>{rf.fulfilment.shipment.trackingRef ?? ''}</Ident>
                    </>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt>Completed</dt>
                <dd>
                  <DateText value={e.replacementFulfilledAt} withTime />
                </dd>
              </dl>
              {!rf.fulfilment && e.status === 'REPLACEMENT_ALLOCATED' && rf.pickTask?.status !== 'PICKED' && (
                <p className="muted">Next: pick the replacement from the pick queue, then create its package here.</p>
              )}
              {!rf.fulfilment && e.status === 'REPLACEMENT_ALLOCATED' && rf.pickTask?.status === 'PICKED' && (
                <Can anyOf={['exchange:fulfil']}>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      action.clear();
                      setStep('fulfilment');
                    }}
                  >
                    Create replacement package
                  </button>
                </Can>
              )}
              {rf.fulfilment && (
                <FulfilmentActions
                  fulfilment={{ id: rf.fulfilment.id, status: rf.fulfilment.status, shipment: rf.fulfilment.shipment, exchangeId: e.id }}
                  onChanged={(done) => {
                    action.clear();
                    // A cancelled booking removes the package, and the package's own message with it.
                    if (done === REPLACEMENT_CANCEL.done) void action.run(async () => undefined, done);
                    ex.reload();
                  }}
                />
              )}
              {rf.cancelledBookings.length > 0 && (
                <div style={{ marginTop: '0.75rem' }}>
                  <p className="muted">Earlier packages whose courier booking was cancelled before collection (no stock moved):</p>
                  <ul>
                    {rf.cancelledBookings.map((b) => (
                      <li key={b.id}>
                        Booking <Ident>{b.trackingRef ?? '—'}</Ident> cancelled <DateText value={b.bookingCancelledAt} withTime />
                        {b.courierReference && (
                          <>
                            {' '}
                            · courier reference <Ident>{b.courierReference}</Ident>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!['COMPLETED', 'CANCELLED', 'QC_FAILED'].includes(e.status) && (
                <Notice kind="info">
                  <strong>Changing the replacement item</strong> (another size or colour) is not possible here; it waits on a Product Owner decision (AO-D8).{' '}
                  {['REQUESTED', 'PICKUP_SCHEDULED', 'PICKED_UP'].includes(e.status)
                    ? 'Until the original item is received, you can cancel this exchange; the customer can then return the item for a refund, but cannot open a second exchange for it.'
                    : 'The original item has been received, so the exchange can only go ahead with this replacement.'}{' '}
                  Do not record a pick shortage to get round this: that writes the stock off as missing.
                </Notice>
              )}
              {e.status === 'REPLACEMENT_ALLOCATED' && (
                <details style={{ marginTop: '1rem' }}>
                  <summary>Recovery: replacement fulfilled outside the pipeline</summary>
                  <p className="muted">The exchange completes automatically when its replacement package is delivered. Use this only for a replacement handed over outside tracked shipping.</p>
                  <Can anyOf={['exchange:fulfil']}>
                    <button
                      type="button"
                      className="btn danger"
                      onClick={() => {
                        action.clear();
                        setStep('replacement-fulfilled');
                      }}
                    >
                      Confirm fulfilled outside the pipeline
                    </button>
                  </Can>
                </details>
              )}
            </Section>

            <ConfirmDialog
              open={step !== null}
              title={step ? STEPS[step].label : ''}
              confirmLabel={step ? STEPS[step].label : 'Confirm'}
              danger={step ? STEPS[step].danger : false}
              requireText={step ? STEPS[step].requireText : undefined}
              busy={action.busy}
              onCancel={() => setStep(null)}
              onConfirm={async () => {
                if (!step) return;
                const body = step === 'pickup' ? { idempotencyKey: key } : step === 'cancel' ? { reason: reason || undefined } : undefined;
                if (await action.run(() => apiSend('POST', `/exchanges/${e.id}/${step}`, body), `${STEPS[step].label}: done.`)) {
                  setStep(null);
                  ex.reload();
                }
              }}
            >
              <p>{step && STEPS[step].body}</p>
              {step === 'cancel' && <TextArea label="Reason (optional)" value={reason} onChange={setReason} />}
              {action.message?.kind === 'error' && <ActionMessage message={action.message} />}
            </ConfirmDialog>

            <ConfirmDialog
              open={qcOpen}
              title="Record QC for the original item"
              confirmLabel="Record QC"
              busy={action.busy}
              onCancel={() => setQcOpen(false)}
              onConfirm={async () => {
                const ok = await action.run(
                  () => apiSend('POST', `/exchanges/${e.id}/qc`, { qcResult: qc.qcResult, disposition: qc.disposition, notes: qc.notes || undefined }),
                  'QC recorded.',
                );
                if (ok) {
                  setQcOpen(false);
                  ex.reload();
                }
              }}
            >
              <p className="muted">A pass lets the exchange service settle the price difference and allocate the replacement; a fail never allocates it.</p>
              <SelectField
                label="QC result"
                value={qc.qcResult}
                onChange={(v) => setQc((x) => ({ ...x, qcResult: v }))}
                options={[
                  { value: 'PASS', label: 'Pass' },
                  { value: 'FAIL', label: 'Fail' },
                ]}
              />
              <SelectField
                label="Disposition"
                value={qc.disposition}
                onChange={(v) => setQc((x) => ({ ...x, disposition: v }))}
                options={['RESTOCK_SELLABLE', 'RESTOCK_DAMAGED', 'WRITE_OFF', 'RETURN_TO_SUPPLIER'].map((d) => ({ value: d, label: d.replace(/_/g, ' ').toLowerCase() }))}
              />
              <TextArea label="QC notes" value={qc.notes} onChange={(v) => setQc((x) => ({ ...x, notes: v }))} />
              {action.message?.kind === 'error' && <ActionMessage message={action.message} />}
            </ConfirmDialog>
          </div>
        );
      }}
    </DataState>
  );
}
