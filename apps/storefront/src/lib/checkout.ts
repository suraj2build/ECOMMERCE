'use client';

import { getOrCreateGuestSessionToken, discardGuestSessionToken } from './guest-session';

/**
 * Checkout client (M13, specs/12-checkout.md). Browser-originated, same
 * guest-or-customer identity pattern as lib/cart.ts (CART-001/CHK-001) -
 * checkout is reachable without ever creating an account. The guest
 * identity is SERVER-ISSUED (M31, CART-004 - see guest-session.ts's own
 * docblock), never generated locally here.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const GUEST_HEADER = 'x-guest-session-id';
const CUSTOMER_SESSION_KEY = 'fcp_customer_session';

function getStoredCustomerToken(): string | null {
  try {
    const raw = localStorage.getItem(CUSTOMER_SESSION_KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as { accessToken: string }).accessToken;
  } catch {
    return null;
  }
}

async function identityHeaders(): Promise<Record<string, string>> {
  const token = getStoredCustomerToken();
  if (token) return { authorization: `Bearer ${token}` };
  return { [GUEST_HEADER]: await getOrCreateGuestSessionToken() };
}

async function checkoutFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const identity = await identityHeaders();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...identity, ...init?.headers },
  });
  if (res.status === 401 && identity[GUEST_HEADER]) discardGuestSessionToken(identity[GUEST_HEADER]);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface Address {
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
}

export interface AppliedPromotion {
  promotionId: string;
  name: string;
  isCoupon: boolean;
  discountAmount: number;
}

export interface CheckoutPreview {
  isServiceable: boolean;
  codAvailable: boolean;
  knownPincode: boolean;
  lines: { skuId: string; quantity: number; unitPriceInclusive: number; lineTotalInclusive: number }[];
  subtotal: number;
  taxAmount: number;
  promotionDiscountTotal: number;
  appliedPromotions: AppliedPromotion[];
  shippingCost: number;
  grandTotal: number;
}

export interface StartCheckoutInput {
  contactName: string;
  contactMobile: string;
  contactEmail?: string;
  billingAddress: Address;
  shippingAddress: Address;
  paymentMethod: 'PREPAID' | 'COD';
  idempotencyKey: string;
  // M23 (specs/22-loyalty.md) - ignored for a guest checkout (loyalty
  // requires a signed-in customer identity).
  loyaltyPointsToRedeem?: number;
  // M24 (specs/23-promotions.md) - server-revalidated at submission,
  // never trusted from a client-side preview computation alone.
  couponCode?: string;
  storeCreditToApply?: number;
}

export interface CheckoutSessionView {
  id: string;
  status: 'STARTED' | 'RESERVED' | 'CONFIRMED' | 'PAYMENT_FAILED' | 'CANCELLED' | 'EXPIRED';
  paymentMethod: 'PREPAID' | 'COD';
  payment: {
    status: string;
    message?: string;
    /** Present only while a real Razorpay attempt is in flight (INITIATED) - what Checkout.js needs to open. */
    providerOrderId?: string;
    providerPublicKeyId?: string;
  } | null;
  contactName: string;
  contactMobile: string;
  shippingAddress: Address;
  billingAddress: Address;
  shippingCost: number;
  subtotal: number;
  taxAmount: number;
  grandTotal: number;
  loyaltyPointsRedeemed: number;
  loyaltyRedemptionValue: number;
  storeCreditApplied: number;
  promotionDiscountTotal: number;
  amountPayable: number;
  currency: string;
  lines: { skuId: string; styleName: string; colourName: string; sizeLabel: string; quantity: number; unitPriceInclusive: number; lineTotalInclusive: number }[];
  createdAt: string;
  confirmedAt: string | null;
}

export const previewCheckout = (shippingAddress: Address, couponCode?: string) =>
  checkoutFetch<CheckoutPreview>('/api/v1/storefront/checkout/preview', {
    method: 'POST',
    body: JSON.stringify({ shippingAddress, couponCode: couponCode || undefined }),
  });

export const startCheckout = (input: StartCheckoutInput) =>
  checkoutFetch<CheckoutSessionView>('/api/v1/storefront/checkout', { method: 'POST', body: JSON.stringify(input) });

export const getCheckoutSession = (id: string) => checkoutFetch<CheckoutSessionView>(`/api/v1/storefront/checkout/${id}`);

export const retryPayment = (id: string, idempotencyKey: string) =>
  checkoutFetch<CheckoutSessionView>(`/api/v1/storefront/checkout/${id}/retry-payment`, {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey }),
  });
