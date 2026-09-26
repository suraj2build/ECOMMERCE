'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Button, buttonClassName } from '@/components/ui/Button';
import { getMyOrder, cancelMyOrderLine, type OrderView } from '@/lib/orders';
import { listMyReturns, initiateMyReturn, cancelMyReturn, uploadMyReturnEvidence, listMyReturnEvidence, type ReturnView } from '@/lib/returns';
import { listMyOrderRefunds, type RefundView } from '@/lib/refunds';
import {
  listMyExchanges,
  initiateMyExchange,
  cancelMyExchange,
  initiateMyExchangePayment,
  listReplacementOptions,
  type ExchangeView,
  type ReplacementOption,
} from '@/lib/exchanges';
import { openRazorpayCheckout } from '@/lib/razorpay';

// M18 (specs/17-cancellation.md, CAN-001): "before shipment" - convenience
// display only, the server (OrderService.performCancellation) is the sole
// authoritative eligibility check and re-validates against live state.
const CANCELLABLE_LINE_STATUSES = new Set(['ALLOCATED', 'PICKED', 'PACKED']);

// M19 (specs/18-returns.md, RET-001): "delivered" gating is convenience
// display only - ReturnService re-validates window/non-returnable
// eligibility server-side against live state on every initiate call.
const RETURNABLE_LINE_STATUSES = new Set(['DELIVERED']);

const RETURN_STATUS_LABEL: Record<ReturnView['status'], string> = {
  REQUESTED: 'Return requested',
  PICKUP_SCHEDULED: 'Pickup scheduled',
  PICKED_UP: 'Picked up - awaiting warehouse receipt',
  RECEIVED: 'Received - under inspection',
  DISPOSITIONED: 'Return processed',
  CANCELLED: 'Return cancelled',
};

// M20 (specs/19-refunds.md): honest per-line settlement status - never
// implies money moved before the server actually completed it.
const REFUND_STATUS_LABEL: Record<RefundView['status'], string> = {
  PENDING: 'Refund pending',
  PROCESSING: 'Refund processing',
  COMPLETED: 'Refunded',
  FAILED: 'Refund pending (retrying)',
};

// M21 (specs/20-exchanges.md): same "delivered" convenience gating as
// returns - ExchangeService re-validates eligibility server-side.
const EXCHANGEABLE_LINE_STATUSES = new Set(['DELIVERED']);

const EXCHANGE_STATUS_LABEL: Record<ExchangeView['status'], string> = {
  REQUESTED: 'Exchange requested',
  PICKUP_SCHEDULED: 'Pickup scheduled',
  PICKED_UP: 'Picked up - awaiting warehouse receipt',
  RECEIVED: 'Received - under inspection',
  REPLACEMENT_ALLOCATED: 'Replacement reserved - preparing to ship',
  COMPLETED: 'Exchange completed',
  QC_FAILED: 'Under review',
  REPLACEMENT_UNAVAILABLE: 'Replacement unavailable - we will contact you',
  CANCELLED: 'Exchange cancelled',
};

const STATUS_LABEL: Record<OrderView['status'], string> = {
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  RTO: 'Returned to origin',
  EXCEPTION: 'Needs attention',
};

const LINE_STATUS_LABEL: Record<string, string> = {
  ALLOCATED: 'Preparing',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  EXCEPTION: 'Needs attention',
};

/**
 * M17 (specs/16-shipping-tracking.md): the platform's own normalized
 * tracking status, never a carrier's raw vocabulary (see
 * ShippingProvider's adapter-boundary normalization) - the same
 * "customer shipment tracking" this label set is required to display.
 */
const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  CREATED: 'Preparing to ship',
  BOOKED: 'Booked with carrier',
  IN_TRANSIT: 'In transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERY_FAILED: 'Delivery attempt failed - retrying',
  DELIVERED: 'Delivered',
  RTO_INITIATED: 'Returning to origin',
  RTO_DELIVERED: 'Returned to origin',
};

