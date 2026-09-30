'use client';

/**
 * Guest-session credential client (CART-004). The token is issued and
 * renewed only by the API (`POST /storefront/guest-session`,
 * `POST /storefront/guest-session/renew`); this module never generates
 * an identity locally. See services/commerce-api/src/modules/cart/identity.ts
 * for the token format and server-side rules.
 *
 * The timestamps inside the token are read here ONLY to decide when to
 * renew; the server independently verifies signature and expiry on
 * every request, so nothing here is trusted for authorization.
 *
 * Lifecycle:
 *  - no token, an expired token, or an unrecognized (e.g. pre-lifecycle)
 *    token -> obtain a new guest session;
 *  - past half its lifetime -> renew (same guest owner, so the existing
 *    cart, wishlist and guest orders stay attached);
 *  - renewal rejected (401) -> obtain a new guest session.
 * Concurrent callers share one in-flight request, so a page load never
 * ends up with two different guest identities.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const GUEST_SESSION_KEY = 'fcp_guest_session_id';
const GUEST_HEADER = 'x-guest-session-id';
const EXPIRY_MARGIN_SECONDS = 60;

let inFlight: Promise<string> | null = null;

interface TokenTimes {
  issuedAt: number;
  expiresAt: number;
}

function readTokenTimes(token: string): TokenTimes | null {
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== 'gs1') return null;
  const issuedAt = Number(parts[2]);
  const expiresAt = Number(parts[3]);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) return null;
  return { issuedAt, expiresAt };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function readStored(): string | null {
  try {
    return localStorage.getItem(GUEST_SESSION_KEY);
  } catch {
    return null;
  }
}

function store(token: string | null): void {
  try {
    if (token) localStorage.setItem(GUEST_SESSION_KEY, token);
    else localStorage.removeItem(GUEST_SESSION_KEY);
  } catch {
    // Private browsing / blocked storage - the token still works for this call.
  }
}

async function requestNewSession(): Promise<string> {
  const res = await fetch(`${API_URL}/api/v1/storefront/guest-session`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to obtain a guest session (${res.status})`);
  return ((await res.json()) as { guestSessionId: string }).guestSessionId;
}

/** Renewed token, null if the server rejected the current one, or the current token on a transient failure. */
async function requestRenewal(current: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/storefront/guest-session/renew`, {
      method: 'POST',
      headers: { [GUEST_HEADER]: current },
    });
    if (res.status === 401) return null;
    if (!res.ok) return current;
    return ((await res.json()) as { guestSessionId: string }).guestSessionId;
  } catch {
    return current;
  }
}

type TokenState = 'missing' | 'unusable' | 'fresh' | 'renew';

function classify(token: string | null): TokenState {
  if (!token) return 'missing';
  const times = readTokenTimes(token);
  if (!times) return 'unusable';
  const now = nowSeconds();
  if (now >= times.expiresAt - EXPIRY_MARGIN_SECONDS) return 'unusable';
  const halfLife = times.issuedAt + (times.expiresAt - times.issuedAt) / 2;
  return now >= halfLife ? 'renew' : 'fresh';
}

function share(work: () => Promise<string>): Promise<string> {
  if (!inFlight) {
    inFlight = work().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** A usable guest token, creating a guest session if none exists yet. */
export async function getOrCreateGuestSessionToken(): Promise<string> {
  const current = readStored();
  const state = classify(current);
  if (state === 'fresh') return current!;
  return share(async () => {
    let token: string | null = null;
    if (state === 'renew') token = await requestRenewal(current!);
    if (!token) token = await requestNewSession();
    store(token);
    return token;
  });
}

/**
 * The existing guest token (renewed if due), or null when this browser
 * has no usable guest session - for read paths (order history, returns,
 * refunds, exchanges) that must never conjure a new guest identity.
 */
export async function getExistingGuestSessionToken(): Promise<string | null> {
  const current = readStored();
  const state = classify(current);
  if (state === 'fresh') return current;
  if (state === 'missing') return null;
  if (state === 'unusable') {
    store(null);
    return null;
  }
  try {
    return await share(async () => {
      const renewed = await requestRenewal(current!);
      if (!renewed) throw new Error('guest session no longer valid');
      store(renewed);
      return renewed;
    });
  } catch {
    store(null);
    return null;
  }
}

/**
 * Drops a stored token the server has just rejected (e.g. after a
 * signing-secret rotation), so the next call obtains a new session.
 * Only removes it if it is still the stored value.
 */
export function discardGuestSessionToken(rejected: string): void {
  if (readStored() === rejected) store(null);
}
