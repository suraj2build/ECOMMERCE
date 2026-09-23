import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadEnv } from '@fcp/config';

/**
 * Payment provider abstraction (ADR-0011, specs/13-payment.md).
 * Checkout/webhook logic depends only on this interface, never a
 * specific provider's SDK directly. `CodPaymentProvider` is a complete,
 * real implementation - COD genuinely needs no external gateway, so it
 * fully "pays" itself at order acceptance. `RazorpayPaymentProvider`
 * (M14) is a real implementation calling Razorpay's REST API directly
 * over `fetch` with HTTP Basic Auth (key_id:key_secret) - no SDK
 * dependency, since the surface used here (create order, capture,
 * refund, verify a webhook HMAC signature) is a handful of plain REST
 * calls. It fails safe to an honest "unavailable" result whenever
 * RAZORPAY_KEY_ID/KEY_SECRET aren't configured, the same fail-safe-
 * when-unconfigured discipline M08's tax engine already established,
 * rather than crashing or fabricating a fake success.
 */

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';

export type PaymentProviderName = 'RAZORPAY' | 'COD';

export interface PaymentInitiateInput {
  checkoutSessionId: string;
  amount: number; // INR, tax-inclusive grand total
  idempotencyKey: string;
}

export interface PaymentInitiateResult {
  status: 'INITIATED' | 'CONFIRMED' | 'UNAVAILABLE';
  providerReferenceId?: string;
  /** Only meaningful for RAZORPAY - the public key the storefront's Checkout.js needs. Never the secret. */
  publicKeyId?: string;
  message?: string;
}

export interface WebhookEvent {
  providerEventId: string;
  eventType: string;
  /**
   * Razorpay's ORDER id (order_xxx) - what we stored on
   * Payment.providerReferenceId at initiate() time, before any payment
   * entity exists yet. Present on payment.* events.
   */
  orderId?: string;
  /**
   * Razorpay's actual PAYMENT id (pay_xxx) - a distinct id from the
   * order id, only known once a payment attempt exists. PaymentService
   * swaps Payment.providerReferenceId to this value on capture, so
   * later refund.* events (which carry payment_id but not order_id)
   * still correlate correctly.
   */
  paymentEntityId?: string;
  outcome: 'CAPTURED' | 'FAILED' | 'REFUNDED' | 'OTHER';
}

export interface RefundResult {
  providerRefundId: string;
  status: 'processed' | 'pending';
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  initiate(input: PaymentInitiateInput): Promise<PaymentInitiateResult>;
  /** Verifies a raw webhook body against the provider's signature header. Never throws - returns false on any mismatch/misconfiguration. */
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean;
  /** Parses an already-signature-verified raw webhook body into a provider-agnostic event. Throws on a shape it doesn't recognize. */
  parseWebhookEvent(rawBody: string): WebhookEvent;
  refund(providerReferenceId: string, amount: number): Promise<RefundResult>;
}

/**
 * COD (specs/13-payment.md): `initiated -> confirmed`, no capture step,
 * no external gateway, no webhooks - payment is collected by the
 * delivery partner at delivery, reconciled operationally (a required
 * process, not built here - it depends on a delivery-partner
 * integration this platform doesn't have). Refund-for-COD (refund-to-
 * bank/UPI after the fact, per ADR-0011) is a real requirement but a
 * distinct workflow that belongs to specs/19-refunds.md's own
 * milestone, not built here.
 */
export class CodPaymentProvider implements PaymentProvider {
  readonly name: PaymentProviderName = 'COD';

  async initiate(_input: PaymentInitiateInput): Promise<PaymentInitiateResult> {
    return { status: 'CONFIRMED' };
  }

  verifyWebhookSignature(): boolean {
    return false; // COD never receives webhooks - any purported one is bogus by definition
  }

  parseWebhookEvent(): WebhookEvent {
    throw new Error('COD does not support webhooks');
  }

  async refund(): Promise<RefundResult> {
    throw new Error(
      'COD refund-to-bank/UPI is a distinct operational workflow (specs/19-refunds.md) not yet built - not supported here',
    );
  }
}

interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

function loadRazorpayCredentials(): RazorpayCredentials | null {
  const env = loadEnv();
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return null;
  return { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET };
}