/** Order detail (M15). Honestly reflects the real fulfilment/cancellation state per line - never a single fake "order status" that hides a split shipment or a cancelled item. */
export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [returns, setReturns] = useState<ReturnView[]>([]);
  const [refunds, setRefunds] = useState<RefundView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cancellingLineId, setCancellingLineId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelInFlight, setCancelInFlight] = useState(false);
  const [returningLineId, setReturningLineId] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState('');
  const [returnMethod, setReturnMethod] = useState<'PICKUP' | 'DROP_OFF'>('PICKUP');
  const [returnError, setReturnError] = useState<string | null>(null);
  const [returnInFlight, setReturnInFlight] = useState(false);
  const [evidenceCounts, setEvidenceCounts] = useState<Record<string, number>>({});
  const [evidenceUploadingLineId, setEvidenceUploadingLineId] = useState<string | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<ExchangeView[]>([]);
  const [exchangingLineId, setExchangingLineId] = useState<string | null>(null);
  const [exchangeOptions, setExchangeOptions] = useState<ReplacementOption[]>([]);
  const [exchangeReplacementSkuId, setExchangeReplacementSkuId] = useState('');
  const [exchangeReason, setExchangeReason] = useState('');
  const [exchangeMethod, setExchangeMethod] = useState<'PICKUP' | 'DROP_OFF'>('PICKUP');
  const [exchangeError, setExchangeError] = useState<string | null>(null);
  const [exchangeInFlight, setExchangeInFlight] = useState(false);

  const refresh = () =>
    Promise.all([
      getMyOrder(params.id).then(setOrder),
      listMyReturns().then((all) => setReturns(all.filter((r) => r.orderId === params.id))),
      listMyOrderRefunds(params.id).then(setRefunds).catch(() => setRefunds([])),
      listMyExchanges()
        .then((all) => setExchanges(all.filter((e) => e.orderId === params.id)))
        .catch(() => setExchanges([])),
    ]);

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load this order.'));
  }, [params.id]);

  function refundForLine(lineId: string): RefundView | undefined {
    return refunds.find((r) => r.orderLineId === lineId);
  }

  function returnForLine(lineId: string) {
    for (const ret of returns) {
      const line = ret.lines.find((l) => l.orderLineId === lineId);
      if (line) return { ret, line };
    }
    return null;
  }

  function exchangeForLine(lineId: string): ExchangeView | undefined {
    return exchanges.find((e) => e.orderLineId === lineId);
  }

  async function openExchangeForm(styleId: string, currentSkuId: string, lineId: string) {
    setExchangingLineId(lineId);
    setExchangeReason('');
    setExchangeError(null);
    setExchangeReplacementSkuId('');
    setExchangeOptions([]);
    try {
      const variants = await listReplacementOptions(styleId);
      const options = variants.filter((v) => v.skuId !== currentSkuId && v.inStock);
      setExchangeOptions(options);
      if (options.length > 0) setExchangeReplacementSkuId(options[0]!.skuId);
    } catch (err) {
      setExchangeError(err instanceof Error ? err.message : 'Could not load replacement options.');
    }
  }

  async function confirmExchange(lineId: string) {
    setExchangeError(null);
    if (!exchangeReason.trim()) {
      setExchangeError('Please tell us why you are exchanging this item.');
      return;
    }
    if (!exchangeReplacementSkuId) {
      setExchangeError('Please choose a replacement.');
      return;
    }
    setExchangeInFlight(true);
    try {
      const created = await initiateMyExchange(order!.id, lineId, exchangeReplacementSkuId, exchangeReason.trim(), exchangeMethod);
      setExchangingLineId(null);
      setExchangeReason('');
      await refresh();

      // If the replacement costs more, collect the difference right
      // away via the same Checkout.js widget the checkout flow uses -
      // the webhook (server-to-server) remains the authoritative
      // confirmation, this is only the customer-facing payment step.
      if (created.paymentDirection === 'CUSTOMER_PAYS' && created.paymentStatus === 'PENDING') {
        const payment = await initiateMyExchangePayment(created.id);
        if (payment.publicKeyId) {
          await openRazorpayCheckout({
            orderId: payment.providerOrderId,
            publicKeyId: payment.publicKeyId,
            amountInclusive: payment.amount,
            contactName: order?.contactName ?? '',
            contactMobile: order?.contactMobile ?? '',
            onSuccess: () => refresh(),
            onDismiss: () => refresh(),
          });
        }
      }
    } catch (err) {
      setExchangeError(err instanceof Error ? err.message : 'Could not start this exchange - please try again.');
    } finally {
      setExchangeInFlight(false);
    }
  }

  async function withdrawExchange(exchangeId: string) {
    setExchangeError(null);
    setExchangeInFlight(true);
    try {
      await cancelMyExchange(exchangeId);
      await refresh();
    } catch (err) {
      setExchangeError(err instanceof Error ? err.message : 'Could not cancel this exchange - please try again.');
    } finally {
      setExchangeInFlight(false);
    }
  }

  async function confirmCancel(lineId: string) {
    setCancelError(null);
    setCancelInFlight(true);
    try {
      await cancelMyOrderLine(order!.id, lineId, cancelReason.trim() || undefined, crypto.randomUUID());
      setCancellingLineId(null);
      setCancelReason('');
      await refresh();
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Could not cancel this item - please try again.');
    } finally {
      setCancelInFlight(false);
    }
  }

  async function confirmReturn(lineId: string) {
    setReturnError(null);
    if (!returnReason.trim()) {
      setReturnError('Please tell us why you are returning this item.');
      return;
    }
    setReturnInFlight(true);
    try {
      await initiateMyReturn(order!.id, [{ orderLineId: lineId, reason: returnReason.trim() }], returnMethod);
      setReturningLineId(null);
      setReturnReason('');
      await refresh();
    } catch (err) {
      setReturnError(err instanceof Error ? err.message : 'Could not start this return - please try again.');
    } finally {
      setReturnInFlight(false);
    }
  }

  async function withdrawReturn(returnId: string) {
    setReturnError(null);
    setReturnInFlight(true);
    try {
      await cancelMyReturn(returnId);
      await refresh();
    } catch (err) {
      setReturnError(err instanceof Error ? err.message : 'Could not cancel this return - please try again.');
    } finally {
      setReturnInFlight(false);
    }
  }

  // Independent-review repair (finding 2): loads the evidence-file count
  // for every active (non-CANCELLED/DISPOSITIONED) return line whenever
  // the returns list changes, so the upload control can show "N photo(s)
  // added" without a separate fetch per render.
  useEffect(() => {
    let cancelled = false;
    async function loadEvidenceCounts() {
      const entries = await Promise.all(
        returns
          .filter((ret) => ret.status !== 'CANCELLED' && ret.status !== 'DISPOSITIONED')
          .flatMap((ret) => ret.lines.map((line) => ({ returnId: ret.id, line })))
          .map(async ({ returnId, line }) => {
            try {
              const evidence = await listMyReturnEvidence(returnId, line.id);
              // Keyed by the ReturnLine's OWN id (matching
              // handleEvidenceUpload's own key below), never the
              // OrderLine's id - the two are different ids.
              return [line.id, evidence.length] as const;
            } catch {
              return [line.orderLineId, 0] as const;
            }
          }),
      );
      if (!cancelled) setEvidenceCounts(Object.fromEntries(entries));
    }
    if (returns.length > 0) void loadEvidenceCounts();
    return () => {
      cancelled = true;
    };
  }, [returns]);

  async function handleEvidenceUpload(returnId: string, lineId: string, file: File) {
    setEvidenceError(null);
    setEvidenceUploadingLineId(lineId);
    try {
      await uploadMyReturnEvidence(returnId, lineId, file);
      const evidence = await listMyReturnEvidence(returnId, lineId);
      setEvidenceCounts((prev) => ({ ...prev, [lineId]: evidence.length }));
    } catch (err) {
      setEvidenceError(err instanceof Error ? err.message : 'Could not upload this photo - please try again.');
    } finally {
      setEvidenceUploadingLineId(null);
    }
  }

  if (error) {
    return (
      <Container className="py-8">
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      </Container>
    );
  }

  if (!order) {
    return (
      <Container className="py-8">
        <p className="text-sm text-ink-muted">Loading...</p>
      </Container>
    );
  }

  return (
    <Container className="py-8">
      <h1 className="font-display text-2xl text-ink">Order {order.orderNumber}</h1>
      <p role="status" className="mt-2 text-sm text-ink-muted">
        {STATUS_LABEL[order.status]}
        {order.refundRequired ? ' - a refund is being processed' : ''}
      </p>

      <div className="mt-6 rounded-sm border border-border p-6">
        <ul className="space-y-4">
          {order.lines.map((line) => (
            <li key={line.id} className="border-b border-border pb-4 text-sm last:border-b-0 last:pb-0">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-ink">
                    {line.styleName} - {line.colourName} - {line.sizeLabel} x{line.quantity}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {LINE_STATUS_LABEL[line.status] ?? line.status}
                    {line.cancelledReason ? `: ${line.cancelledReason}` : ''}
                  </p>
                </div>
                <span className="text-ink">&#8377;{line.lineTotalInclusive}</span>
              </div>

              {/* M18 (CAN-001): convenience gating only - the server is
                  the sole authoritative eligibility check. */}
              {CANCELLABLE_LINE_STATUSES.has(line.status) && cancellingLineId !== line.id && (
                <button
                  type="button"
                  onClick={() => {
                    setCancellingLineId(line.id);
                    setCancelReason('');
                    setCancelError(null);
                  }}
                  className="mt-2 min-h-[44px] text-xs font-medium text-ink underline underline-offset-2"
                >
                  Cancel this item
                </button>
              )}

              {cancellingLineId === line.id && (
                <div className="mt-3 space-y-2 rounded-sm border border-border p-3">
                  <label htmlFor={`cancel-reason-${line.id}`} className="block text-xs text-ink-muted">
                    Reason (optional)
                  </label>
                  <textarea
                    id={`cancel-reason-${line.id}`}
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    className="w-full rounded-sm border border-border p-2 text-sm text-ink"
                    rows={2}
                  />
                  {cancelError && (
                    <p role="alert" className="text-xs text-danger">
                      {cancelError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      disabled={cancelInFlight}
                      onClick={() => confirmCancel(line.id)}
                    >
                      {cancelInFlight ? 'Cancelling...' : 'Confirm cancellation'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={cancelInFlight}
                      onClick={() => setCancellingLineId(null)}
                    >
                      Never mind
                    </Button>
                  </div>
                </div>
              )}

              {/* M20 (specs/19-refunds.md): only ever shown once the server
                  has actually created a Refund record for this line - never
                  implies money is moving before it genuinely is. */}
              {refundForLine(line.id) && (
                <p className="mt-1 text-xs text-ink-muted">
                  {REFUND_STATUS_LABEL[refundForLine(line.id)!.status]}
                  {refundForLine(line.id)!.status === 'COMPLETED'
                    ? ` - ₹${refundForLine(line.id)!.amount} ${refundForLine(line.id)!.method === 'STORE_CREDIT' ? 'as store credit' : 'to your original payment method'}`
                    : ''}
                </p>
              )}

              {(() => {
                const existing = returnForLine(line.id);
                if (existing) {
                  const evidenceActive = existing.ret.status !== 'CANCELLED' && existing.ret.status !== 'DISPOSITIONED';
                  const evidenceCount = evidenceCounts[existing.line.id] ?? 0;
                  return (
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-ink-muted">
                          {existing.ret.returnNumber}: {RETURN_STATUS_LABEL[existing.ret.status]}
                          {existing.ret.status === 'CANCELLED' && existing.ret.cancelledReason ? ` (${existing.ret.cancelledReason})` : ''}
                        </p>
                        {(existing.ret.status === 'REQUESTED' || existing.ret.status === 'PICKUP_SCHEDULED') && (
                          <button
                            type="button"
                            disabled={returnInFlight}
                            onClick={() => withdrawReturn(existing.ret.id)}
                            className="min-h-[44px] text-xs font-medium text-ink underline underline-offset-2"
                          >
                            Cancel return
                          </button>
                        )}
                      </div>
                      {evidenceActive && (
                        <div className="flex flex-col gap-1">
                          <label htmlFor={`return-evidence-${line.id}`} className="text-xs text-ink-muted">
                            {existing.line.evidenceRequired ? 'Photo of item condition (required)' : 'Add a photo of item condition (optional)'}
                            {evidenceCount > 0 ? ` - ${evidenceCount} photo${evidenceCount === 1 ? '' : 's'} added` : ''}
                          </label>
                          <input
                            id={`return-evidence-${line.id}`}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            capture="environment"
                            disabled={evidenceUploadingLineId === line.id}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              // The evidence routes are keyed by the ReturnLine's OWN id
                              // (existing.line.id), never the OrderLine's id (line.id).
                              if (file) void handleEvidenceUpload(existing.ret.id, existing.line.id, file);
                            }}
                            className="text-xs text-ink-muted"
                          />
                          {evidenceUploadingLineId === line.id && <p className="text-xs text-ink-muted">Uploading...</p>}
                          {evidenceError && (
                            <p role="alert" className="text-xs text-danger">
                              {evidenceError}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }

                if (!RETURNABLE_LINE_STATUSES.has(line.status)) return null;

                if (returningLineId !== line.id) {
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        setReturningLineId(line.id);
                        setReturnReason('');
                        setReturnError(null);
                      }}
                      className="mt-2 min-h-[44px] text-xs font-medium text-ink underline underline-offset-2"
                    >
                      Return this item
                    </button>
                  );
                }

                return (
                  <div className="mt-3 space-y-2 rounded-sm border border-border p-3">
                    <label htmlFor={`return-reason-${line.id}`} className="block text-xs text-ink-muted">
                      Reason (required)
                    </label>
                    <textarea
                      id={`return-reason-${line.id}`}
                      value={returnReason}
                      onChange={(e) => setReturnReason(e.target.value)}
                      className="w-full rounded-sm border border-border p-2 text-sm text-ink"
                      rows={2}
                      required
                    />
                    <fieldset className="flex gap-4">
                      <legend className="text-xs text-ink-muted">How would you like to return it?</legend>
                      <label className="flex min-h-[44px] items-center gap-1 text-xs text-ink">
                        <input
                          type="radio"
                          name={`return-method-${line.id}`}
                          checked={returnMethod === 'PICKUP'}
                          onChange={() => setReturnMethod('PICKUP')}
                        />
                        Carrier pickup
                      </label>
                      <label className="flex min-h-[44px] items-center gap-1 text-xs text-ink">
                        <input
                          type="radio"
                          name={`return-method-${line.id}`}
                          checked={returnMethod === 'DROP_OFF'}
                          onChange={() => setReturnMethod('DROP_OFF')}
                        />
                        Drop-off
                      </label>
                    </fieldset>
                    {returnError && (
                      <p role="alert" className="text-xs text-danger">
                        {returnError}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button type="button" variant="primary" disabled={returnInFlight} onClick={() => confirmReturn(line.id)}>
                        {returnInFlight ? 'Submitting...' : 'Start return'}
                      </Button>
                      <Button type="button" variant="ghost" disabled={returnInFlight} onClick={() => setReturningLineId(null)}>
                        Never mind
                      </Button>
                    </div>
                  </div>
                );
              })()}

              {/* M21 (specs/20-exchanges.md): mutually exclusive with an
                  active return on the same line - the server is the
                  authoritative check; this UI just doesn't offer both at
                  once for a line that already shows one. */}
              {(() => {
                const existing = exchangeForLine(line.id);
                if (existing) {
                  return (
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="text-xs text-ink-muted">
                        {EXCHANGE_STATUS_LABEL[existing.status]}
                        {existing.paymentDirection === 'CUSTOMER_PAYS' && existing.paymentStatus === 'PENDING' && (
                          <>
                            {' - '}
                            <button
                              type="button"
                              className="underline underline-offset-2"
                              onClick={async () => {
                                const payment = await initiateMyExchangePayment(existing.id);
                                if (payment.publicKeyId) {
                                  await openRazorpayCheckout({
                                    orderId: payment.providerOrderId,
                                    publicKeyId: payment.publicKeyId,
                                    amountInclusive: payment.amount,
                                    contactName: order?.contactName ?? '',
                                    contactMobile: order?.contactMobile ?? '',
                                    onSuccess: () => refresh(),
                                    onDismiss: () => refresh(),
                                  });
                                }
                              }}
                            >
                              Complete payment
                            </button>
                          </>
                        )}
                      </p>
                      {(existing.status === 'REQUESTED' || existing.status === 'PICKUP_SCHEDULED') && (
                        <button
                          type="button"
                          disabled={exchangeInFlight}
                          onClick={() => withdrawExchange(existing.id)}
                          className="min-h-[44px] text-xs font-medium text-ink underline underline-offset-2"
                        >
                          Cancel exchange
                        </button>
                      )}
                    </div>
                  );
                }

                if (returnForLine(line.id)) return null; // mutually exclusive - see server-side guard
                if (!EXCHANGEABLE_LINE_STATUSES.has(line.status)) return null;

                if (exchangingLineId !== line.id) {
                  return (
                    <button
                      type="button"
                      onClick={() => openExchangeForm(line.styleId, line.skuId, line.id)}
                      className="mt-2 min-h-[44px] text-xs font-medium text-ink underline underline-offset-2"
                    >
                      Exchange this item
                    </button>
                  );
                }

                return (
                  <div className="mt-3 space-y-2 rounded-sm border border-border p-3">
                    <label htmlFor={`exchange-replacement-${line.id}`} className="block text-xs text-ink-muted">
                      Replacement (required)
                    </label>
                    <select
                      id={`exchange-replacement-${line.id}`}
                      value={exchangeReplacementSkuId}
                      onChange={(e) => setExchangeReplacementSkuId(e.target.value)}
                      className="w-full rounded-sm border border-border p-2 text-sm text-ink"
                    >
                      {exchangeOptions.length === 0 && <option value="">No other sizes/colours currently in stock</option>}
                      {exchangeOptions.map((opt) => (
                        <option key={opt.skuId} value={opt.skuId}>
                          {opt.colourName} - {opt.sizeLabel}
                        </option>
                      ))}
                    </select>
                    <label htmlFor={`exchange-reason-${line.id}`} className="block text-xs text-ink-muted">
                      Reason (required)
                    </label>
                    <textarea
                      id={`exchange-reason-${line.id}`}
                      value={exchangeReason}
                      onChange={(e) => setExchangeReason(e.target.value)}
                      className="w-full rounded-sm border border-border p-2 text-sm text-ink"
                      rows={2}
                      required
                    />
                    <fieldset className="flex gap-4">
                      <legend className="text-xs text-ink-muted">How would you like to send the original back?</legend>
                      <label className="flex min-h-[44px] items-center gap-1 text-xs text-ink">
                        <input type="radio" name={`exchange-method-${line.id}`} checked={exchangeMethod === 'PICKUP'} onChange={() => setExchangeMethod('PICKUP')} />
                        Carrier pickup
                      </label>
                      <label className="flex min-h-[44px] items-center gap-1 text-xs text-ink">
                        <input type="radio" name={`exchange-method-${line.id}`} checked={exchangeMethod === 'DROP_OFF'} onChange={() => setExchangeMethod('DROP_OFF')} />
                        Drop-off
                      </label>
                    </fieldset>
                    {exchangeError && (
                      <p role="alert" className="text-xs text-danger">
                        {exchangeError}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button type="button" variant="primary" disabled={exchangeInFlight || exchangeOptions.length === 0} onClick={() => confirmExchange(line.id)}>
                        {exchangeInFlight ? 'Submitting...' : 'Start exchange'}
                      </Button>
                      <Button type="button" variant="ghost" disabled={exchangeInFlight} onClick={() => setExchangingLineId(null)}>
                        Never mind
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </li>
          ))}
        </ul>

        {order.fulfilments.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium text-ink">Shipments</p>
            {order.fulfilments.map((f) => (
              <p key={f.id} className="text-sm text-ink-muted">
                {f.status === 'DELIVERED' ? 'Delivered' : f.status === 'SHIPPED' ? 'Shipped' : f.status === 'PACKED' ? 'Packed' : 'Preparing'}
                {f.carrierName ? ` via ${f.carrierName}` : ''}
                {f.trackingRef ? ` (${f.trackingRef})` : ''}
                {/* M17: last-known platform tracking status - shown only
                    once a shipment exists; gracefully omitted otherwise
                    rather than showing an error (acceptance negative
                    scenario #1). */}
                {f.shipment ? ` — ${SHIPMENT_STATUS_LABEL[f.shipment.status] ?? f.shipment.status}` : ''}
              </p>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-between border-t border-border pt-4 text-sm font-medium">
          <span className="text-ink">Total</span>
          <span className="text-ink">&#8377;{order.grandTotal}</span>
        </div>
      </div>

      <Link href="/orders" className={buttonClassName('primary', 'mt-6')}>
        Back to orders
      </Link>
    </Container>
  );
}
