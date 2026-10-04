'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { buttonClassName } from '@/components/ui/Button';
import { getCheckoutSession, retryPayment, type CheckoutSessionView } from '@/lib/checkout';
import { openRazorpayCheckout } from '@/lib/razorpay';
import { track } from '@/lib/tracking';

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 20; // ~40s - the webhook is typically near-instant; this just bounds the UI wait

/**
 * Checkout confirmation (M13/M14). Honestly reflects real outcomes:
 * COD orders are genuinely CONFIRMED here (no external gateway needed -
 * specs/13-payment.md). Prepaid orders open Razorpay's hosted,
 * tokenized Checkout.js widget (PAY-006) when a real attempt is in
 * flight (RAZORPAY_KEY_ID configured); when it isn't, the honest
 * "coming soon" fallback from M13 still shows - never a fake "order
 * confirmed". The widget's own success callback is never trusted as
 * confirmation - only the webhook-driven session status is (polled
 * briefly here for UI feedback while the webhook lands).
 */
export default function CheckoutConfirmationPage() {
  const params = useParams<{ id: string }>();
  const [session, setSession] = useState<CheckoutSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const autoOpenedFor = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await getCheckoutSession(params.id);
    setSession(next);
    return next;
  }, [params.id]);

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load your order.'));
  }, [refresh]);

  const pollUntilSettled = useCallback(async () => {
    setProcessing(true);
    try {
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const next = await refresh();
        if (next.status !== 'RESERVED') return; // CONFIRMED, PAYMENT_FAILED, or EXPIRED - settled
      }
    } finally {
      setProcessing(false);
    }
  }, [refresh]);

  const openWidget = useCallback(
    (target: CheckoutSessionView) => {
      if (!target.payment?.providerOrderId || !target.payment.providerPublicKeyId) return;
      setActionError(null);
      openRazorpayCheckout({
        orderId: target.payment.providerOrderId,
        publicKeyId: target.payment.providerPublicKeyId,
        amountInclusive: target.grandTotal,
        contactName: target.contactName,
        contactMobile: target.contactMobile,
        onSuccess: () => void pollUntilSettled(),
        onDismiss: () => {
          /* Customer closed the widget - session stays RESERVED/INITIATED; the "Pay now" button lets them reopen it. */
        },
      }).catch((err) => setActionError(err instanceof Error ? err.message : 'Could not open the payment window.'));
    },
    [pollUntilSettled],
  );

  // Auto-open the widget once, the first time a fresh Razorpay attempt is ready.
  useEffect(() => {
    if (!session || session.status !== 'RESERVED' || session.payment?.status !== 'INITIATED') return;
    if (!session.payment.providerOrderId) return;
    if (autoOpenedFor.current === session.payment.providerOrderId) return;
    autoOpenedFor.current = session.payment.providerOrderId;
    openWidget(session);
  }, [session, openWidget]);

  // LR-003/LR-009: a purchase only once a prepaid payment is captured (the
  // webhook-driven CONFIRMED status) - never on the payment button. Same
  // event_id as the server's Conversions API event. A COD order is not a
  // purchase here: the server reports it as placed, and as a purchase only
  // after delivery and confirmed cash collection.
  useEffect(() => {
    if (session?.status !== 'CONFIRMED' || !session.orderNumber || session.paymentMethod !== 'PREPAID') return;
    track.purchase(
      session.orderNumber,
      session.grandTotal,
      session.lines.map((l) => ({ skuCode: l.skuCode, styleCode: l.styleCode, name: l.styleName, price: l.unitPriceInclusive, quantity: l.quantity })),
    );
  }, [session]);

  async function handleRetry() {
    if (!session) return;
    setActionError(null);
    try {
      const next = await retryPayment(session.id, `${session.id}-retry-${Date.now()}`);
      setSession(next);
      if (next.payment?.providerOrderId) {
        autoOpenedFor.current = null; // allow the fresh attempt to auto-open
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not retry payment.');
    }
  }

  if (error) {
    return (
      <Container className="py-10 sm:py-14">
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      </Container>
    );
  }

  if (!session) {
    return (
      <Container className="py-10 sm:py-14">
        <p className="text-sm text-[#6e6359]">Loading...</p>
      </Container>
    );
  }

  const canRetry = session.status === 'PAYMENT_FAILED';
  const canReopenWidget = session.status === 'RESERVED' && session.payment?.status === 'INITIATED' && !!session.payment.providerOrderId;

  return (
    <Container className="py-10 sm:py-14">
      {session.status === 'CONFIRMED' ? (
        <>
          <h1 className="font-display text-4xl text-[#181716] sm:text-5xl">Order placed</h1>
          <p role="status" className="mt-2 text-sm text-[#6e6359]">
            Thank you, {session.contactName} - your {session.paymentMethod === 'COD' ? 'Cash on Delivery' : ''} order is confirmed.
          </p>
        </>
      ) : session.status === 'PAYMENT_FAILED' ? (
        <>
          <h1 className="font-display text-4xl text-[#181716] sm:text-5xl">Payment did not go through</h1>
          <p role="status" className="mt-2 text-sm text-[#6e6359]">
            Your items are still reserved. You can retry payment below.
          </p>
        </>
      ) : session.status === 'EXPIRED' ? (
        <>
          <h1 className="font-display text-4xl text-[#181716] sm:text-5xl">This checkout has expired</h1>
          <p role="status" className="mt-2 text-sm text-[#6e6359]">
            Your reservation window has passed - please start a new checkout.
          </p>
        </>
      ) : (
        <>
          <h1 className="font-display text-4xl text-[#181716] sm:text-5xl">Order created - payment pending</h1>
          <p role="status" className="mt-2 text-sm text-[#6e6359]">
            {processing
              ? 'Confirming your payment...'
              : (session.payment?.message ?? 'Your items are reserved. Complete payment to confirm your order.')}
          </p>
        </>
      )}

      {actionError && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {actionError}
        </p>
      )}

      {canReopenWidget && !processing && (
        <button type="button" onClick={() => openWidget(session)} className={buttonClassName('primary', 'mt-4')}>
          Pay now
        </button>
      )}
      {canRetry && (
        <button type="button" onClick={() => void handleRetry()} className={buttonClassName('primary', 'mt-4')}>
          Retry payment
        </button>
      )}

      <div className="mt-8 rounded-[24px] border border-[#e6ddd0] bg-white p-6 sm:p-8">
        <p className="text-sm text-[#6e6359]">Order reference</p>
        <p className="text-sm text-[#181716]">{session.id}</p>

        <ul className="mt-4 space-y-3 border-t border-border pt-4">
          {session.lines.map((line) => (
            <li key={line.skuId} className="flex justify-between text-sm">
              <span className="text-[#181716]">
                {line.styleName} - {line.colourName} - {line.sizeLabel} x{line.quantity}
              </span>
              <span className="text-[#181716]">&#8377;{line.lineTotalInclusive}</span>
            </li>
          ))}
        </ul>

        <div className="mt-4 space-y-1 border-t border-border pt-4 text-sm">
          {session.promotionDiscountTotal > 0 && (
            <div className="flex justify-between">
              <span className="text-[#6e6359]">Promotion discount</span>
              <span className="text-[#181716]">-&#8377;{session.promotionDiscountTotal}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-[#6e6359]">Subtotal</span>
            <span className="text-[#181716]">&#8377;{session.subtotal}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#6e6359]">Shipping</span>
            <span className="text-[#181716]">{session.shippingCost === 0 ? 'Free' : `₹${session.shippingCost}`}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#6e6359]">Total</span>
            <span className="text-[#181716]">&#8377;{session.grandTotal}</span>
          </div>
          {session.loyaltyPointsRedeemed > 0 && (
            <div className="flex justify-between">
              <span className="text-[#6e6359]">Loyalty points redeemed ({session.loyaltyPointsRedeemed} pts)</span>
              <span className="text-[#181716]">-&#8377;{session.loyaltyRedemptionValue}</span>
            </div>
          )}
          {session.storeCreditApplied > 0 && (
            <div className="flex justify-between">
              <span className="text-[#6e6359]">Store credit applied</span>
              <span className="text-[#181716]">-&#8377;{session.storeCreditApplied}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-2 font-medium">
            <span className="text-[#181716]">Amount payable</span>
            <span className="text-[#181716]">&#8377;{session.amountPayable}</span>
          </div>
        </div>
      </div>

      <Link href="/" className={buttonClassName('primary', 'mt-6')}>
        Continue shopping
      </Link>
    </Container>
  );
}
