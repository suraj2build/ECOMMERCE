'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listMyOrders, type OrderView } from '@/lib/orders';

const STATUS_LABEL: Record<OrderView['status'], string> = {
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  RTO: 'Returned to origin',
  EXCEPTION: 'Needs attention',
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let hasIdentity = false;
    try {
      hasIdentity = !!(localStorage.getItem('fcp_guest_session_id') || localStorage.getItem('fcp_customer_session'));
    } catch {
      // Storage may be unavailable in hardened/privacy browser contexts; empty history remains a safe fallback.
    }
    if (!hasIdentity) { setOrders([]); return; }
    listMyOrders().then(setOrders).catch((err) => setError(err instanceof Error ? err.message : 'Could not load your orders.'));
  }, []);

  return (
    <div className="mx-auto max-w-[1100px] px-gutter py-10 sm:py-14">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-primary)]">After purchase</p>
      <h1 className="mt-2 font-display text-4xl text-[#181716] sm:text-5xl">Your Orders</h1>
      {error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p> : null}
      {orders === null && !error ? <p className="mt-8 text-sm text-[#6e6359]">Loading orders…</p> : null}

      {orders && orders.length === 0 ? (
        <div className="mt-10 rounded-[24px] border border-[#e6ddd0] bg-white p-8 text-center">
          <h2 className="font-display text-2xl text-[#181716]">No orders yet</h2>
          <p className="mt-2 text-sm text-[#6e6359]">Your VANYA order history will appear here.</p>
          <Link href="/" className="mt-6 inline-flex min-h-[46px] items-center rounded-full bg-[#181716] px-7 text-xs font-semibold uppercase tracking-[0.14em] text-white">Start shopping</Link>
        </div>
      ) : null}

      {orders && orders.length > 0 ? (
        <ul className="mt-8 space-y-4">
          {orders.map((order) => (
            <li key={order.id}>
              <Link href={'/orders/' + order.id} className="block rounded-[20px] border border-[#e6ddd0] bg-white p-5 transition-all hover:-translate-y-0.5 hover:shadow-subtle sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6e6359]">Order</p>
                    <p className="mt-1 font-display text-xl text-[#181716]">{order.orderNumber}</p>
                  </div>
                  <span className="rounded-full bg-[var(--color-badge-bg)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-badge-text)]">{STATUS_LABEL[order.status]}</span>
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-[#eee7de] pt-4 text-sm">
                  <span className="text-[#6e6359]">{order.lines.length} item{order.lines.length === 1 ? '' : 's'}</span>
                  <span className="font-semibold text-[#181716]">&#8377;{order.grandTotal}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
