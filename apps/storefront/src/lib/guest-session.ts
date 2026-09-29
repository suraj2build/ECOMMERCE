'use client';

/**
 * M31 CART-004 closure: the guest-session identifier is now
 * server-issued (`POST /storefront/guest-session`, an HMAC-signed
 * `<uuid>.<signature>` token - see the API side's
 * services/commerce-api/src/modules/cart/identity.ts for the complete
 * design record) rather than generated client-side, so possession of a
 * value alone is no longer sufficient to claim a cart/wishlist/
 * checkout session in production - only a token this server actually
 * minted verifies. Every module that previously called
 * `crypto.randomUUID()` directly (cart.ts, checkout.ts, exchanges.ts,
 * orders.ts, refunds.ts, returns.ts) now shares this ONE fetch-and-
 * cache implementation instead of each re-deriving its own id.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const GUEST_SESSION_KEY = 'fcp_guest_session_id';

// A single in-flight fetch is shared across concurrent callers within
// the same page load (e.g. several components mounting at once and all
// needing a guest identity before their first request) - never issues
// more than one guest-session token per page load even under
// concurrent calls.
let inFlight: Promise<string> | null = null;

async function fetchGuestSessionToken(): Promise<string> {
  const res = await fetch(`${API_URL}/api/v1/storefront/guest-session`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to obtain a guest session (${res.status})`);
  const body = (await res.json()) as { guestSessionId: string };
  return body.guestSessionId;
}

/**
 * Returns the cached guest-session token if one exists; otherwise
 * fetches a fresh one from the server and caches it. Never generates a
 * value locally - see this module's own docblock for why.
 */
export async function getOrCreateGuestSessionToken(): Promise<string> {
  try {
    const existing = localStorage.getItem(GUEST_SESSION_KEY);
    if (existing) return existing;
  } catch {
    // Private browsing / blocked storage - fall through to a fresh,
    // unpersisted fetch below; the app still functions for this page
    // view, just without cross-request continuity.
  }

  if (!inFlight) {
    inFlight = fetchGuestSessionToken().finally(() => {
      inFlight = null;
    });
  }
  const token = await inFlight;
  try {
    localStorage.setItem(GUEST_SESSION_KEY, token);
  } catch {
    // Private browsing / blocked storage - the fetched token is still
    // returned for this call; just not persisted for the next one.
  }
  return token;
}

/** Returns the cached token without minting a new one, or null if none exists yet - for read paths that should never conjure a guest identity that has no cart/order to look up. */
export function peekGuestSessionToken(): string | null {
  try {
    return localStorage.getItem(GUEST_SESSION_KEY);
  } catch {
    return null;
  }
}
