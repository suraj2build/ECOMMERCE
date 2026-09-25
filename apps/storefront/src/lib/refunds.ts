'use client';

/**
 * Refunds / store-credit client (M20, specs/19-refunds.md,
 * specs/33-store-credit-gift-cards.md). Same guest-or-customer identity
 * pattern as lib/orders.ts/lib/returns.ts - read-only from the
 * storefront (no checkout-time redemption flow exists yet - that is a
 * later milestone's scope, per specs/33's own milestone-ownership
 * section).
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const GUEST_HEADER = 'x-guest-session-id';
const GUEST_SESSION_KEY = 'fcp_guest_session_id';
const CUSTOMER_SESSION_KEY = 'fcp_customer_session';

function getGuestSessionId(): string | null {
  try {
    return localStorage.getItem(GUEST_SESSION_KEY);
  } catch {
    return null;
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
  const guestSessionId = getGuestSessionId();
  return guestSessionId ? { [GUEST_HEADER]: guestSessionId } : {};
}

async function refundsFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: { 'Content-Type': 'application/json', ...identityHeaders() } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface RefundView {
  id: string;
  orderId: string;
  orderLineId: string;
  triggerType: 'CANCELLATION' | 'RETURN';
  method: 'ORIGINAL_PAYMENT_METHOD' | 'STORE_CREDIT';
  amount: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
}

export interface StoreCreditView {
  balance: number;
  entries: { id: string; amount: string; reason: string; createdAt: string }[];
}

export const listMyOrderRefunds = (orderId: string) => refundsFetch<RefundView[]>(`/api/v1/storefront/orders/${orderId}/refunds`);
export const getMyStoreCredit = () => refundsFetch<StoreCreditView>('/api/v1/storefront/store-credit');
