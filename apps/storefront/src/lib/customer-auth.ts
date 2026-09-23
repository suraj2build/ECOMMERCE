'use client';

/**
 * Minimal customer session (mobile OTP, AUTH-001) - scoped narrowly to
 * what M11 (PDP-001, reviews) needs: a token to submit a review with.
 * Full customer account/profile UI (saved addresses, order history,
 * "My Sizes") is CUST-001/specs/21-customer-profile.md's own scope, not
 * built here. Token lives in localStorage only - a per-browser
 * convenience, never treated as durable/shared state (see the Artifact
 * tool's localStorage guidance for the same discipline).
 */

const STORAGE_KEY = 'fcp_customer_session';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface CustomerSession {
  accessToken: string;
  customerId: string;
}

export function getStoredSession(): CustomerSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CustomerSession) : null;
  } catch {
    return null;
  }
}

function storeSession(session: CustomerSession) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Private browsing / blocked storage - the session simply won't persist across reloads.
  }
}

export async function requestOtp(mobile: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/auth/customer/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile }),
  });
  if (!res.ok) throw new Error('Could not send OTP - check the mobile number and try again.');
}

export async function verifyOtp(mobile: string, code: string): Promise<CustomerSession> {
  const res = await fetch(`${API_URL}/api/v1/auth/customer/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile, code }),
  });
  if (!res.ok) throw new Error('Incorrect or expired code.');
  const data = (await res.json()) as { accessToken: string; customerId: string };
  const session: CustomerSession = { accessToken: data.accessToken, customerId: data.customerId };
  storeSession(session);
  return session;
}
