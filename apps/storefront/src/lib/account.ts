'use client';

/**
 * M22 Customer 360 (specs/21-customer-profile.md) client. Every function
 * here is customer-authenticated-only - a Bearer token from
 * lib/customer-auth.ts's stored session is always required; there is no
 * guest fallback (unlike lib/orders.ts/cart.ts), matching the backend's
 * own `requireCustomerAuth`-only routes.
 */

import { getStoredSession } from './customer-auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

function authHeaders(): Record<string, string> {
  const session = getStoredSession();
  if (!session) throw new Error('You need to sign in to view your account.');
  return { authorization: `Bearer ${session.accessToken}` };
}

async function accountFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface CustomerProfile {
  id: string;
  mobile: string;
  email: string | null;
  fullName: string | null;
  mobileVerifiedAt: string | null;
  createdAt: string;
}

export const getProfile = () => accountFetch<CustomerProfile>('/api/v1/storefront/account/profile');
export const updateProfile = (input: { fullName?: string; email?: string }) =>
  accountFetch<CustomerProfile>('/api/v1/storefront/account/profile', { method: 'PATCH', body: JSON.stringify(input) });

export interface CustomerAddress {
  id: string;
  label: string | null;
  recipientName: string;
  recipientMobile: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AddressInput {
  label?: string;
  recipientName: string;
  recipientMobile: string;
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  isDefault?: boolean;
}

export const listAddresses = () => accountFetch<CustomerAddress[]>('/api/v1/storefront/account/addresses');
export const createAddress = (input: AddressInput) =>
  accountFetch<CustomerAddress>('/api/v1/storefront/account/addresses', { method: 'POST', body: JSON.stringify(input) });
export const updateAddress = (id: string, input: Partial<AddressInput>) =>
  accountFetch<CustomerAddress>(`/api/v1/storefront/account/addresses/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
export const setDefaultAddress = (id: string) =>
  accountFetch<CustomerAddress>(`/api/v1/storefront/account/addresses/${id}/default`, { method: 'POST' });
export const deleteAddress = (id: string) => accountFetch<void>(`/api/v1/storefront/account/addresses/${id}`, { method: 'DELETE' });

export interface RecentlyViewedItem {
  styleId: string;
  name: string;
  styleCode: string;
  viewedAt: string;
}

export const recordProductView = (styleId: string) =>
  accountFetch<void>(`/api/v1/storefront/account/recently-viewed/${styleId}`, { method: 'POST' });
export const listRecentlyViewed = () => accountFetch<RecentlyViewedItem[]>('/api/v1/storefront/account/recently-viewed');

export interface CategoryOption {
  id: string;
  name: string;
}
export interface SizeOption {
  id: string;
  label: string;
}
export interface SavedSize {
  id: string;
  categoryId: string;
  categoryName: string;
  sizeId: string;
  sizeLabel: string;
  updatedAt: string;
}

export const listCategoryOptions = () =>
  fetch(`${API_URL}/api/v1/storefront/categories`).then((r) => r.json()) as Promise<CategoryOption[]>;
export const listSizeOptions = () => fetch(`${API_URL}/api/v1/storefront/sizes`).then((r) => r.json()) as Promise<SizeOption[]>;
export const listSavedSizes = () => accountFetch<SavedSize[]>('/api/v1/storefront/account/sizes');
export const saveSize = (categoryId: string, sizeId: string) =>
  accountFetch<SavedSize>('/api/v1/storefront/account/sizes', { method: 'PUT', body: JSON.stringify({ categoryId, sizeId }) });
export const removeSavedSize = (id: string) => accountFetch<void>(`/api/v1/storefront/account/sizes/${id}`, { method: 'DELETE' });

export interface MyReview {
  id: string;
  styleId: string;
  styleName: string;
  rating: number;
  title: string | null;
  body: string;
  status: 'PUBLISHED' | 'HIDDEN';
  createdAt: string;
}

export const listMyReviews = () => accountFetch<MyReview[]>('/api/v1/storefront/account/reviews');

export type CommunicationChannel = 'SMS' | 'WHATSAPP' | 'EMAIL' | 'PUSH';
export type CommunicationMessageType = 'ORDER_UPDATES' | 'OFFERS_AND_PROMOTIONS' | 'PRODUCT_RECOMMENDATIONS' | 'NEWSLETTER';
export interface CommunicationPreferenceRow {
  channel: CommunicationChannel;
  messageType: CommunicationMessageType;
  optedIn: boolean;
  transactional: boolean;
}

export const getCommunicationPreferences = () =>
  accountFetch<CommunicationPreferenceRow[]>('/api/v1/storefront/account/communication-preferences');
export const setCommunicationPreferences = (preferences: Array<{ channel: CommunicationChannel; messageType: CommunicationMessageType; optedIn: boolean }>) =>
  accountFetch<CommunicationPreferenceRow[]>('/api/v1/storefront/account/communication-preferences', {
    method: 'PUT',
    body: JSON.stringify({ preferences }),
  });

export interface StoreCreditEntry {
  id: string;
  type: 'ISSUE';
  amount: string;
  reason: string;
  createdAt: string;
}
export interface StoreCreditBalance {
  balance: number;
  entries: StoreCreditEntry[];
}

// Reuses the EXISTING M20 storefront route directly - no new backend
// code. `tryCustomerAuth` accepts a Bearer token, so this can share
// accountFetch's auth header even though the underlying route also
// accepts guests via a different header.
export const getStoreCredit = () => accountFetch<StoreCreditBalance>('/api/v1/storefront/store-credit');
