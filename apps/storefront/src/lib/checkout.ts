'use client';

/**
 * Checkout client (M13, specs/12-checkout.md). Browser-originated, same
 * guest-or-customer identity pattern as lib/cart.ts (CART-001/CHK-001) -
 * checkout is reachable without ever creating an account.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const GUEST_HEADER = 'x-guest-session-id';
const GUEST_SESSION_KEY = 'fcp_guest_session_id';
const CUSTOMER_SESSION_KEY = 'fcp_customer_session';

function getGuestSessionId(): string {
  try {
    const existing = localStorage.getItem(GUEST_SESSION_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(GUEST_SESSION_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function getStoredCustomerToken(): string | null {
  try {
    const raw = localStorage.getItem(CUSTOMER_SESSION_KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as { accessToken: string }).accessToken;
  } catch {
    return null;
  }
}

function identityHeaders(): Record<string, string> {
  const token = getStoredCustomerToken();
  if (token) return { authorization: `Bearer ${token}` };
  return { [GUEST_HEADER]: getGuestSessionId() };
}

async function checkoutFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...identityHeaders(), ...init?.headers },
  });
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

export interface CheckoutPreview {
  isServiceable: boolean;
  codAvailable: boolean;
  knownPincode: boolean;
  lines: { skuId: string; quantity: number; unitPriceInclusive: number; lineTotalInclusive: number }[];
  subtotal: number;
  taxAmount: number;
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
}

export interface CheckoutSessionView {
  id: string;
  status: 'STARTED' | 'RESERVED' | 'CONFIRMED' | 'PAYMENT_FAILED' | 'CANCELLED' | 'EXPIRED';
  paymentMethod: 'PREPAID' | 'COD';
  payment: { status: string; message?: string } | null;
  contactName: string;
  contactMobile: string;
  shippingAddress: Address;
  billingAddress: Address;
  shippingCost: number;
  subtotal: number;
  taxAmount: number;
  grandTotal: number;
  currency: string;
  lines: { skuId: string; styleName: string; colourName: string; sizeLabel: string; quantity: number; unitPriceInclusive: number; lineTotalInclusive: number }[];
  createdAt: string;
  confirmedAt: string | null;
}

export const previewCheckout = (shippingAddress: Address) =>
  checkoutFetch<CheckoutPreview>('/api/v1/storefront/checkout/preview', {
    method: 'POST',
    body: JSON.stringify({ shippingAddress }),
  });

export const startCheckout = (input: StartCheckoutInput) =>
  checkoutFetch<CheckoutSessionView>('/api/v1/storefront/checkout', { method: 'POST', body: JSON.stringify(input) });

export const getCheckoutSession = (id: string) => checkoutFetch<CheckoutSessionView>(`/api/v1/storefront/checkout/${id}`);
