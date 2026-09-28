'use client';

/**
 * Staff session (M29 admin app). Mirrors apps/storefront's
 * customer-auth.ts localStorage-session convention exactly - a
 * per-browser convenience, never treated as durable/shared state. The
 * token is a staff session token (StaffSessionStore, M01), not a JWT -
 * every authenticated call sends it as a Bearer token, exactly like the
 * integration tests' `createAuthenticatedStaff` fixture.
 */

const STORAGE_KEY = 'fcp_admin_session';
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface StaffSession {
  token: string;
  staffUserId: string;
  roles: string[];
  permissions: string[];
}

export function getStoredSession(): StaffSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StaffSession) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing / blocked storage.
  }
}

function storeSession(session: StaffSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Private browsing / blocked storage - the session simply won't persist across reloads.
  }
}

export async function staffLogin(email: string, password: string): Promise<StaffSession> {
  const res = await fetch(`${API_URL}/api/v1/auth/staff/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? 'Invalid email or password.');
  }
  const { token } = (await res.json()) as { token: string; expiresAt: string };

  const meRes = await fetch(`${API_URL}/api/v1/auth/staff/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!meRes.ok) throw new Error('Login succeeded but the session could not be verified.');
  const me = (await meRes.json()) as { id: string; roles: string[]; permissions: string[] };

  const session: StaffSession = { token, staffUserId: me.id, roles: me.roles, permissions: me.permissions };
  storeSession(session);
  return session;
}
