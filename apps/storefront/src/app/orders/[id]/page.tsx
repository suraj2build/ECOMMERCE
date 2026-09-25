'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Button, buttonClassName } from '@/components/ui/Button';
import { getMyOrder, cancelMyOrderLine, type OrderView } from '@/lib/orders';

// M18 (specs/17-cancellation.md, CAN-001): "before shipment" - convenience
// display only, the server (OrderService.performCancellation) is the sole
// authoritative eligibility check and re-validates against live state.
const CANCELLABLE_LINE_STATUSES = new Set(['ALLOCATED', 'PICKED', 'PACKED']);

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
  const [error, setError] = useState<string | null>(null);
  const [cancellingLineId, setCancellingLineId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelInFlight, setCancelInFlight] = useState(false);

  const refresh = () => getMyOrder(params.id).then(setOrder);

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load this order.'));
  }, [params.id]);

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