/**
 * Real Razorpay integration: hosted/tokenized Checkout.js flow (the
 * platform never touches raw card data, PAY-006), REST calls only,
 * auto-capture relied on rather than a manual capture step (Razorpay's
 * default) - the webhook `payment.captured` event is the authoritative
 * confirmation, not the client-side redirect, since the client-side
 * step can be interrupted/spoofed.
 */
export class RazorpayPaymentProvider implements PaymentProvider {
  readonly name: PaymentProviderName = 'RAZORPAY';

  private authHeader(creds: RazorpayCredentials): string {
    return `Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString('base64')}`;
  }

  async initiate(input: PaymentInitiateInput): Promise<PaymentInitiateResult> {
    const creds = loadRazorpayCredentials();
    if (!creds) {
      return {
        status: 'UNAVAILABLE',
        message: 'Online payment is coming soon. Please choose Cash on Delivery to complete your order today.',
      };
    }

    // Amount in paise, Razorpay's smallest-unit convention.
    const amountPaise = Math.round(input.amount * 100);

    const res = await fetch(`${RAZORPAY_API_BASE}/orders`, {
      method: 'POST',
      headers: {
        authorization: this.authHeader(creds),
        'content-type': 'application/json',
        // Razorpay's own idempotency mechanism for order creation.
        'x-razorpay-idempotency-key': input.idempotencyKey,
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: input.checkoutSessionId,
      }),
    });

    if (!res.ok) {
      // Deliberately not throwing here - a Razorpay-side outage must
      // degrade to the same honest "unavailable" UX as being
      // unconfigured, never a raw 500 to the customer. Full detail is
      // logged for operators, never surfaced to the client.
      const body = await res.text().catch(() => '<unreadable>');
      console.error('Razorpay order creation failed', { status: res.status, body });
      return {
        status: 'UNAVAILABLE',
        message: 'We could not start online payment right now. Please try again or choose Cash on Delivery.',
      };
    }

    const order = (await res.json()) as { id: string };
    return { status: 'INITIATED', providerReferenceId: order.id, publicKeyId: creds.keyId };
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    const creds = loadRazorpayCredentials();
    if (!creds || !creds.webhookSecret || !signatureHeader) return false;

    const expected = createHmac('sha256', creds.webhookSecret).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(signatureHeader, 'hex');
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  }

  parseWebhookEvent(rawBody: string): WebhookEvent {
    const payload = JSON.parse(rawBody) as {
      id?: string;
      event: string;
      payload: {
        payment?: { entity?: { id: string; order_id?: string } };
        refund?: { entity?: { id: string; payment_id?: string } };
      };
    };

    const outcome: WebhookEvent['outcome'] =
      payload.event === 'payment.captured'
        ? 'CAPTURED'
        : payload.event === 'payment.failed'
          ? 'FAILED'
          : payload.event === 'refund.processed'
            ? 'REFUNDED'
            : 'OTHER';

    const orderId = payload.payload.payment?.entity?.order_id;
    const paymentEntityId = payload.payload.payment?.entity?.id ?? payload.payload.refund?.entity?.payment_id;

    // Razorpay webhook payloads don't always carry a top-level event id
    // in every account configuration - fall back to a stable synthetic
    // id derived from the entity + event type so dedup still works
    // (an actual duplicate delivery repeats the exact same body).
    const providerEventId = payload.id ?? `${payload.event}:${paymentEntityId ?? orderId ?? ''}`;

    return { providerEventId, eventType: payload.event, orderId, paymentEntityId, outcome };
  }

  async refund(providerReferenceId: string, amount: number): Promise<RefundResult> {
    const creds = loadRazorpayCredentials();
    if (!creds) throw new Error('Razorpay is not configured - cannot issue a refund');

    const res = await fetch(`${RAZORPAY_API_BASE}/payments/${providerReferenceId}/refund`, {
      method: 'POST',
      headers: { authorization: this.authHeader(creds), 'content-type': 'application/json' },
      body: JSON.stringify({ amount: Math.round(amount * 100) }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>');
      throw new Error(`Razorpay refund failed: ${res.status} ${body}`);
    }
    const refund = (await res.json()) as { id: string; status: string };
    return { providerRefundId: refund.id, status: refund.status === 'processed' ? 'processed' : 'pending' };
  }
}

export function resolvePaymentProvider(name: PaymentProviderName): PaymentProvider {
  return name === 'COD' ? new CodPaymentProvider() : new RazorpayPaymentProvider();
}
