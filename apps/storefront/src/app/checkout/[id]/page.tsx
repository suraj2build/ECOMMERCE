'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { buttonClassName } from '@/components/ui/Button';
import { getCheckoutSession, type CheckoutSessionView } from '@/lib/checkout';

/**
 * Checkout confirmation (M13). Honestly reflects two distinct outcomes:
 * COD orders are genuinely CONFIRMED here (no external gateway needed -
 * specs/13-payment.md); prepaid orders are RESERVED with payment still
 * INITIATED, since completing online payment is M14's own scope, not
 * built here. Never shows a fake "order confirmed" for the prepaid case.
 */
export default function CheckoutConfirmationPage() {
  const params = useParams<{ id: string }>();
  const [session, setSession] = useState<CheckoutSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCheckoutSession(params.id)
      .then(setSession)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your order.'));
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

  if (!session) {
    return (
      <Container className="py-8">
        <p className="text-sm text-ink-muted">Loading...</p>
      </Container>
    );
  }

  return (
    <Container className="py-8">
      {session.status === 'CONFIRMED' ? (
        <>
          <h1 className="font-display text-2xl text-ink">Order placed</h1>
          <p role="status" className="mt-2 text-sm text-ink-muted">
            Thank you, {session.contactName} - your Cash on Delivery order is confirmed.
          </p>
        </>
      ) : (
        <>
          <h1 className="font-display text-2xl text-ink">Order created - payment pending</h1>
          <p role="status" className="mt-2 text-sm text-ink-muted">
            {session.payment?.message ?? 'Your items are reserved. Complete payment to confirm your order.'}
          </p>
        </>
      )}

      <div className="mt-6 rounded-sm border border-border p-6">
        <p className="text-sm text-ink-muted">Order reference</p>
        <p className="text-sm text-ink">{session.id}</p>

        <ul className="mt-4 space-y-3 border-t border-border pt-4">
          {session.lines.map((line) => (
            <li key={line.skuId} className="flex justify-between text-sm">
              <span className="text-ink">
                {line.styleName} - {line.colourName} - {line.sizeLabel} x{line.quantity}
              </span>
              <span className="text-ink">&#8377;{line.lineTotalInclusive}</span>
            </li>
          ))}
        </ul>

        <div className="mt-4 space-y-1 border-t border-border pt-4 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">Subtotal</span>
            <span className="text-ink">&#8377;{session.subtotal}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">Shipping</span>
            <span className="text-ink">{session.shippingCost === 0 ? 'Free' : `₹${session.shippingCost}`}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span className="text-ink">Total</span>
            <span className="text-ink">&#8377;{session.grandTotal}</span>
          </div>
        </div>
      </div>

      <Link href="/" className={buttonClassName('primary', 'mt-6')}>
        Continue shopping
      </Link>
    </Container>
  );
}
