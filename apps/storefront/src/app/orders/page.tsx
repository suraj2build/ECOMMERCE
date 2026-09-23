'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { buttonClassName } from '@/components/ui/Button';
import { listMyOrders, type OrderView } from '@/lib/orders';

const STATUS_LABEL: Record<OrderView['status'], string> = {
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  RTO: 'Returned to origin',
  EXCEPTION: 'Needs attention',
};

/**
 * Order history (M15, specs/14-order-management.md - "Full order
 * history MUST be retained and queryable for the customer's account").
 * Same guest-or-customer identity as Bag/Wishlist - a guest who never
 * created an account still sees their own order history in this
 * browser, no login required.
 */
export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hasIdentity =
      (() => {
        try {
          return !!(localStorage.getItem('fcp_guest_session_id') || localStorage.getItem('fcp_customer_session'));
        } catch {
          return false;
        }
      })();

    if (!hasIdentity) {
      setOrders([]);
      return;
    }

    listMyOrders()
      .then(setOrders)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your orders.'));
  }, []);

  return (
    <Container className="py-8">
      <h1 className="font-display text-2xl text-ink">Your Orders</h1>

      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}

      {orders === null && !error && <p className="mt-6 text-sm text-ink-muted">Loading...</p>}

      {orders !== null && orders.length === 0 && (
        <div className="mt-8">
          <p className="text-sm text-ink-muted">You have no orders yet.</p>
          <Link href="/" className={buttonClassName('primary', 'mt-4')}>
            Start shopping
          </Link>
        </div>
      )}

      {orders && orders.length > 0 && (
        <ul className="mt-6 space-y-4">
          {orders.map((order) => (
            <li key={order.id} className="rounded-sm border border-border p-4">
              <Link href={`/orders/${order.id}`} className="block">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-ink">{order.orderNumber}</span>
                  <span className="text-sm text-ink-muted">{STATUS_LABEL[order.status]}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm text-ink-muted">
                  <span>
                    {order.lines.length} item{order.lines.length === 1 ? '' : 's'}
                  </span>
                  <span>&#8377;{order.grandTotal}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
