'use client';

/**
 * Staff session (M29 admin app). Mirrors apps/storefront's
 * customer-auth.ts localStorage-session convention exactly - a
 * per-browser convenience, never treated as durable/shared state. The
 * token is a staff session token (StaffSessionStore, M01), not a JWT -
 * every authenticated call sends it as a Bearer token, exactly like the
 * integration tests' `createAuthenticatedStaff` fixture.
 *
 * The permission list stored here only decides what the console shows;
 * every action is still authorized by the server.
 */

const STORAGE_KEY = 'fcp_admin_session';
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface StaffSession {
  token: string;
  staffUserId: string;
  roles: string[];
  permissions: string[];
  /** A temporary password is in use: the console shows only "Choose a new password" (AO-D7). */
  mustChangePassword?: boolean;
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

/** Thrown when the password was accepted but the account needs its authenticator code (AUTH-002). */
export class MfaRequiredError extends Error {
  constructor() {
    super('Enter the 6-digit code from your authenticator app.');
  }
}

/**
 * Password login, with the MFA code on a second submit when the server
 * answers 401 MFA_REQUIRED. The code is only ever sent to the login
 * route; it is never stored.
 */
export async function staffLogin(email: string, password: string, mfaCode?: string): Promise<StaffSession> {
  const res = await fetch(`${API_URL}/api/v1/auth/staff/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, ...(mfaCode ? { mfaCode } : {}) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
    if (body?.error?.code === 'MFA_REQUIRED') throw new MfaRequiredError();
    throw new Error(body?.error?.message ?? 'Invalid email or password.');
  }
  const { token } = (await res.json()) as { token: string; expiresAt: string };
  return startSession(token);
}

async function startSession(token: string): Promise<StaffSession> {
  const meRes = await fetch(`${API_URL}/api/v1/auth/staff/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!meRes.ok) throw new Error('Login succeeded but the session could not be verified.');
  const me = (await meRes.json()) as { id: string; roles: string[]; permissions: string[]; mustChangePassword?: boolean };

  const session: StaffSession = { token, staffUserId: me.id, roles: me.roles, permissions: me.permissions, mustChangePassword: Boolean(me.mustChangePassword) };
  storeSession(session);
  return session;
}

/**
 * Changes the signed-in person's password (AO-D7). The server ends every
 * session, this one included, and returns a new one, which replaces the
 * stored session. Neither password is stored.
 */
export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<StaffSession> {
  const session = getStoredSession();
  if (!session) throw new Error('Sign in again.');
  const res = await fetch(`${API_URL}/api/v1/auth/staff/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (res.status === 401) clearSession();
    throw new Error(body?.error?.message ?? 'The password could not be changed.');
  }
  const { token } = (await res.json()) as { token: string };
  return startSession(token);
}

/** Revokes the session server-side (POST /auth/staff/logout), then forgets it locally either way. */
export async function staffLogout(): Promise<void> {
  const session = getStoredSession();
  try {
    if (session) {
      await fetch(`${API_URL}/api/v1/auth/staff/logout`, { method: 'POST', headers: { authorization: `Bearer ${session.token}` } });
    }
  } finally {
    clearSession();
  }
}
