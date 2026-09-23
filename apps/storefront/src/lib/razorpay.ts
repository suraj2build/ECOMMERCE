'use client';

/**
 * Razorpay's hosted, tokenized Checkout.js widget (M14, specs/13-payment.md,
 * PAY-006 - the platform never handles raw card data, only opens
 * Razorpay's own script and reads back its own success callback).
 */

interface RazorpayCheckoutResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open(): void;
}

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  handler: (response: RazorpayCheckoutResponse) => void;
  modal?: { ondismiss?: () => void };
  prefill?: { name?: string; contact?: string };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let scriptPromise: Promise<void> | null = null;

function loadRazorpayScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Razorpay checkout is only available in the browser'));
  }
  if (window.Razorpay) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not load the payment provider - check your connection and try again.'));
      document.body.appendChild(script);
    });
  }
  return scriptPromise;
}

export async function openRazorpayCheckout(options: {
  orderId: string;
  publicKeyId: string;
  amountInclusive: number;
  contactName: string;
  contactMobile: string;
  onSuccess: () => void;
  onDismiss: () => void;
}): Promise<void> {
  await loadRazorpayScript();
  if (!window.Razorpay) throw new Error('Payment provider failed to load');

  const razorpay = new window.Razorpay({
    key: options.publicKeyId,
    order_id: options.orderId,
    // Razorpay's smallest-unit (paise) convention, matching the backend.
    amount: Math.round(options.amountInclusive * 100),
    currency: 'INR',
    name: 'HOUSE',
    // The client-side success callback is a UX hint only, never the
    // source of truth - the webhook (server-to-server) is what actually
    // confirms the order (specs/13-payment.md: "the webhook ...
    // authoritative confirmation, not the client-side redirect").
    handler: () => options.onSuccess(),
    modal: { ondismiss: options.onDismiss },
    prefill: { name: options.contactName, contact: options.contactMobile },
  });
  razorpay.open();
}
