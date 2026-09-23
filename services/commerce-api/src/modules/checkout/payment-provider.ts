/**
 * Payment provider abstraction (M13/ADR-0011, specs/13-payment.md).
 * Checkout depends only on this interface, never a specific provider's
 * SDK directly. `CodPaymentProvider` is a complete, real implementation -
 * COD genuinely needs no external gateway, so it fully "pays" itself at
 * order acceptance. `RazorpayPaymentProvider` is a real implementation of
 * the *interface* but is honest that it cannot complete a payment yet:
 * the actual Razorpay integration (hosted checkout, authorize/capture,
 * webhook signature verification) is M14's own scope. Calling it returns
 * a clear "not yet available" result rather than a fake success or a
 * confusing 500.
 */

export type PaymentProviderName = 'RAZORPAY' | 'COD';

export interface PaymentInitiateInput {
  amount: number;
  idempotencyKey: string;
}

export interface PaymentInitiateResult {
  status: 'INITIATED' | 'CONFIRMED' | 'UNAVAILABLE';
  providerReferenceId?: string;
  message?: string;
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  initiate(input: PaymentInitiateInput): Promise<PaymentInitiateResult>;
}

/**
 * COD (specs/13-payment.md): `initiated -> confirmed`, no capture step,
 * no external gateway - payment is collected by the delivery partner at
 * delivery, reconciled operationally (a required process, not built
 * here - it depends on the delivery-partner integration this platform
 * doesn't have yet). From the platform's own state-machine perspective
 * COD is trivially and immediately "confirmed" at order acceptance.
 */
export class CodPaymentProvider implements PaymentProvider {
  readonly name: PaymentProviderName = 'COD';

  async initiate(_input: PaymentInitiateInput): Promise<PaymentInitiateResult> {
    return { status: 'CONFIRMED' };
  }
}

/**
 * Real Razorpay integration (hosted/tokenized flow, UPI/cards/net
 * banking rails, authorize/capture/refund/webhook handling with
 * signature verification and idempotent event dedup) is M14's own
 * scope - not built here. This implementation exists so checkout's
 * prepaid path is structurally complete against the real interface
 * today, without a specific-provider dependency leaking into checkout
 * logic, and so M14 only has to change this one class.
 */
export class RazorpayPaymentProvider implements PaymentProvider {
  readonly name: PaymentProviderName = 'RAZORPAY';

  async initiate(_input: PaymentInitiateInput): Promise<PaymentInitiateResult> {
    return {
      status: 'UNAVAILABLE',
      message: 'Online payment is coming soon. Please choose Cash on Delivery to complete your order today.',
    };
  }
}

export function resolvePaymentProvider(name: PaymentProviderName): PaymentProvider {
  return name === 'COD' ? new CodPaymentProvider() : new RazorpayPaymentProvider();
}
