'use client';

/**
 * Exchanges client (M21, specs/20-exchanges.md). Same guest-or-customer
 * identity pattern as lib/orders.ts/lib/returns.ts. Replacement options
 * are read from the existing PDP endpoint (GET /storefront/products/:styleId)
 * rather than a new one - it already returns every variant (colour AND
 * size) of a style with live stock, exactly what "both size and colour
 * exchange are supported" needs.
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

async function exchangesFetch<T>(path: string, init?: RequestInit): Promise<T> {
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

export interface ExchangeView {
  id: string;
  exchangeNumber: string;
  orderId: string;
  orderLineId: string;
  replacementSkuId: string;
  status: 'REQUESTED' | 'PICKUP_SCHEDULED' | 'PICKED_UP' | 'RECEIVED' | 'COMPLETED' | 'QC_FAILED' | 'REPLACEMENT_UNAVAILABLE' | 'CANCELLED';
  paymentDirection: 'CUSTOMER_PAYS' | 'STORE_CREDIT' | 'EVEN';
  paymentStatus: 'NOT_REQUIRED' | 'PENDING' | 'CAPTURED' | 'FAILED';
  priceDifference: string;
  cancelledAt: string | null;
  cancelledReason: string | null;
}

export interface ReplacementOption {
  skuId: string;
  colourName: string;
  sizeLabel: string;
  inStock: boolean;
}

/** Reuses the PDP product-detail endpoint - every variant of the style, live stock. */
export const listReplacementOptions = async (styleId: string): Promise<ReplacementOption[]> => {
  const detail = await exchangesFetch<{ variants: ReplacementOption[] }>(`/api/v1/storefront/products/${styleId}`);
  return detail.variants;
};

export const initiateMyExchange = (
  orderId: string,
  orderLineId: string,
  replacementSkuId: string,
  reason: string,
  method: 'PICKUP' | 'DROP_OFF',
) =>
  exchangesFetch<ExchangeView>('/api/v1/storefront/exchanges', {
    method: 'POST',
    body: JSON.stringify({ orderId, orderLineId, replacementSkuId, reason, method, idempotencyKey: crypto.randomUUID() }),
  });

export const listMyExchanges = () => exchangesFetch<ExchangeView[]>('/api/v1/storefront/exchanges');
export const cancelMyExchange = (id: string, reason?: string) =>
  exchangesFetch<ExchangeView>(`/api/v1/storefront/exchanges/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
export const initiateMyExchangePayment = (id: string) =>
  exchangesFetch<{ providerOrderId: string; publicKeyId?: string; amount: number }>(`/api/v1/storefront/exchanges/${id}/pay`, { method: 'POST' });
