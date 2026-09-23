'use client';

/**
 * Cart / Wishlist client (M12, specs/11-wishlist-cart.md, CART-001).
 * Every call here is browser-originated (unlike the server-side reads in
 * lib/api.ts) since cart/wishlist state is per-visitor, never something
 * Next.js should cache or render server-side. A guest is identified by a
 * client-generated session id persisted in localStorage (the device/
 * session identifier CART-001 calls for); a logged-in customer's bearer
 * token, when present, always takes priority - see identity.ts on the
 * API side for the matching server-side resolution.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const GUEST_SESSION_KEY = 'fcp_guest_session_id';
const GUEST_HEADER = 'x-guest-session-id';
// Duplicated from customer-auth.ts's STORAGE_KEY rather than imported, to
// keep this module import-free of customer-auth.ts (customer-auth.ts
// calls INTO this module after login to trigger the guest->account
// merge - importing back the other way would create a cycle).
const CUSTOMER_SESSION_KEY = 'fcp_customer_session';

export function getGuestSessionId(): string {
  try {
    const existing = localStorage.getItem(GUEST_SESSION_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(GUEST_SESSION_KEY, id);
    return id;
  } catch {
    // Private browsing / blocked storage: a fresh id every call means no
    // persistence, but the app still functions for the current page view.
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

async function cartFetch<T>(path: string, init?: RequestInit): Promise<T> {
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

export interface CartItemView {
  skuId: string;
  skuCode: string;
  styleId: string;
  styleName: string;
  colourName: string;
  sizeLabel: string;
  imageUrl: string | null;
  quantity: number;
  priceAtAdd: number;
  currentPrice: number | null;
  priceChanged: boolean;
  availableQuantity: number;
  inStock: boolean;
  isPurchasable: boolean;
}

export interface CartView {
  id: string;
  items: CartItemView[];
  itemCount: number;
  subtotal: number;
  hasBlockingChanges: boolean;
}

export interface WishlistItemView {
  skuId: string;
  skuCode: string;
  styleId: string;
  styleName: string;
  colourName: string;
  sizeLabel: string;
  imageUrl: string | null;
  currentPrice: number | null;
  availableQuantity: number;
  inStock: boolean;
  isPurchasable: boolean;
  addedAt: string;
}

export const getCart = () => cartFetch<CartView>('/api/v1/storefront/cart');

export const addToCart = (skuId: string, quantity = 1) =>
  cartFetch<CartView>('/api/v1/storefront/cart/items', { method: 'POST', body: JSON.stringify({ skuId, quantity }) });

export const updateCartItemQuantity = (skuId: string, quantity: number) =>
  cartFetch<CartView>(`/api/v1/storefront/cart/items/${skuId}`, { method: 'PATCH', body: JSON.stringify({ quantity }) });

export const removeCartItem = (skuId: string) =>
  cartFetch<CartView>(`/api/v1/storefront/cart/items/${skuId}`, { method: 'DELETE' });

export const getWishlist = () => cartFetch<WishlistItemView[]>('/api/v1/storefront/wishlist');

export const addToWishlist = (skuId: string) =>
  cartFetch<WishlistItemView[]>('/api/v1/storefront/wishlist/items', { method: 'POST', body: JSON.stringify({ skuId }) });

export const removeFromWishlist = (skuId: string) =>
  cartFetch<WishlistItemView[]>(`/api/v1/storefront/wishlist/items/${skuId}`, { method: 'DELETE' });

export const moveWishlistItemToCart = (skuId: string, quantity = 1) =>
  cartFetch<CartView>(`/api/v1/storefront/wishlist/items/${skuId}/move-to-cart`, {
    method: 'POST',
    body: JSON.stringify({ quantity }),
  });

/**
 * Called once, right after a successful OTP login (CART-001: "merges
 * into the account cart on login"). Uses the just-issued token directly
 * rather than identityHeaders() - the caller (customer-auth.ts) hasn't
 * necessarily persisted the session to localStorage yet at the moment
 * this fires, and merge is inherently an authenticated-customer action.
 * Best-effort: a merge failure shouldn't block the login itself.
 */
export async function mergeGuestCartAndWishlist(accessToken: string): Promise<void> {
  const guestSessionId = getGuestSessionId();
  const headers = { 'Content-Type': 'application/json', authorization: `Bearer ${accessToken}`, [GUEST_HEADER]: guestSessionId };
  try {
    await fetch(`${API_URL}/api/v1/storefront/cart/merge`, { method: 'POST', headers });
    await fetch(`${API_URL}/api/v1/storefront/wishlist/merge`, { method: 'POST', headers });
  } catch {
    // Best-effort - the customer is still logged in even if the merge call failed network-wise.
  }
}
