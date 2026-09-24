'use client';

/**
 * Order history client (M15, specs/14-order-management.md - "Full order
 * history MUST be retained and queryable for the customer's account").
 * Same guest-or-customer identity pattern as lib/checkout.ts - orders
 * are readable by the same identity that placed them, logged in or not.
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

async function ordersFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: identityHeaders() });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface OrderLineView {
  id: string;
  skuId: string;
  styleName: string;
  colourName: string;
  sizeLabel: string;
  quantity: number;
  unitPriceInclusive: number;
  lineTotalInclusive: number;
  status: 'ALLOCATED' | 'PACKED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'EXCEPTION';
  cancelledAt: string | null;
  cancelledReason: string | null;
}

/**
 * M17 (specs/16-shipping-tracking.md): last-known platform tracking
 * status, sourced from ShippingService's carrier-adapter-normalized
 * state machine - never carrier-specific vocabulary. `null` when no
 * shipment has been booked yet for this fulfilment (an expected,
 * pre-shipping state, not an error).
 */
export interface ShipmentView {
  id: string;
  provider: string;
  trackingRef: string | null;
  status:
    | 'CREATED'
    | 'BOOKED'
    | 'IN_TRANSIT'
    | 'OUT_FOR_DELIVERY'
    | 'DELIVERY_FAILED'
    | 'DELIVERED'
    | 'RTO_INITIATED'
    | 'RTO_DELIVERED';
  deliveryAttempts: number;
  maxDeliveryAttempts: number;
  bookedAt: string | null;
  deliveredAt: string | null;
  rtoInitiatedAt: string | null;
  rtoDeliveredAt: string | null;
  updatedAt: string;
}

export interface OrderFulfilmentView {
  id: string;
  status: 'PENDING' | 'PACKED' | 'READY_TO_SHIP' | 'SHIPPED' | 'DELIVERED';
  carrierName: string | null;
  trackingRef: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  shipment: ShipmentView | null;
}

export interface OrderView {
  id: string;
  orderNumber: string;
  status: 'CONFIRMED' | 'PROCESSING' | 'DELIVERED' | 'CANCELLED' | 'RTO' | 'EXCEPTION';
  paymentMethod: 'PREPAID' | 'COD';
  refundRequired: boolean;
  grandTotal: number;
  currency: string;
  lines: OrderLineView[];
  fulfilments: OrderFulfilmentView[];
  createdAt: string;
}

export const listMyOrders = () => ordersFetch<OrderView[]>('/api/v1/storefront/orders');
export const getMyOrder = (id: string) => ordersFetch<OrderView>(`/api/v1/storefront/orders/${id}`);
