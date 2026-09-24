'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { buttonClassName } from '@/components/ui/Button';
import { getMyOrder, type OrderView } from '@/lib/orders';

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

  useEffect(() => {
    getMyOrder(params.id)
      .then(setOrder)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load this order.'));
  }, [params.id]);

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
            <li key={line.id} className="flex items-center justify-between border-b border-border pb-4 text-sm last:border-b-0 last:pb-0">
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
