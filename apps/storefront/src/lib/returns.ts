'use client';

/**
 * Returns client (M19, specs/18-returns.md). Same guest-or-customer
 * identity pattern as lib/orders.ts/lib/checkout.ts - a return is
 * readable/actionable by the same identity that placed the underlying
 * order, logged in or not.
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

async function returnsFetch<T>(path: string, init?: RequestInit): Promise<T> {
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

export interface ReturnLineView {
  id: string;
  orderLineId: string;
  skuId: string;
  quantity: number;
  reason: string;
  disposition: 'RESTOCK_SELLABLE' | 'RESTOCK_DAMAGED' | 'WRITE_OFF' | 'RETURN_TO_SUPPLIER' | null;
  qcResult: 'PASS' | 'FAIL' | 'PARTIAL' | null;
  refundEligible: boolean;
}

export interface ReturnView {
  id: string;
  returnNumber: string;
  orderId: string;
  status: 'REQUESTED' | 'PICKUP_SCHEDULED' | 'PICKED_UP' | 'RECEIVED' | 'DISPOSITIONED' | 'CANCELLED';
  method: 'PICKUP' | 'DROP_OFF';
  cancelledAt: string | null;
  cancelledReason: string | null;
  lines: ReturnLineView[];
  createdAt: string;
}

/**
 * `idempotencyKey` is client-generated (same `crypto.randomUUID()`
 * pattern lib/orders.ts's `cancelMyOrderLine` already uses) so a network
 * retry of this exact call never double-initiates the same return.
 */
export const initiateMyReturn = (
  orderId: string,
  lines: { orderLineId: string; reason: string }[],
  method: 'PICKUP' | 'DROP_OFF',
) =>
  returnsFetch<ReturnView>('/api/v1/storefront/returns', {
    method: 'POST',
    body: JSON.stringify({ orderId, lines, method, idempotencyKey: crypto.randomUUID() }),
  });

export const listMyReturns = () => returnsFetch<ReturnView[]>('/api/v1/storefront/returns');
export const getMyReturn = (id: string) => returnsFetch<ReturnView>(`/api/v1/storefront/returns/${id}`);
export const cancelMyReturn = (id: string, reason?: string) =>
  returnsFetch<ReturnView>(`/api/v1/storefront/returns/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
