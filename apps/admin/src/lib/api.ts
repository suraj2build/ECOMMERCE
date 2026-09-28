'use client';

import { API_URL, getStoredSession, clearSession } from './staff-auth';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Authenticated fetch wrapper for every admin-app call to commerce-api's
 * staff-gated routes. A 401 clears the local session (server-side
 * authorization is authoritative - the client never guesses whether a
 * token is still valid, it just reacts to what the server says). A 403
 * is returned to the caller as an `ApiError`, never swallowed, so a
 * screen can show the real "Forbidden" outcome FLOW 19 requires -
 * proving rejection is server-side, not a client-side guess about what
 * the UI should or shouldn't render.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = getStoredSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (session) headers.authorization = `Bearer ${session.token}`;

  const res = await fetch(`${API_URL}/api/v1${path}`, { ...init, headers });

  if (res.status === 401) {
    clearSession();
    throw new ApiError(401, 'Your session has expired. Please sign in again.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new ApiError(res.status, body?.error?.message ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
